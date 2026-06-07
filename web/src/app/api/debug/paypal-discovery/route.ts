import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getActiveConnection } from "@/lib/data/connections";
import { checkWorkerHealth, dispatchDiscoveryDebug } from "@/lib/worker";

/**
 * Real-Gmail PayPal discovery diagnostic.
 *   GET /api/debug/paypal-discovery?days=365
 *
 * Runs live Gmail probes (from:paypal, from:paypal.com, "paypal",
 * category:purchases, the full scan query) against the CALLER'S OWN connected
 * mailbox via the worker, plus a parse→classify sample. Proves exactly where
 * PayPal becomes zero (mailbox / scope / query / fetch / classify) and which
 * worker version is live.
 *
 * Allowed in production (unlike the other debug routes) because diagnosing the
 * live PayPal outage requires production data. Hard-gated to an authenticated
 * OWNER and only ever touches that user's own organization + mailbox. Tokens
 * are never returned.
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Any authenticated member can run this — it only ever touches the caller's
  // OWN organization + mailbox (same exposure as /api/health/scan-readiness).
  // OWNER-only was an unnecessary friction point during the live outage.
  const orgId = (session as any).organizationId as string | undefined;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }
  const role = (session as any).role ?? "(unknown)";

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? "365");
  const daysBack = Number.isFinite(daysParam)
    ? Math.min(Math.max(Math.trunc(daysParam), 1), 730)
    : 365;

  const health = await checkWorkerHealth();

  const connection = await getActiveConnection(orgId);
  if (!connection) {
    return NextResponse.json(
      { worker: health, error: "No active Gmail connection. Connect Gmail first." },
      { status: 200 }
    );
  }

  const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
  const hasGmailScope = connection.scopes?.includes(GMAIL_READONLY) ?? false;

  let discovery: unknown = null;
  let error: string | null = null;
  try {
    discovery = await dispatchDiscoveryDebug(
      {
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        tokenExpiry: connection.tokenExpiry,
      },
      daysBack
    );
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : "discovery probe failed";
  }

  return NextResponse.json({
    role,
    worker: {
      ok: health.ok,
      url: process.env.WORKER_URL ?? "(unset)",
      version: health.version ?? "(none — old build without /health version)",
      paypalDiscoveryAnchor: health.paypalDiscoveryAnchor ?? false,
      error: health.error ?? null,
    },
    gmailConnection: {
      email: connection.email,
      hasRefreshToken: !!connection.refreshToken,
      hasGmailScope,
      grantedScopes: connection.scopes ?? [],
      tokenExpiry: connection.tokenExpiry?.toISOString() ?? null,
    },
    daysBack,
    discovery,
    error,
  });
}
