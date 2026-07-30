import { applyRate, type BasisPoints } from "@/lib/money";

/*
 * MyQare's revenue: a percentage of each assignment, paid by the freelancer out
 * of a prepaid credit balance. The facility pays nothing.
 *
 * NOTE — worth revisiting before launch. Charging the freelancer is what the
 * 2021 plan specified, but it is also the weaker position on two counts:
 * facilities are far less price-sensitive, and taking a cut of the freelancer's
 * earnings makes us look more like *their* agency, which is the exact
 * schijnzelfstandigheid appearance the rest of the product works to avoid.
 * Changing it later means changing this constant and who the ledger charges,
 * which is why the fee lives in one place.
 */
export const PLATFORM_FEE_BP: BasisPoints = 500; // 5%

/** Dutch standard VAT rate, applied to our own fee. Always — we are not a medical service. */
export const VAT_STANDARD_BP: BasisPoints = 2100; // 21%

export type FeeBreakdown = {
  /** Hours × rate: what the facility owes the freelancer, before our fee. */
  assignmentValueCents: number;
  feeExVatCents: number;
  feeVatCents: number;
  /** What actually comes off the credit balance. */
  feeTotalCents: number;
};

/**
 * Billable value of an assignment.
 *
 * Minutes rather than hours throughout: a shift that ran 7h45 is exactly 465
 * minutes and a recurring decimal in hours, and rounding the *duration* before
 * multiplying by the rate is how timesheets end up a few cents off the amount
 * the coordinator approved.
 */
export function assignmentValueCents(minutes: number, rateCents: number): number {
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new Error(`minutes must be a non-negative integer, got ${minutes}`);
  }
  if (!Number.isInteger(rateCents) || rateCents < 0) {
    throw new Error(`rateCents must be a non-negative integer, got ${rateCents}`);
  }
  return Math.round((minutes * rateCents) / 60);
}

/**
 * The full fee breakdown for a given duration and rate.
 *
 * Worked example from the original plan, which this reproduces exactly: a €400
 * assignment yields a €20 fee plus €4.20 VAT — €24.20 off the balance.
 */
export function calculateFee(minutes: number, rateCents: number): FeeBreakdown {
  const value = assignmentValueCents(minutes, rateCents);
  const feeExVat = applyRate(value, PLATFORM_FEE_BP);
  const feeVat = applyRate(feeExVat, VAT_STANDARD_BP);
  return {
    assignmentValueCents: value,
    feeExVatCents: feeExVat,
    feeVatCents: feeVat,
    feeTotalCents: feeExVat + feeVat,
  };
}

/**
 * Difference to settle once the real hours are known.
 *
 * The fee is charged at acceptance on the *scheduled* duration, because that is
 * when we know the freelancer has committed and it is the only moment we can
 * refuse for insufficient balance. Shifts then routinely run short or long, so
 * the ledger gets a second, smaller entry rather than the first one being
 * rewritten — see the append-only note in supabase/schema.sql.
 *
 * Positive means charge more; negative means refund. Zero means do not write a
 * ledger row at all, which is the common case and worth short-circuiting so the
 * ledger doesn't fill with no-op entries.
 */
export function feeAdjustmentCents(
  scheduledMinutes: number,
  actualMinutes: number,
  rateCents: number,
): number {
  const charged = calculateFee(scheduledMinutes, rateCents).feeTotalCents;
  const owed = calculateFee(actualMinutes, rateCents).feeTotalCents;
  return owed - charged;
}
