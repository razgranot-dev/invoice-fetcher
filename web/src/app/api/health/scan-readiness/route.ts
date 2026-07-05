/**
 * Scan-readiness diagnostic — checks every component the scan flow depends on.
 *
 *   GET /api/health/scan-readiness
 *
 * Returns 200 with per-stage booleans + error strings so you can quickly tell
 * which dependency broke when "scan fails every time". Returns NO secrets and
 * no PII beyond the connection email.
 *
 * Requires an authenticated session — this endpoint exposes which org you
 * belong to and whether your Gmail grant is healthy, so it must not be public.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkWorkerHealth } from "@/lib/worker";

const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = (session as any).organizationId as string | undefined;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const [dbResult, workerResult, connection, lastScan] = await Promise.all([
    db
      .$queryRaw`SELECT 1`
      .then(() => ({ ok: true, error: null as string | null }))
      .catch((e: Error) => ({ ok: false, error: e.message })),
    checkWorkerHealth(),
    db.gmailConnection.findFirst({
      where: { organizationId: orgId, isActive: true },
      select: {
        id: true,
        email: true,
        scopes: true,
        tokenExpiry: true,
        connectedAt: true,
        lastUsedAt: true,
        refreshToken: true,
      },
      orderBy: { lastUsedAt: "desc" },
    }),
    // Most recent scan for this org — lets us distinguish "all deps healthy
    // but scans still fail" (a processing regression) from a dep being down.
    // errorMessage is already sanitized at write time (sanitizeScanError), so
    // surfacing it here leaks no secrets.
    db.scan.findFirst({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, errorMessage: true, createdAt: true },
    }),
  ]);

  const env = {
    AUTH_GOOGLE_ID: !!process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: !!process.env.AUTH_GOOGLE_SECRET,
    AUTH_SECRET: !!process.env.AUTH_SECRET,
    DATABASE_URL: !!process.env.DATABASE_URL,
    WORKER_URL: !!process.env.WORKER_URL,
    NEXT_PUBLIC_APP_URL: !!process.env.NEXT_PUBLIC_APP_URL,
  };
  const envOk = Object.values(env).every(Boolean);

  let gmailConnection: {
    present: boolean;
    email?: string;
    hasRefreshToken?: boolean;
    hasGmailScope?: boolean;
    grantedScopes?: string[];
    tokenExpiry?: string | null;
    tokenExpired?: boolean;
    error?: string;
  } = { present: false };

  if (connection) {
    gmailConnection = {
      present: true,
      email: connection.email,
      hasRefreshToken: !!connection.refreshToken,
      hasGmailScope: connection.scopes?.includes(GMAIL_READONLY) ?? false,
      grantedScopes: connection.scopes ?? [],
      tokenExpiry: connection.tokenExpiry
        ? connection.tokenExpiry.toISOString()
        : null,
      tokenExpired: connection.tokenExpiry
        ? connection.tokenExpiry.getTime() < Date.now()
        : true,
    };
    if (!gmailConnection.hasRefreshToken) {
      gmailConnection.error =
        "No refresh token stored. Sign out and sign in again so Google issues one.";
    } else if (!gmailConnection.hasGmailScope) {
      gmailConnection.error =
        "Gmail permission missing — reconnect and tick the Gmail box on the consent screen.";
    }
  } else {
    gmailConnection.error = "No active Gmail connection. Connect a Gmail account.";
  }

  const gmailOauthValid =
    gmailConnection.present &&
    (gmailConnection.hasRefreshToken ?? false) &&
    (gmailConnection.hasGmailScope ?? false);

  const overall = envOk && dbResult.ok && workerResult.ok && gmailOauthValid;

  // Single discrete diagnosis, evaluated in dependency order so the FIRST
  // broken layer is what the operator sees — a cold worker shouldn't be
  // reported as "ready" just because OAuth is fine, and a scan-processing
  // regression shouldn't hide behind healthy infra. Codes are stable enough
  // to alert/branch on; `detail` is human-facing and secret-free.
  const diagnosis: { code: string; detail: string } = (() => {
    if (!envOk) {
      return { code: "ENV_MISCONFIGURED", detail: "One or more required environment variables are missing." };
    }
    if (!dbResult.ok) {
      return { code: "DB_UNREACHABLE", detail: "The application database did not respond." };
    }
    if (!gmailOauthValid) {
      return {
        code: "GMAIL_OAUTH_INVALID",
        detail:
          gmailConnection.error ??
          "The Gmail connection is missing, unauthorized, or lacks the gmail.readonly scope. Reconnect the Google account.",
      };
    }
    if (workerResult.state === "unreachable") {
      return {
        code: "WORKER_COLD_OR_UNREACHABLE",
        detail:
          "The scan worker did not answer its health probe. On the free tier it is most likely cold (spun down) and the first scan may need to wake it, or it is down/unreachable.",
      };
    }
    if (workerResult.state === "unhealthy" || !workerResult.ok) {
      return {
        code: "WORKER_UNAVAILABLE",
        detail: "The scan worker responded but reported an unhealthy status.",
      };
    }
    if (lastScan?.status === "FAILED") {
      return {
        code: "SCAN_PROCESSING_FAILURE",
        detail: `All scan dependencies are healthy, but the most recent scan failed: ${lastScan.errorMessage ?? "no error recorded"}`,
      };
    }
    return { code: "READY", detail: "All scan dependencies are healthy." };
  })();

  return NextResponse.json(
    {
      status: overall ? "ready" : "not_ready",
      diagnosis,
      env: { ok: envOk, vars: env },
      db: { ok: dbResult.ok, error: dbResult.error },
      worker: {
        ok: workerResult.ok,
        // "healthy" | "unhealthy" | "unreachable" — see checkWorkerHealth.
        state: workerResult.state,
        url: process.env.WORKER_URL ?? "(unset)",
        error: workerResult.error ?? null,
      },
      gmailConnection,
      lastScan: lastScan
        ? { status: lastScan.status, error: lastScan.errorMessage ?? null, createdAt: lastScan.createdAt.toISOString() }
        : null,
    },
    { status: overall ? 200 : 503 }
  );
}
