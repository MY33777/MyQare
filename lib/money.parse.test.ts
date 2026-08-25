import { describe, expect, it } from "vitest";
import { parseEurosToCents } from "@/lib/money";

/*
 * A lone separator followed by three digits.
 *
 * parseEurosToCents resolved the two-separator case correctly and treated a
 * single separator as the decimal point every time — so "5.000", the format this
 * product's own screens print through formatEuros, parsed as € 5,00. The saldo
 * page renders the hint "maximaal € 5.000,00" three lines above the field.
 *
 * Both guards on the way to Stripe passed, because the number had already been
 * changed before either of them looked at it.
 */
describe("parseEurosToCents and the Dutch thousands separator", () => {
  const cases: [string, number | null][] = [
    // The defect, in the exact form the page invites.
    ["5.000", 500_000],
    ["10.000", 1_000_000],
    ["2.500", 250_000],
    ["5.000,00", 500_000],
    ["€ 5.000,00", 500_000],
    // The comma spelling of the same thing.
    ["5,000", 500_000],
    ["1,234.56", 123_456],
    // Cents still parse as cents.
    ["42,50", 4250],
    ["42.50", 4250],
    ["1,5", 150],
    ["0,05", 5],
    ["1.234,56", 123_456],
    // Plain integers are unaffected.
    ["5000", 500_000],
    ["50", 5000],
    // Nonsense stays nonsense.
    ["", null],
    ["abc", null],
    [",", null],
  ];

  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      expect(parseEurosToCents(input)).toBe(expected);
    });
  }

  /*
   * The reason this matters, stated as a test rather than a comment: the amount
   * that reaches Stripe is the amount that was typed. startTopupAction was
   * deliberately changed to refuse rather than clamp — "not a licence to change
   * what somebody asked for" — and the parser was changing it first, so the
   * refusal never fired.
   */
  it("does not turn a five-thousand-euro top-up into a five-euro one", () => {
    expect(parseEurosToCents("5.000")).not.toBe(500);
  });
});
