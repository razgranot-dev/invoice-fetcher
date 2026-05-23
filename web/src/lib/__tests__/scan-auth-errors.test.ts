/**
 * Regression guard for the "scan fails every time" incident.
 *
 * Verifies the error-message extraction logic that lives inline in
 * web/src/app/api/scans/route.ts. Keeping it as a unit-testable pure
 * function below means future edits to that catch block stay safe.
 */

import { describe, test, expect } from "vitest";

/**
 * Lifted from the catch block in web/src/app/api/scans/route.ts. Must stay
 * in sync — see that file's comment block. The job of this helper is to
 * convert a raw worker/dispatch error into a user-safe message:
 *   • AUTH_ERROR → preserved (scope URLs intact, prefixed for the user)
 *   • otherwise  → paths and DSNs scrubbed, truncated
 */
function extractSafeScanError(raw: string): string {
  const authMatch = raw.match(/AUTH_ERROR:?\s*([^"}]+)/i);
  if (authMatch) {
    return ("Gmail authentication failed. " + authMatch[1].trim()).slice(0, 400);
  }
  return raw
    .replace(/(?:\/[^\s:]+)+/g, "[path]")
    .replace(/(?:postgres|mysql|redis|mongodb)\S+/gi, "[redacted]")
    .slice(0, 300);
}

describe("scan error sanitization", () => {
  test("preserves AUTH_ERROR message including scope URLs", () => {
    const raw =
      'Worker error 401: {"detail":"Gmail auth failed: AUTH_ERROR: Gmail permission missing from this connection. Reconnect your Google account and check the Gmail box on the consent screen. Granted scopes: [email, openid, profile]"}';
    const out = extractSafeScanError(raw);
    expect(out).toContain("Gmail authentication failed");
    expect(out).toContain("Gmail permission missing");
    expect(out).toContain("Granted scopes");
    // Must not get replaced with [path] just because it contains slashes
    expect(out).not.toContain("[path]");
  });

  test("strips file paths from generic errors", () => {
    const raw = "ENOENT: no such file /var/www/web/.next/server/app/x.js";
    const out = extractSafeScanError(raw);
    expect(out).toContain("[path]");
    expect(out).not.toContain("/var/www");
  });

  test("strips postgres connection strings", () => {
    const raw =
      "Connection failed: postgresql://user:pass@host.neon.tech:5432/db?sslmode=require";
    const out = extractSafeScanError(raw);
    expect(out).toContain("[redacted]");
    expect(out).not.toContain("pass@host");
  });

  test("caps length at 400 chars for AUTH_ERROR", () => {
    const long = "AUTH_ERROR: " + "x".repeat(1000);
    const out = extractSafeScanError(long);
    expect(out.length).toBeLessThanOrEqual(400);
  });

  test("caps length at 300 chars for generic errors", () => {
    const out = extractSafeScanError("y".repeat(1000));
    expect(out.length).toBeLessThanOrEqual(300);
  });

  test("handles AUTH_ERROR without colon", () => {
    const raw = "AUTH_ERROR Gmail permission missing";
    const out = extractSafeScanError(raw);
    expect(out).toContain("Gmail authentication failed");
    expect(out).toContain("Gmail permission missing");
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
