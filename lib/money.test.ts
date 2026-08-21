import { describe, expect, it } from "vitest";
import { applyRate, centsToEuroInput, formatEuros, parseEurosToCents } from "@/lib/money";

describe("applyRate", () => {
  it("applies a basis-point rate", () => {
    expect(applyRate(10_000, 500)).toBe(500); // 5% of €100
    expect(applyRate(10_000, 2100)).toBe(2_100); // 21% of €100
  });

  it("rounds half-up", () => {
    // 5% of €33.33 is 166.65 cents.
    expect(applyRate(3_333, 500)).toBe(167);
  });

  it("rounds a reversal symmetrically, so a refund matches its charge", () => {
    expect(applyRate(-3_333, 500)).toBe(-167);
    expect(applyRate(-3_333, 500)).toBe(-applyRate(3_333, 500));
  });

  it("rejects fractional cents instead of silently rounding them", () => {
    expect(() => applyRate(100.5, 500)).toThrow();
  });

  it("is zero at a zero rate or a zero amount", () => {
    expect(applyRate(10_000, 0)).toBe(0);
    expect(applyRate(0, 2100)).toBe(0);
  });
});

describe("formatEuros", () => {
  it("uses Dutch separators", () => {
    // Non-breaking spaces vary by ICU build, so compare on the digits.
    expect(formatEuros(123_456).replace(/\s/g, " ")).toContain("1.234,56");
    expect(formatEuros(2_420).replace(/\s/g, " ")).toContain("24,20");
  });

  it("always shows two decimals", () => {
    expect(formatEuros(5_000)).toContain("50,00");
  });
});

describe("parseEurosToCents", () => {
  it("accepts a Dutch comma decimal", () => {
    expect(parseEurosToCents("42,50")).toBe(4_250);
  });

  it("accepts an English dot decimal", () => {
    expect(parseEurosToCents("42.50")).toBe(4_250);
  });

  it("handles Dutch thousands grouping", () => {
    expect(parseEurosToCents("1.234,56")).toBe(123_456);
  });

  it("handles English thousands grouping", () => {
    expect(parseEurosToCents("1,234.56")).toBe(123_456);
  });

  it("tolerates a euro sign and surrounding space", () => {
    expect(parseEurosToCents(" € 42,50 ")).toBe(4_250);
  });

  it("accepts a whole number", () => {
    expect(parseEurosToCents("50")).toBe(5_000);
  });

  /*
   * The important half. An unparseable rate has to stop the form — returning 0
   * would quietly turn a typo into unpaid work.
   */
  it("returns null for unusable input", () => {
    expect(parseEurosToCents("")).toBeNull();
    expect(parseEurosToCents("   ")).toBeNull();
    expect(parseEurosToCents("abc")).toBeNull();
    expect(parseEurosToCents("42,5o")).toBeNull();
    expect(parseEurosToCents(".")).toBeNull();
    expect(parseEurosToCents("-")).toBeNull();
  });
});

describe("centsToEuroInput", () => {
  /*
   * Prefills a form field rather than a screen, so it round-trips through
   * parseEurosToCents. A point instead of a comma there would turn € 42,50 into
   * four thousand two hundred and fifty euros on a copied shift.
   */
  it.each([
    [4250, "42,50"],
    [4200, "42,00"],
    [100, "1,00"],
    [5, "0,05"],
    [0, "0,00"],
    [123456, "1234,56"],
  ])("renders %i cents as %s", (cents, expected) => {
    expect(centsToEuroInput(cents)).toBe(expected);
  });

  it("round-trips through parseEurosToCents", () => {
    for (const cents of [4250, 100, 5, 999999]) {
      expect(parseEurosToCents(centsToEuroInput(cents))).toBe(cents);
    }
  });

  it("gives an empty string for nonsense rather than NaN in a form field", () => {
    expect(centsToEuroInput(Number.NaN)).toBe("");
    expect(centsToEuroInput(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("carries no currency symbol", () => {
    // formatEuros renders "€ 42,50", which is right on a screen and wrong in an
    // input: the parser would have to strip it back off.
    expect(centsToEuroInput(4250)).not.toContain("€");
  });
});
