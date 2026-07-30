import { describe, expect, it } from "vitest";
import {
  PLATFORM_FEE_BP,
  assignmentValueCents,
  calculateFee,
  feeAdjustmentCents,
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

describe("feeAdjustmentCents", () => {
  it("is zero when the shift ran exactly as scheduled", () => {
    expect(feeAdjustmentCents(480, 480, 5000)).toBe(0);
  });

  it("refunds when the shift ran short", () => {
    // Scheduled 8h, worked 6h, €50/h. Fee drops from €24.20 to €18.15.
    expect(feeAdjustmentCents(480, 360, 5000)).toBe(-605);
  });

  it("charges more when the shift ran over", () => {
    // Scheduled 8h, worked 9h, €50/h. Fee rises from €24.20 to €27.23.
    expect(feeAdjustmentCents(480, 540, 5000)).toBe(303);
  });

  it("refunds the whole fee when the assignment produced no hours", () => {
    const charged = calculateFee(480, 5000).feeTotalCents;
    expect(feeAdjustmentCents(480, 0, 5000)).toBe(-charged);
  });

  /*
   * The adjustment must land the customer at exactly the fee for the hours they
   * actually worked — never a cent more, however the rounding fell on the way.
   */
  it("always reconciles to the fee for the actual hours", () => {
    for (const [scheduled, actual, rate] of [
      [480, 465, 4250],
      [465, 480, 3333],
      [240, 251, 1234],
      [600, 137, 9999],
    ]) {
      const charged = calculateFee(scheduled, rate).feeTotalCents;
      const adjustment = feeAdjustmentCents(scheduled, actual, rate);
      expect(charged + adjustment).toBe(calculateFee(actual, rate).feeTotalCents);
    }
  });
});
