import { describe, expect, it } from "vitest";
import {
  PLATFORM_FEE_BP,
  assignmentValueCents,
  calculateFee,
  FEE_PERCENT_LABEL,
  VAT_PERCENT_LABEL,
  FEE_INCL_VAT_PERCENT_LABEL,
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
   * A €400 day. The 2021 plan assumed 5%, which came to €24.20 including VAT;
   * the fee is now 1,5%, so the same day costs €7.26. If this test fails, the
   * product is no longer charging what it tells customers it charges.
   */
  it("charges €7.26 on a €400 day", () => {
    const fee = calculateFee(480, 5000);
    expect(fee.assignmentValueCents).toBe(40_000);
    expect(fee.feeExVatCents).toBe(600);
    expect(fee.feeVatCents).toBe(126);
    expect(fee.feeTotalCents).toBe(726);
  });

  it("is 1,5% before VAT", () => {
    expect(PLATFORM_FEE_BP).toBe(150);
    const fee = calculateFee(60, 10_000); // 1h @ €100
    expect(fee.feeExVatCents).toBe(150);
  });

  it("rounds half-up on awkward amounts", () => {
    // 1h @ €33.33 = 3333c. 1,5% = 49.995 → 50. 21% of 50 = 10.5 → 11.
    const fee = calculateFee(60, 3_333);
    expect(fee.feeExVatCents).toBe(50);
    expect(fee.feeVatCents).toBe(11);
    expect(fee.feeTotalCents).toBe(61);
  });

  /*
   * The number a freelancer actually feels. Guards against the fee quietly
   * drifting back up: the public pages compute their percentage from
   * PLATFORM_FEE_BP, so this is what they would start printing.
   */
  it("costs 1,815% of the assignment value all-in", () => {
    const fee = calculateFee(480, 5000);
    const allIn = (fee.feeTotalCents / fee.assignmentValueCents) * 100;
    expect(allIn).toBeCloseTo(1.815, 3);
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

describe("the percentages a customer reads", () => {
  /*
   * Six public pages used to derive these themselves. That was invisible while
   * the fee was the integer 5 and became "1.5%" — a decimal point in a Dutch
   * price — the moment it was not. It is also the shape that let the payment term
   * silently halve: one rule, written down twice.
   */
  it("formats the fee the Dutch way", () => {
    expect(FEE_PERCENT_LABEL).toBe("1,5");
    expect(VAT_PERCENT_LABEL).toBe("21");
  });

  it("states the all-in figure without rounding it down", () => {
    // 1,815%. Rounding to 1,82 would quote above what is charged; to 1,81 below.
    expect(FEE_INCL_VAT_PERCENT_LABEL).toBe("1,815");
  });

  it("never prints a decimal point", () => {
    for (const label of [FEE_PERCENT_LABEL, VAT_PERCENT_LABEL, FEE_INCL_VAT_PERCENT_LABEL]) {
      expect(label).not.toContain(".");
    }
  });

  it("agrees with what calculateFee actually charges", () => {
    const fee = calculateFee(480, 5000);
    const allIn = ((fee.feeTotalCents / fee.assignmentValueCents) * 100).toFixed(3).replace(".", ",");
    expect(allIn).toBe(FEE_INCL_VAT_PERCENT_LABEL);
  });
});

describe("settling at the rate that was agreed", () => {
  /*
   * The fee dropped from 5% to 1,5% mid-flight. approveTimesheet recomputed what
   * was owed with whatever PLATFORM_FEE_BP happened to be at approval time, so
   * every assignment accepted before the change and approved after it re-priced
   * downwards — and settle_timesheet, which derives its movement from the ledger,
   * dutifully refunded the difference. Money somebody had agreed to pay, handed
   * back because a constant moved.
   *
   * It runs the other way on an increase, which is worse: a charge nobody agreed
   * to, against a prepaid balance, after the work is done.
   */
  it("prices an old assignment at its own rate, not today's", () => {
    const atFivePercent = calculateFee(480, 5000, 500);
    expect(atFivePercent.feeExVatCents).toBe(2_000);
    expect(atFivePercent.feeTotalCents).toBe(2_420);

    // The same work under the current rate, for contrast.
    expect(calculateFee(480, 5000).feeTotalCents).toBe(726);
  });

  it("defaults to the current rate when none is given", () => {
    expect(calculateFee(480, 5000, PLATFORM_FEE_BP)).toEqual(calculateFee(480, 5000));
  });
});
