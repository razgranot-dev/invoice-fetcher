/**
 * M4/S8 regression guard — polling schedule for <ScanProgress>.
 *
 * The component previously polled every 1s forever: after a 404 (scan
 * deleted), through network outages, and in hidden background tabs. The
 * schedule now lives in the pure helper nextPollDelay(); these tests pin
 * its stop/backoff/pause rules.
 */

import { describe, test, expect } from "vitest";
import {
  nextPollDelay,
  POLL_INTERVAL_MS,
  HIDDEN_POLL_INTERVAL_MS,
  MAX_POLL_BACKOFF_MS,
} from "@/app/(app)/scans/scan-poll";

describe("nextPollDelay", () => {
  test("healthy poll keeps the steady 1s cadence", () => {
    expect(nextPollDelay({ gone: false, ok: true, failures: 0, hidden: false })).toBe(
      POLL_INTERVAL_MS
    );
  });

  test("404 (scan gone) stops polling permanently", () => {
    expect(nextPollDelay({ gone: true, ok: false, failures: 0, hidden: false })).toBeNull();
    // gone wins over every other input
    expect(nextPollDelay({ gone: true, ok: true, failures: 5, hidden: true })).toBeNull();
  });

  test("hidden tab idles at the slow cadence instead of fetching", () => {
    expect(nextPollDelay({ gone: false, ok: true, failures: 0, hidden: true })).toBe(
      HIDDEN_POLL_INTERVAL_MS
    );
    // even while in an error streak, hidden tabs just idle
    expect(nextPollDelay({ gone: false, ok: false, failures: 4, hidden: true })).toBe(
      HIDDEN_POLL_INTERVAL_MS
    );
  });

  test("consecutive failures back off exponentially: 2s, 4s, 8s, 16s", () => {
    expect(nextPollDelay({ gone: false, ok: false, failures: 1, hidden: false })).toBe(2000);
    expect(nextPollDelay({ gone: false, ok: false, failures: 2, hidden: false })).toBe(4000);
    expect(nextPollDelay({ gone: false, ok: false, failures: 3, hidden: false })).toBe(8000);
    expect(nextPollDelay({ gone: false, ok: false, failures: 4, hidden: false })).toBe(16000);
  });

  test("backoff caps at 30s", () => {
    expect(nextPollDelay({ gone: false, ok: false, failures: 5, hidden: false })).toBe(
      MAX_POLL_BACKOFF_MS
    );
    expect(nextPollDelay({ gone: false, ok: false, failures: 10, hidden: false })).toBe(
      MAX_POLL_BACKOFF_MS
    );
  });

  test("absurd failure counts stay finite (no 2**1000 overflow)", () => {
    const d = nextPollDelay({ gone: false, ok: false, failures: 1000, hidden: false });
    expect(d).toBe(MAX_POLL_BACKOFF_MS);
    expect(Number.isFinite(d)).toBe(true);
  });

  test("a failure with a zero counter still backs off (minimum one step)", () => {
    // Defensive: the component increments before scheduling, but a direct
    // ok:false/failures:0 call must never return the healthy cadence.
    expect(nextPollDelay({ gone: false, ok: false, failures: 0, hidden: false })).toBe(2000);
  });

  test("success after an error streak resets to the steady cadence", () => {
    // The component resets failuresRef to 0 on success; a healthy poll with
    // any stale counter value still returns the steady interval.
    expect(nextPollDelay({ gone: false, ok: true, failures: 7, hidden: false })).toBe(
      POLL_INTERVAL_MS
    );
  });
});
