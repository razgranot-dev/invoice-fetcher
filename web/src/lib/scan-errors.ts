/**
 * Scan error sanitization — the single source of truth for converting a raw
 * worker/dispatch error into a user-safe message. Used by BOTH error paths
 * in web/src/app/api/scans/route.ts (the thrown-error catch block and the
 * worker `result.error` branch) so they can never drift apart again.
 *
 * Behaviour:
 *   • AUTH_ERROR → preserved (scope URLs intact) and prefixed with a
 *     user-actionable "Gmail authentication failed." message.
 *   • dispatch timeout → the opaque AbortSignal.timeout message
 *     ("The operation was aborted due to timeout") is rewritten into a
 *     precise, actionable diagnostic that names the stage and likely cause.
 *   • otherwise  → file paths and connection URIs scrubbed, length-capped.
 *
 * Unit tested in web/src/lib/__tests__/scan-auth-errors.test.ts.
 */
export function sanitizeScanError(raw: string): string {
  // If the worker reported an AUTH_ERROR, extract it cleanly and tell the
  // user to reconnect. AUTH_ERROR strings contain scope URLs which the
  // generic path-stripping regex below would mangle into "[path]".
  const authMatch = raw.match(/AUTH_ERROR:?\s*([^"}]+)/i);
  if (authMatch) {
    return ("Gmail authentication failed. " + authMatch[1].trim()).slice(0, 400);
  }
  // The Vercel→worker dispatch fetch is aborted by AbortSignal.timeout
  // (SCAN_DISPATCH_TIMEOUT_MS = 270s in @/lib/worker) when the worker never
  // returns a readable response — almost always a cold-starting or unavailable
  // Render worker, since a live worker streams its first NDJSON line in
  // seconds. The raw DOMException message ("The operation was aborted due to
  // timeout") tells the user nothing; replace it with a precise diagnostic.
  // Matches ONLY the timeout-abort wording — a user cancellation is handled
  // upstream (route.ts returns before sanitizing) and never reaches here.
  if (/aborted due to timeout/i.test(raw)) {
    return (
      "Scan worker did not respond within 270s, so no emails were processed. " +
      "The scan service was most likely cold-starting or temporarily " +
      "unavailable. Please retry in about a minute; if it keeps failing, " +
      "the worker may be down."
    );
  }
  // Sanitize: strip internal paths, connection strings, and stack traces
  // before persisting — this message is returned to the client.
  return raw
    .replace(/(?:\/[^\s:]+)+/g, "[path]") // file paths
    .replace(/(?:postgres|mysql|redis|mongodb)\S+/gi, "[redacted]") // connection URIs
    .slice(0, 300);
}
