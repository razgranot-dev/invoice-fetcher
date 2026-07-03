/**
 * CSV serialization helpers — extracted from the CSV export route so the
 * formula-injection guard is unit-testable (web/src/lib/__tests__/csv.test.ts).
 *
 * Formula-injection contract (M18):
 *   • A leading '=', '@', tab or CR is ALWAYS escaped with a leading
 *     apostrophe — Excel/Sheets would otherwise evaluate the cell.
 *   • A leading '+' or '-' is escaped ONLY when the value is not a plain
 *     number. '-12.50' must stay a numeric cell (SUM-able); '-2+3' or
 *     '+CMD(...)' must not.
 */

/** Strictly anchored so '-1+1', '-12.50e' etc. do NOT qualify as numbers. */
const PLAIN_NUMBER_RE = /^[-+]?\d+(\.\d+)?$/;

export function escapeCsvField(value: string): string {
  let safe = value;
  if (safe.length > 0) {
    const first = safe[0];
    const alwaysDangerous =
      first === "=" || first === "@" || first === "\t" || first === "\r";
    const signDangerous =
      (first === "+" || first === "-") && !PLAIN_NUMBER_RE.test(safe);
    if (alwaysDangerous || signDangerous) {
      safe = "'" + safe;
    }
  }
  if (
    safe.includes(",") ||
    safe.includes('"') ||
    safe.includes("\n") ||
    safe.includes("\r")
  ) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/**
 * Assemble a complete CSV document: UTF-8 BOM (Excel compatibility), CRLF
 * line endings, every field run through the formula guard.
 */
export function buildCsvContent(headers: string[], rows: string[][]): string {
  return (
    "\uFEFF" +
    [
      headers.map(escapeCsvField).join(","),
      ...rows.map((row) => row.map(escapeCsvField).join(",")),
    ].join("\r\n")
  );
}
