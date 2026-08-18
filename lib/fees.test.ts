import { describe, expect, it } from "vitest";
import {
  PLATFORM_FEE_BP,
  assignmentValueCents,
  calculateFee,
} from "@/lib/fees";

describe("assignmentValueCents", () => {
  it("multiplies whole hours by the rate", () => {
    expect(assignmentValueCents(480, 5000)).toBe(40_000); // 8h @ €50 = €400
  });

  it("handles part hours without losing cents to a rounded duration", () => {
    // 7h45 at €42.50. 465 min × 4250 / 60 = 32_937.5 → half-up to 32_938.
    expect(assignmentValueCents(465, 4250)).toBe(32_938);
  });

  it("is zero for a zero-length assignment", () => {
    expect(assignmentValueCents(0, 5000)).toBe(0);
  });

  it("rejects non-integer or negative input rather than coercing it", () => {
    expect(() => assignmentValueCents(1.5, 5000)).toThrow();
    expect(() => assignmentValueCents(-60, 5000)).toThrow();
    expect(() => assignmentValueCents(60, -1)).toThrow();
  });
});

describe("calculateFee", () => {
  /*
   * The worked example straight out of the 2021 business plan: a €400 day yields
   * a €20 fee, €24.20 including VAT. If this test ever fails, the product is no
   * longer charging what it tells customers it charges.
   */
  it("reproduces the €400 → €24.20 example from the business plan", () => {
    const fee = calculateFee(480, 5000);
    expect(fee.assignmentValueCents).toBe(40_000);
    expect(fee.feeExVatCents).toBe(2_000);
    expect(fee.feeVatCents).toBe(420);
    expect(fee.feeTotalCents).toBe(2_420);
  });

  it("is 5% before VAT", () => {
    expect(PLATFORM_FEE_BP).toBe(500);
    const fee = calculateFee(60, 10_000); // 1h @ €100
    expect(fee.feeExVatCents).toBe(500);
  });

  it("rounds half-up on awkward amounts", () => {
    // 1h @ €33.33 = 3333c. 5% = 166.65 → 167. 21% of 167 = 35.07 → 35.
    const fee = calculateFee(60, 3_333);
    expect(fee.feeExVatCents).toBe(167);
    expect(fee.feeVatCents).toBe(35);
    expect(fee.feeTotalCents).toBe(202);
  });

  it("charges nothing on a zero-value assignment", () => {
    expect(calculateFee(0, 5000).feeTotalCents).toBe(0);
  });

  it("never returns a fractional cent", () => {
    for (let minutes = 1; minutes <= 720; minutes += 7) {
      for (const rate of [1234, 2500, 3333, 4250, 9999]) {
        const fee = calculateFee(minutes, rate);
        expect(Number.isInteger(fee.feeExVatCents)).toBe(true);
        expect(Number.isInteger(fee.feeVatCents)).toBe(true);
        expect(Number.isInteger(fee.feeTotalCents)).toBe(true);
      }
    }
  });
});
