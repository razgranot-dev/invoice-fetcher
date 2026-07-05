import { NextRequest, NextResponse } from "next/server";
import { keepWorkerWarm } from "@/lib/worker";

// Never statically cache — every invocation must actually reach the worker.
export const dynamic = "force-dynamic";
// Give a cold Render worker room to wake within the request window.
export const maxDuration = 60;

/**
 * Keep-alive cron. Pings the Python worker's /health so the Render free-tier
 * service is less likely to idle into a spin-down.
 *
 * IMPORTANT (platform limit): this project is on Vercel Hobby, which rejects
 * any cron that runs more than once per day — a sub-daily schedule (e.g.
 * `*/10 * * * *`) makes EVERY deploy fail validation. web/vercel.json is
 * therefore pinned to a daily schedule (`0 0 * * *`), which is only a
 * best-effort safety net and does NOT keep the worker warm against Render's
 * ~15min sleep threshold. The real keep-warm is an EXTERNAL uptime monitor
 * (UptimeRobot / cron-job.org) pinging the worker's /health directly every
 * ~10 min. Do not restore a sub-daily schedule here unless the account is on
 * Vercel Pro.
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
