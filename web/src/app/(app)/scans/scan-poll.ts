/**
 * Pure polling schedule for <ScanProgress>. Extracted from the component so
 * the backoff/stop rules are unit-testable without a DOM — see
 * web/src/lib/__tests__/scan-poll-backoff.test.ts.
 */

/** Steady cadence while the scan is running and polls succeed. */
export const POLL_INTERVAL_MS = 1000;
/** Slow cadence while the tab is hidden (no fetch is made in that state). */
export const HIDDEN_POLL_INTERVAL_MS = 5000;
/** Ceiling for the exponential error backoff. */
export const MAX_POLL_BACKOFF_MS = 30_000;

/**
 * Next delay before polling again, or `null` to stop polling entirely.
 *
 *  - gone (404): the scan was deleted — stop forever.
 *  - hidden tab: reschedule slowly; the visibilitychange listener fires an
 *    immediate poll when the user returns.
 *  - healthy: steady 1s cadence (matches the server's progress-write throttle).
 *  - consecutive failures (network error / 5xx / 401): exponential backoff
 *    2s → 4s → 8s → … capped at 30s, reset on the next success.
 */
export function nextPollDelay(input: {
  gone: boolean;
  ok: boolean;
  failures: number;
  hidden: boolean;
}): number | null {
  if (input.gone) return null;
  if (input.hidden) return HIDDEN_POLL_INTERVAL_MS;
  if (input.ok) return POLL_INTERVAL_MS;
  // Clamp the exponent so absurd failure counts can't overflow to Infinity.
  const exp = Math.min(Math.max(input.failures, 1), 10);
  return Math.min(POLL_INTERVAL_MS * 2 ** exp, MAX_POLL_BACKOFF_MS);
}
