/**
 * CSV formula-injection guard (M18).
 *
 * The old escapeCsv treated ANY leading '-' or '+' as dangerous, so every
 * negative amount exported as '-12.50 — a TEXT cell that silently breaks
 * Excel SUM over the Amount column. The guard must:
 *   • always escape leading '=', '@', tab, CR (real formula/DDE vectors),
 *   • escape leading '+'/'-' ONLY when the value is not a plain number.
 */
import { describe, test, expect } from "vitest";
import { escapeCsvField, buildCsvContent } from "../csv";

describe("escapeCsvField — numeric values pass through", () => {
  test("negative decimal amount stays a numeric cell (the M18 bug)", () => {
    expect(escapeCsvField("-12.50")).toBe("-12.50");
  });

  test("positive-signed and integer amounts stay numeric", () => {
    expect(escapeCsvField("+3.10")).toBe("+3.10");
    expect(escapeCsvField("-5")).toBe("-5");
    expect(escapeCsvField("42")).toBe("42");
    expect(escapeCsvField("0.99")).toBe("0.99");
  });
});

describe("escapeCsvField — formula vectors are escaped", () => {
  test("leading '=' is always escaped", () => {
    expect(escapeCsvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsvField("=1+1")).toBe("'=1+1");
  });

  test("leading '@' is always escaped", () => {
    expect(escapeCsvField("@import")).toBe("'@import");
  });

  test("leading tab is escaped (then quoted only if it contains separators)", () => {
    expect(escapeCsvField("\tcmd")).toBe("'\tcmd");
  });

  test("leading CR is escaped and quoted (CR is also a line separator)", () => {
    expect(escapeCsvField("\rcmd")).toBe('"\'\rcmd"');
  });

  test("sign-prefixed NON-numbers stay escaped — the whitelist is strict", () => {
    expect(escapeCsvField("-2+3+cmd")).toBe("'-2+3+cmd");
    expect(escapeCsvField("-1+1")).toBe("'-1+1");
    expect(escapeCsvField("+CMD()")).toBe("'+CMD()");
    expect(escapeCsvField("-12.50e")).toBe("'-12.50e");
    expect(escapeCsvField("-12.50.7")).toBe("'-12.50.7");
    expect(escapeCsvField("+")).toBe("'+");
    expect(escapeCsvField("-")).toBe("'-");
  });
});

describe("escapeCsvField — standard CSV quoting still applies", () => {
  test("comma-containing values are quoted", () => {
    expect(escapeCsvField("Acme, Inc")).toBe('"Acme, Inc"');
  });

  test("embedded quotes are doubled", () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  test("newlines force quoting", () => {
    expect(escapeCsvField("a\nb")).toBe('"a\nb"');
  });

  test("plain text and empty string pass through untouched", () => {
    expect(escapeCsvField("Anthropic")).toBe("Anthropic");
    expect(escapeCsvField("")).toBe("");
  });

  test("dangerous value that ALSO contains a comma gets escaped then quoted", () => {
    expect(escapeCsvField("=SUM(A1,B1)")).toBe('"\'=SUM(A1,B1)"');
  });
});

describe("buildCsvContent", () => {
  test("prepends UTF-8 BOM, joins with CRLF, guards every field", () => {
    const csv = buildCsvContent(
      ["Company", "Amount"],
      [
        ["Acme", "-12.50"],
        ["=EvilCo", "+3"],
      ]
    );
    expect(csv).toBe(
      "\uFEFF" + "Company,Amount\r\nAcme,-12.50\r\n'=EvilCo,+3"
    );
  });

  test("empty rows produce just the header line", () => {
    expect(buildCsvContent(["A", "B"], [])).toBe("\uFEFF" + "A,B");
  });
});
