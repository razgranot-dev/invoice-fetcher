import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkWorkerHealth } from "@/lib/worker";

export async function GET() {
  const [dbCheck, workerCheck] = await Promise.all([
    db
      .$queryRaw`SELECT 1`
      .then(() => ({ ok: true, error: undefined }))
      .catch((e: Error) => ({ ok: false, error: e.message })),
    checkWorkerHealth(),
  ]);

  // DB is required for the web app to function; worker is an external service
  // that can be independently unavailable without making the web app "unhealthy"
  const healthy = dbCheck.ok;

  // Only expose status booleans publicly — error details are logged server-side
  if (dbCheck.error) console.error("[health] DB error:", dbCheck.error);
  if (workerCheck.error) console.error("[health] Worker error:", workerCheck.error);

  return NextResponse.json(
    {
      status: healthy ? (workerCheck.ok ? "ok" : "degraded") : "unhealthy",
      db: dbCheck.ok ? "connected" : "disconnected",
      worker: workerCheck.ok ? "connected" : "unavailable",
    },
    { status: healthy ? 200 : 503 }
  );
}
