import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createScan, getScans, updateScanStatus, updateScanProgress, recoverStuckScans } from "@/lib/data/scans";
import { getActiveConnection } from "@/lib/data/connections";
import { bulkCreateInvoices } from "@/lib/data/invoices";
import { db } from "@/lib/db";
import { normalizeCurrency } from "@/lib/utils";
import { canonicalSupplierKey, canonicalDisplayName } from "@/lib/supplier-canonical";
import {
  extractDomain,
  extractCompany,
  extractVendorFromSubject,
  normalizeCompanyName,
} from "@/lib/scan-company";
import { dispatchScan } from "@/lib/worker";

// Vercel kills the function (and any `after()` work) at this deadline. The
// scan flow runs entirely inside after(), so this MUST be at least as long
// as the worst-case worker turnaround. With the v2 worker (regex hot-spot
// fix + chunked classify), a 30-day / ~160-email scan completes in <10s,
// but we leave generous headroom for larger inboxes. Requires Pro tier on
// Vercel; on Hobby (10s cap) the after() body will be truncated and a
// scan that takes longer will be left in RUNNING — recoverStuckScans
// reclaims it after 15 minutes.
export const maxDuration = 300; // seconds

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const scans = await getScans(orgId);
  return NextResponse.json({ scans });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  // Get active Gmail connection
  const connection = await getActiveConnection(orgId);
  if (!connection) {
    return NextResponse.json(
      { error: "No Gmail account connected" },
      { status: 400 }
    );
  }

  // Pre-flight: ensure the stored grant has gmail.readonly. If the user
  // reconnected without ticking the Gmail box on Google's consent screen,
  // the refresh_token only allows openid/email/profile and every scan would
  // burn a worker round trip just to fail with 403 INSUFFICIENT_SCOPES.
  // Surface it here with an actionable message before spawning anything.
  const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
  if (!connection.scopes?.includes(GMAIL_READONLY)) {
    return NextResponse.json(
      {
        error:
          "Gmail permission missing from this connection. Reconnect your Google account and tick the Gmail box on the consent screen.",
        action: "RECONNECT_GMAIL",
        grantedScopes: connection.scopes ?? [],
      },
      { status: 400 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const keywords = Array.isArray(body.keywords)
    ? body.keywords
        .filter((k: unknown) => typeof k === "string" && k.length <= 200)
        .map((k: string) => k.trim())
        .filter((k: string) => k.length > 0)
        .slice(0, 20)
    : [];
  // Cap raised from 365 to 730 days (2 years) on 2026-05-23: users
  // running annual archive scans for tax purposes need to reach receipts
  // older than one year. Combined with the bumped _MAX_MESSAGES=5000 in
  // the worker, 2-year scans now reliably capture multi-vendor history.
  const daysBack = typeof body.daysBack === "number" && Number.isInteger(body.daysBack) && body.daysBack >= 1 && body.daysBack <= 730
    ? body.daysBack
    : 90;
  // Default to scanning the full inbox. The previous default of `true`
  // silently missed every invoice the user had already opened in Gmail —
  // the single biggest correctness gap reported by users ("the scan
  // doesn't find my invoices"). Most users read their email; "unread
  // only" is the niche power-user mode, not the default.
  const unreadOnly = typeof body.unreadOnly === "boolean" ? body.unreadOnly : false;

  // Reclaim any scans that have been RUNNING > 15 min before we evaluate
  // the duplicate-scan guard. Without this, a single crashed/timed-out
  // worker call leaves the org permanently unable to scan until the user
  // happens to visit the /scans listing page (which is where the existing
  // recovery sweep lives). Cheap UPDATE, safe to run on every POST.
  await recoverStuckScans(orgId);

  // Duplicate scan prevention: block if a RUNNING scan already exists for this org
  const runningScan = await db.scan.findFirst({
    where: { organizationId: orgId, status: { in: ["PENDING", "RUNNING"] } },
    select: { id: true },
  });
  if (runningScan) {
    return NextResponse.json(
      { error: "A scan is already in progress. Please wait for it to complete or cancel it first." },
      { status: 429 }
    );
  }

  const scan = await createScan(orgId, connection.id, {
    keywords,
    daysBack,
    unreadOnly,
  });

  // Set scan to RUNNING immediately
  await updateScanStatus(orgId, scan.id, {
    status: "RUNNING",
    startedAt: new Date(),
  });

  // Run the heavy dispatch in the background so the POST returns immediately
  after(async () => {
    try {
      // Check if scan was cancelled before processing even starts
      const preCheck = await db.scan.findUnique({ where: { id: scan.id }, select: { status: true } });
      if (preCheck?.status === "CANCELLED") return;

      const result = await dispatchScan(
        scan.id,
        {
          accessToken: connection.accessToken,
          refreshToken: connection.refreshToken,
          tokenExpiry: connection.tokenExpiry,
        },
        { keywords, daysBack, unreadOnly },
        (() => {
          let lastWrite = 0;
          let lastProgress = -1;
          return async (progress: number, message: string) => {
            const now = Date.now();
            // Throttle progress DB writes — but never silence updates that
            // cross a stage boundary, otherwise a long stage (classify,
            // enrich) leaves the UI frozen on the previous stage's value
            // for 10+ seconds. Stage boundary heuristic: 5+ point jump.
            const crossedStage = lastProgress >= 0 && progress - lastProgress >= 5;
            if (
              progress >= 100 ||
              crossedStage ||
              now - lastWrite >= 1000
            ) {
              lastWrite = now;
              lastProgress = progress;
              await updateScanProgress(scan.id, progress, message);
            }
          };
        })()
      );

      if (result.error) {
        await updateScanStatus(orgId, scan.id, {
          status: "FAILED",
          progress: 100,
          progressMessage: result.error,
          errorMessage: result.error,
          completedAt: new Date(),
        });
        return;
      }

      // Check if scan was cancelled while worker was running
      const midCheck = await db.scan.findUnique({ where: { id: scan.id }, select: { status: true } });
      if (midCheck?.status === "CANCELLED") return;

      // ── Scan-time quality filter ────────────────────────────────────

      function shouldPersist(inv: any): boolean {
        const tier = inv.classification_tier ?? "not_invoice";
        // confirmed/likely/possible always persist
        if (tier !== "not_invoice") return true;
        // not_invoice: only persist if score shows real invoice evidence
        // (sender domain alone is not enough — need subject/body/attachment signal)
        const score = inv.classification_score ?? 0;
        if (score < 5) return false;
        const signals: any[] = inv.classification_signals ?? [];
        const hasContentSignal = signals.some((s: any) =>
          s.score > 0 && s.signal !== "sender_invoice_domain"
        );
        return hasContentSignal;
      }

      const persistable = result.invoices.filter(shouldPersist);

      // ── Scan funnel observability ───────────────────────────────────
      // Make the whole pipeline auditable from logs: how many emails Gmail
      // returned, how the classifier tiered them, how many we dropped (and
      // why), and how many we will save. Without this the user only sees a
      // final "N candidates" and can't tell whether a missing invoice was
      // never fetched, was tiered too low, or was dropped by shouldPersist.
      {
        const found = result.total_messages;
        const classified = result.invoices.length;
        const tierBreakdown = result.invoices.reduce(
          (acc: Record<string, number>, inv: any) => {
            const t = inv.classification_tier ?? "not_invoice";
            acc[t] = (acc[t] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );
        const rejected = result.invoices.filter((inv: any) => !shouldPersist(inv));
        console.log(
          `[Scan ${scan.id}] funnel: found=${found} classified=${classified} ` +
          `(confirmed=${tierBreakdown.confirmed_invoice ?? 0} likely=${tierBreakdown.likely_invoice ?? 0} ` +
          `possible=${tierBreakdown.possible_financial_email ?? 0} not_invoice=${tierBreakdown.not_invoice ?? 0}) ` +
          `rejected=${rejected.length} persistable=${persistable.length}`
        );
        // Per-email reject reason — capped so a 5000-email scan can't flood
        // the log. Safe metadata only (sender + subject + tier + score), no body.
        const REJECT_LOG_CAP = 40;
        rejected.slice(0, REJECT_LOG_CAP).forEach((inv: any) => {
          const score = inv.classification_score ?? 0;
          const reason =
            score < 5
              ? `not_invoice score ${score} < 5`
              : "not_invoice without content signal (sender domain alone)";
          console.log(
            `[Scan ${scan.id}] rejected: ${reason} | ${(inv.sender ?? "").slice(0, 60)} | ${(inv.subject ?? "").slice(0, 80)}`
          );
        });
        if (rejected.length > REJECT_LOG_CAP) {
          console.log(`[Scan ${scan.id}] (… ${rejected.length - REJECT_LOG_CAP} more rejected emails not logged)`);
        }
      }

      // Tier → default reportStatus. Project spec:
      //   • confirmed_invoice / likely_invoice → INCLUDED (in the report)
      //   • possible_financial_email           → EXCLUDED (needs review)
      //   • not_invoice (only persisted if it has content signal)
      //                                        → EXCLUDED (needs review)
      // Excluded items still appear in the scan detail page under
      // "for review", so the user can promote them. This stops the main
      // report from being polluted with weak-signal emails while keeping
      // them discoverable.
      function defaultReportStatus(tier: string): "INCLUDED" | "EXCLUDED" {
        if (tier === "confirmed_invoice" || tier === "likely_invoice") {
          return "INCLUDED";
        }
        return "EXCLUDED";
      }

      const invoiceRows = persistable.map((inv) => {
        const senderDomain = extractDomain(inv.sender);
        // Build a tentative company string from the strongest signal
        // available — PayPal-vendor subject extraction → existing
        // company → fallback to the domain brand. THEN pipe the whole
        // thing through the canonical resolver so the stored company
        // is the user-visible canonical display name. This is the only
        // place writing `company` so the supplier panel never sees
        // duplicate variants again.
        const rawCompany =
          extractVendorFromSubject(inv.subject, inv.sender) ||
          normalizeCompanyName(inv.company || extractCompany(inv.sender) || "") ||
          undefined;
        const canonicalKey = canonicalSupplierKey({
          company: rawCompany ?? null,
          senderDomain: senderDomain ?? null,
        });
        const canonicalCompany = canonicalKey
          ? canonicalDisplayName(canonicalKey)
          : (rawCompany || undefined);

        return {
          gmailMessageId: inv.uid ?? `unknown-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          subject: inv.subject ?? "(no subject)",
          sender: inv.sender ?? "",
          senderDomain,
          company: canonicalCompany,
          date: inv.date ? new Date(inv.date) : undefined,
          amount: inv.amount ?? undefined,
          currency: normalizeCurrency(inv.currency ?? "ILS"),
          classificationTier: inv.classification_tier ?? "not_invoice",
          classificationScore: inv.classification_score ?? 0,
          classificationSignals: inv.classification_signals,
          bodyHtml: inv.body_html || undefined,
          hasAttachment: (inv.attachments?.length ?? 0) > 0,
          attachmentPath: inv.saved_path || undefined,
          notes: inv.notes || undefined,
          reportStatus: defaultReportStatus(inv.classification_tier ?? "not_invoice"),
        };
      });

      if (persistable.length > 0) {

        // Insert new invoices (skipDuplicates for idempotency)
        const createResult = await bulkCreateInvoices(orgId, scan.id, invoiceRows);
        console.log(`[Scan ${scan.id}] bulkCreate: ${createResult.count} new, ${invoiceRows.length} total`);

        // ALWAYS re-associate ALL matching invoices to this scan.
        // createMany with skipDuplicates does NOT update existing rows,
        // so we must explicitly set scanId on duplicates. Split by the
        // per-tier default reportStatus so a re-scan does NOT flip a
        // previously-excluded "possible" invoice back to INCLUDED.
        const includedIds = invoiceRows
          .filter((r) => !r.gmailMessageId.startsWith("unknown-") && r.reportStatus === "INCLUDED")
          .map((r) => r.gmailMessageId);
        const excludedIds = invoiceRows
          .filter((r) => !r.gmailMessageId.startsWith("unknown-") && r.reportStatus === "EXCLUDED")
          .map((r) => r.gmailMessageId);

        for (const [ids, status] of [
          [includedIds, "INCLUDED" as const],
          [excludedIds, "EXCLUDED" as const],
        ] as const) {
          if (ids.length === 0) continue;
          for (let i = 0; i < ids.length; i += 500) {
            const chunk = ids.slice(i, i + 500);
            const reassocResult = await db.invoice.updateMany({
              where: {
                organizationId: orgId,
                gmailMessageId: { in: chunk },
              },
              data: { scanId: scan.id, reportStatus: status },
            });
            console.log(`[Scan ${scan.id}] re-associated chunk ${i}-${i + chunk.length} (${status}): ${reassocResult.count} rows`);
          }
        }

        // Lock in COMPLETED status BEFORE the optional backfill loops below.
        // The backfills are quality-of-life refreshes for ALREADY-existing
        // rows (skipDuplicates left their tier/html/company stale). If
        // Vercel's after() deadline kills them mid-way, the new scan's data
        // is already persisted by bulkCreate above — the scan must not stay
        // RUNNING.
        {
          const earlyTierTotals = invoiceRows.reduce(
            (acc, r) => {
              acc[r.classificationTier] = (acc[r.classificationTier] ?? 0) + 1;
              return acc;
            },
            {} as Record<string, number>
          );
          const earlyIncluded = invoiceRows.filter((r) => r.reportStatus === "INCLUDED").length;
          const earlyExcluded = invoiceRows.filter((r) => r.reportStatus === "EXCLUDED").length;
          const earlyParts = [
            `Scanned ${result.total_messages}`,
            `${earlyIncluded} in report`,
          ];
          if (earlyExcluded > 0) earlyParts.push(`${earlyExcluded} for review`);
          if (earlyTierTotals.confirmed_invoice) earlyParts.push(`${earlyTierTotals.confirmed_invoice} confirmed`);
          if (earlyTierTotals.likely_invoice) earlyParts.push(`${earlyTierTotals.likely_invoice} likely`);
          await db.scan.updateMany({
            where: { id: scan.id, organizationId: orgId, status: "RUNNING" },
            data: {
              status: "COMPLETED",
              totalMessages: result.total_messages,
              processedCount: result.invoices.length,
              invoiceCount: earlyIncluded,
              progress: 100,
              progressMessage: `Complete — ${earlyParts.join(" · ")}`,
              completedAt: new Date(),
            },
          });
        }

        // Backfill classification fields for existing invoices. createMany
        // with skipDuplicates does NOT update existing rows, so when the
        // classifier improves (e.g., new Hebrew pattern that promotes a
        // Wolt receipt from "possible" to "likely"), the stored
        // classificationTier / score / signals will drift out of sync with
        // the freshly-computed reportStatus from re-association. Refresh
        // those fields to keep the row internally consistent.
        const classificationBackfills = invoiceRows.filter(
          (r) => !r.gmailMessageId.startsWith("unknown-")
        );
        if (classificationBackfills.length > 0) {
          let filled = 0;
          for (let bi = 0; bi < classificationBackfills.length; bi += 50) {
            const chunk = classificationBackfills.slice(bi, bi + 50);
            const chunkResults = await Promise.all(
              chunk.map((r) =>
                db.invoice.updateMany({
                  where: {
                    organizationId: orgId,
                    gmailMessageId: r.gmailMessageId,
                  },
                  // Cast: classificationSignals is typed loosely as
                  // Record<string, unknown> from the worker JSON; Prisma's
                  // JSON column accepts any serializable shape.
                  data: {
                    classificationTier: r.classificationTier,
                    classificationScore: r.classificationScore,
                    classificationSignals: r.classificationSignals as any,
                  },
                })
              )
            );
            filled += chunkResults.reduce((sum, r) => sum + r.count, 0);
          }
          if (filled > 0) {
            console.log(`[Scan ${scan.id}] refreshed classification fields for ${filled} invoices`);
          }
        }

        // Backfill bodyHtml for existing invoices that were missing it.
        // createMany with skipDuplicates does NOT update existing rows,
        // so invoices from older scans may have NULL bodyHtml.
        const htmlBackfills = invoiceRows.filter(
          (r) => r.bodyHtml && !r.gmailMessageId.startsWith("unknown-")
        );
        if (htmlBackfills.length > 0) {
          // Parallel chunks — no $transaction lock needed (idempotent WHERE bodyHtml: null)
          let filled = 0;
          for (let bi = 0; bi < htmlBackfills.length; bi += 50) {
            const chunk = htmlBackfills.slice(bi, bi + 50);
            const chunkResults = await Promise.all(
              chunk.map((r) =>
                db.invoice.updateMany({
                  where: {
                    organizationId: orgId,
                    gmailMessageId: r.gmailMessageId,
                    bodyHtml: null,
                  },
                  data: { bodyHtml: r.bodyHtml },
                })
              )
            );
            filled += chunkResults.reduce((sum, r) => sum + r.count, 0);
          }
          if (filled > 0) {
            console.log(`[Scan ${scan.id}] backfilled bodyHtml for ${filled} existing invoices`);
          }
        }

        // Backfill company for existing invoices that were scanned before
        // vendor extraction was improved (e.g., PayPal receipts with Meta/Shopify).
        const companyBackfills = invoiceRows.filter(
          (r) => r.company && !r.gmailMessageId.startsWith("unknown-")
        );
        if (companyBackfills.length > 0) {
          let filled = 0;
          for (let bi = 0; bi < companyBackfills.length; bi += 50) {
            const chunk = companyBackfills.slice(bi, bi + 50);
            const chunkResults = await Promise.all(
              chunk.map((r) =>
                db.invoice.updateMany({
                  where: {
                    organizationId: orgId,
                    gmailMessageId: r.gmailMessageId,
                    company: { not: r.company },
                  },
                  data: { company: r.company },
                })
              )
            );
            filled += chunkResults.reduce((sum, r) => sum + r.count, 0);
          }
          if (filled > 0) {
            console.log(`[Scan ${scan.id}] backfilled company for ${filled} existing invoices`);
          }
        }
      }

      // Tier-broken-down summary — computed from the persistable set so
      // it reflects what we actually saved, not raw worker output.
      const tierTotals = invoiceRows.reduce(
        (acc, r) => {
          acc[r.classificationTier] = (acc[r.classificationTier] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
      const includedCount = invoiceRows.filter((r) => r.reportStatus === "INCLUDED").length;
      const excludedCount = invoiceRows.filter((r) => r.reportStatus === "EXCLUDED").length;
      const summaryParts = [
        `Scanned ${result.total_messages}`,
        `${includedCount} in report`,
      ];
      if (excludedCount > 0) summaryParts.push(`${excludedCount} for review`);
      if (tierTotals.confirmed_invoice) summaryParts.push(`${tierTotals.confirmed_invoice} confirmed`);
      if (tierTotals.likely_invoice) summaryParts.push(`${tierTotals.likely_invoice} likely`);
      const summary = `Complete — ${summaryParts.join(" · ")}`;

      // Final, explicit funnel on the web side so the whole pipeline is
      // auditable end-to-end from logs (worker logs the fetch/classify funnel;
      // this logs the persist → report funnel). "shown_in_report" is what the
      // user actually sees included by default.
      console.log(
        `[Scan ${scan.id}] PERSIST FUNNEL — found=${result.total_messages} ` +
        `classified=${result.invoices.length} saved=${invoiceRows.length} ` +
        `shown_in_report=${includedCount} for_review=${excludedCount}`
      );

      // Mark COMPLETED *as early as possible* after the core persistence step,
      // BEFORE the supplier-exclusion sweep. The supplier sweep is best-effort
      // (the user can re-toggle excluded brands afterwards), but if Vercel's
      // after() deadline strikes mid-sweep with the scan still RUNNING the
      // user is stuck — recoverStuckScans then marks it FAILED even though
      // every invoice row is fully persisted. Atomically guarded so a user
      // cancellation racing in this window still wins.
      await db.scan.updateMany({
        where: { id: scan.id, organizationId: orgId, status: "RUNNING" },
        data: {
          status: "COMPLETED",
          totalMessages: result.total_messages,
          processedCount: result.invoices.length,
          invoiceCount: includedCount,
          progress: 100,
          progressMessage: summary,
          completedAt: new Date(),
        },
      });

      // ── Honour existing supplier exclusions ───────────────────────
      // Runs AFTER the scan is marked COMPLETED so a Vercel-timeout here
      // doesn't strand the scan in RUNNING. If this loop is killed, the
      // user just sees the supplier toggle "not applied yet" on their
      // pre-excluded brands — recoverable by clicking the supplier chip
      // off and on again.
      const excludedSuppliers = await db.supplier.findMany({
        where: { organizationId: orgId, isRelevant: false },
        select: { name: true },
      });
      if (excludedSuppliers.length > 0) {
        // Supplier names in the DB are stored as canonical keys. Match
        // each invoice's canonical key against the excluded set so toggling
        // "Apple" off excludes ALL apple-family invoices ("Apple", "Apple
        // Services", "iCloud", etc.) — not just rows whose raw company
        // happened to be the literal string "apple".
        const excludedKeys = new Set(
          excludedSuppliers.map((s) => s.name.toLowerCase())
        );
        const scanInvs = await db.invoice.findMany({
          where: { organizationId: orgId, scanId: scan.id },
          select: { id: true, company: true, senderDomain: true },
        });
        const idsToExclude = scanInvs
          .filter((inv) => {
            const key = canonicalSupplierKey({
              company: inv.company,
              senderDomain: inv.senderDomain,
            });
            return key && excludedKeys.has(key);
          })
          .map((inv) => inv.id);
        for (let i = 0; i < idsToExclude.length; i += 500) {
          await db.invoice.updateMany({
            where: { id: { in: idsToExclude.slice(i, i + 500) } },
            data: { reportStatus: "EXCLUDED" },
          });
        }
      }

      // Invalidate cached invoices page so new scan appears in dropdown
      revalidatePath("/invoices");
      revalidatePath("/scans");
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "Worker dispatch failed";
      // Log the full error server-side for debugging
      console.error(`[Scan ${scan.id}] dispatch error:`, raw);

      // If the worker reported an AUTH_ERROR, extract it cleanly and tell the
      // user to reconnect. AUTH_ERROR strings contain scope URLs which the
      // generic path-stripping regex below would mangle into "[path]".
      const authMatch = raw.match(/AUTH_ERROR:?\s*([^"}]+)/i);
      let safeMsg: string;
      if (authMatch) {
        safeMsg = (
          "Gmail authentication failed. " + authMatch[1].trim()
        ).slice(0, 400);
      } else {
        // Sanitize: strip internal paths, connection strings, and stack
        // traces before persisting — this message is returned to the client.
        safeMsg = raw
          .replace(/(?:\/[^\s:]+)+/g, "[path]")           // file paths
          .replace(/(?:postgres|mysql|redis|mongodb)\S+/gi, "[redacted]") // connection URIs
          .slice(0, 300);
      }
      await updateScanStatus(orgId, scan.id, {
        status: "FAILED",
        progress: 100,
        progressMessage: safeMsg,
        errorMessage: safeMsg,
        completedAt: new Date(),
      });
    }
  });

  // Return immediately — scan is RUNNING, client will poll for progress
  return NextResponse.json(
    { scan: { ...scan, status: "RUNNING" } },
    { status: 201 }
  );
}
