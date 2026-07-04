import { NextRequest, NextResponse } from "next/server";
import { keepWorkerWarm } from "@/lib/worker";

// Never statically cache — every invocation must actually reach the worker.
export const dynamic = "force-dynamic";
// Give a cold Render worker room to wake within the request window.
export const maxDuration = 60;

/**
 * Keep-alive cron. Pings the Python worker's /health so the Render free-tier
 * service never idles into a spin-down. Scheduled from web/vercel.json
 * (every 10 minutes — comfortably under Render's ~15min sleep threshold).
 *
 * Auth: when CRON_SECRET is set, Vercel Cron sends `Authorization: Bearer
 * <CRON_SECRET>` and we require it, so no arbitrary caller can drive the ping.
 * If CRON_SECRET is unset the endpoint stays open — the ping is idempotent and
 * exposes nothing beyond the already-public /api/health signal.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const result = await keepWorkerWarm();
  if (result.error) console.error("[keep-warm] worker ping failed:", result.error);

  return NextResponse.json(
    {
      pinged: "worker",
      worker: result.ok ? "warm" : "unavailable",
      status: result.status,
      authEnforced: Boolean(secret),
    },
    { status: result.ok ? 200 : 503 }
  );
}
