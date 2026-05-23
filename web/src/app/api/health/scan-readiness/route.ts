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

  const [dbResult, workerResult, connection] = await Promise.all([
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

  const overall =
    envOk && dbResult.ok && workerResult.ok && gmailConnection.present && (gmailConnection.hasGmailScope ?? false);

  return NextResponse.json(
    {
      status: overall ? "ready" : "not_ready",
      env: { ok: envOk, vars: env },
      db: { ok: dbResult.ok, error: dbResult.error },
      worker: {
        ok: workerResult.ok,
        url: process.env.WORKER_URL ?? "(unset)",
        error: workerResult.error ?? null,
      },
      gmailConnection,
    },
    { status: overall ? 200 : 503 }
  );
}
