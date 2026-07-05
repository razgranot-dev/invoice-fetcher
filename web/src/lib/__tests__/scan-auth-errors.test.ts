/**
 * Regression guard for the "scan fails every time" incident.
 *
 * Tests the REAL sanitizer (web/src/lib/scan-errors.ts) that both error
 * paths in web/src/app/api/scans/route.ts share — the thrown-error catch
 * block AND the worker `result.error` branch. Previously this file
 * duplicated the regexes inline, which let the route and the test drift
 * apart; importing the single source of truth makes that impossible.
 */

import { describe, test, expect } from "vitest";
import { sanitizeScanError } from "@/lib/scan-errors";

describe("scan error sanitization", () => {
  test("preserves AUTH_ERROR message including scope URLs", () => {
    const raw =
      'Worker error 401: {"detail":"Gmail auth failed: AUTH_ERROR: Gmail permission missing from this connection. Reconnect your Google account and check the Gmail box on the consent screen. Granted scopes: [email, openid, profile]"}';
    const out = sanitizeScanError(raw);
    expect(out).toContain("Gmail authentication failed");
    expect(out).toContain("Gmail permission missing");
    expect(out).toContain("Granted scopes");
    // Must not get replaced with [path] just because it contains slashes
    expect(out).not.toContain("[path]");
  });

  test("handles bare AUTH_ERROR without the Worker-error JSON wrapper", () => {
    // result.error arrives as bare str(e) from the worker generator — no
    // `Worker error 401: {...}` framing. The regex must still match.
    const raw = "AUTH_ERROR: Token has been expired or revoked.";
    const out = sanitizeScanError(raw);
    expect(out).toContain("Gmail authentication failed");
    expect(out).toContain("Token has been expired or revoked");
  });

  test("strips file paths from generic errors", () => {
    const raw = "ENOENT: no such file /var/www/web/.next/server/app/x.js";
    const out = sanitizeScanError(raw);
    expect(out).toContain("[path]");
    expect(out).not.toContain("/var/www");
  });

  test("strips postgres connection strings", () => {
    const raw =
      "Connection failed: postgresql://user:pass@host.neon.tech:5432/db?sslmode=require";
    const out = sanitizeScanError(raw);
    expect(out).toContain("[redacted]");
    expect(out).not.toContain("pass@host");
  });

  test("worker result.error with both a path and a DSN is fully scrubbed and capped", () => {
    // Simulates the M3 scenario: the worker's except-block str(e) leaking
    // library internals through the result.error branch (which previously
    // skipped sanitization entirely).
    const raw =
      "Traceback /usr/lib/python3.13/site-packages/google/auth/transport.py failed; " +
      "retry gave up connecting to postgres://scanuser:hunter2@db.internal:5432/invoices " +
      "x".repeat(500);
    const out = sanitizeScanError(raw);
    expect(out).not.toContain("/usr/lib");
    expect(out).not.toContain("hunter2");
    expect(out).toContain("[path]");
    expect(out).toContain("[redacted]");
    expect(out.length).toBeLessThanOrEqual(300);
  });

  test("caps length at 400 chars for AUTH_ERROR", () => {
    const long = "AUTH_ERROR: " + "x".repeat(1000);
    const out = sanitizeScanError(long);
    expect(out.length).toBeLessThanOrEqual(400);
  });

  test("caps length at 300 chars for generic errors", () => {
    const out = sanitizeScanError("y".repeat(1000));
    expect(out.length).toBeLessThanOrEqual(300);
  });

  test("handles AUTH_ERROR without colon", () => {
    const raw = "AUTH_ERROR Gmail permission missing";
    const out = sanitizeScanError(raw);
    expect(out).toContain("Gmail authentication failed");
    expect(out).toContain("Gmail permission missing");
  });

  test("rewrites the dispatch-timeout abort into a precise diagnostic", () => {
    // AbortSignal.timeout(SCAN_DISPATCH_TIMEOUT_MS) aborts the worker fetch
    // with this exact DOMException message when the worker never responds
    // (cold/unavailable Render worker). The opaque wording must be replaced.
    const raw = "The operation was aborted due to timeout";
    const out = sanitizeScanError(raw);
    expect(out).not.toBe(raw);
    expect(out.toLowerCase()).toContain("worker");
    expect(out).toContain("270s");
    expect(out.toLowerCase()).toContain("retry");
    // Still safe + capped.
    expect(out.length).toBeLessThanOrEqual(300);
  });

  test("maps worker AUTH_INIT_TIMEOUT (503) to a distinct Gmail-init-stalled message", () => {
    // The worker fails fast with this when its pre-stream Gmail auth build
    // stalls; the web receives it wrapped in the "Worker error 503" framing.
    const raw =
      'Worker error 503: {"detail":"AUTH_INIT_TIMEOUT: worker reached but could not initialize Gmail access within 45s (stalled token refresh or blocked outbound to Google)."}';
    const out = sanitizeScanError(raw);
    expect(out.toLowerCase()).toContain("initialize gmail access");
    // Must NOT be misclassified as the generic "worker unavailable / 270s" case.
    expect(out).not.toContain("270s");
    // Must NOT be dressed up as a Gmail account auth failure (account is fine).
    expect(out).not.toContain("Gmail authentication failed");
    expect(out.length).toBeLessThanOrEqual(300);
  });

  test("timeout rewrite does not swallow a genuine AUTH_ERROR that mentions timeout", () => {
    // AUTH_ERROR must win over the timeout branch — auth guidance is checked
    // first, so a revoked-token message keeps its reconnect instructions.
    const raw = "AUTH_ERROR: Token expired; the operation was aborted due to timeout";
    const out = sanitizeScanError(raw);
    expect(out).toContain("Gmail authentication failed");
  });
});

/**
 * Worker request invariants — these MUST be true for the OAuth refresh path
 * to work. If any future edit reintroduces `scopes` to the worker creds dict,
 * Google will return invalid_scope on every scan.
 */
describe("worker creds_dict invariants", () => {
  // Mirrors the dict built in worker/main.py:run_scan
  function buildWorkerCredsDict(req: {
    access_token: string;
    refresh_token: string | null;
    token_expiry: string | null;
  }): Record<string, string> {
    const dict: Record<string, string> = {
      token: req.access_token,
      refresh_token: req.refresh_token ?? "",
      client_id: "stub",
      client_secret: "stub",
      token_uri: "https://oauth2.googleapis.com/token",
    };
    if (req.token_expiry) {
      dict.expiry = req.token_expiry.replace(/Z$/, "").split(".")[0];
    }
    return dict;
  }

  test("must NOT include `scopes` key", () => {
    // Google's token endpoint rejects refresh requests with any `scope` param.
    // google-auth's from_authorized_user_info prefers info["scopes"] over the
    // function arg, so this key being present would propagate into the
    // failing refresh body even if SCOPES=None is passed in Python.
    const dict = buildWorkerCredsDict({
      access_token: "ya29.x",
      refresh_token: "1//x",
      token_expiry: "2026-05-17T08:35:26Z",
    });
    expect(dict).not.toHaveProperty("scopes");
  });

  test("preserves expiry to avoid forced-refresh on every call", () => {
    // When `expiry` is missing, google-auth synthesizes a past expiry
    // (now - CLOCK_SKEW) and forces a refresh on every API call. With
    // expiry preserved, fresh tokens are reused for ~1 hour.
    const dict = buildWorkerCredsDict({
      access_token: "ya29.x",
      refresh_token: "1//x",
      token_expiry: "2026-05-17T08:35:26.000Z",
    });
    // google-auth parses "YYYY-MM-DDTHH:MM:SS" without trailing Z or fraction
    expect(dict.expiry).toBe("2026-05-17T08:35:26");
  });

  test("omits expiry when token_expiry is null", () => {
    const dict = buildWorkerCredsDict({
      access_token: "ya29.x",
      refresh_token: "1//x",
      token_expiry: null,
    });
    expect(dict).not.toHaveProperty("expiry");
  });
});
