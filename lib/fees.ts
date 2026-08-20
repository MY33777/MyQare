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
/*
 * 1.5%, EXCLUDING VAT — so a freelancer pays 1.5% of the assignment value plus
 * 21% VAT on that fee, which is 1.815% of the assignment value in total.
 *
 * Was 500 (5%). Lowered deliberately: 5% of a €340 shift is €20.57, which is a
 * lot to take off somebody's day rate for software that does not negotiate, does
 * not assign and takes no risk on the work.
 *
 * Everything derives from this. The public pages compute their percentages from
 * it rather than printing a literal, so the number here and the number a customer
 * reads cannot drift apart.
 */
export const PLATFORM_FEE_BP: BasisPoints = 150; // 1.5% ex VAT

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
 * The fee as a Dutch-formatted percentage string, without a % sign.
 *
 * Six pages each derived this themselves as `PLATFORM_FEE_BP / 100`, which was
 * fine while the answer was the integer 5 and started printing "1.5" the moment
 * it was not — a decimal point in a Dutch price. Deriving one rule in six places
 * is also exactly how the payment term silently halved.
 *
 * Trailing zeros are dropped: 1,5 rather than 1,50, and 21 rather than 21,00.
 */
function dutchPercent(basisPoints: BasisPoints): string {
  const value = basisPoints / 100;
  return (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, "")).replace(
    ".",
    ",",
  );
}

/** "1,5" — the fee excluding VAT. */
export const FEE_PERCENT_LABEL = dutchPercent(PLATFORM_FEE_BP);

/** "21" — the VAT rate applied to the fee. */
export const VAT_PERCENT_LABEL = dutchPercent(VAT_STANDARD_BP);

/**
 * "1,815" — what a freelancer actually pays, as a share of the assignment value.
 *
 * Three decimals rather than a tidy two, because rounding 1,815 to 1,82 would be
 * quoting a price slightly above the one that gets charged. Understating is worse
 * still: this figure exists so nobody discovers the VAT afterwards.
 */
export const FEE_INCL_VAT_PERCENT_LABEL = (
  (PLATFORM_FEE_BP * (10_000 + VAT_STANDARD_BP)) / 10_000 / 100
)
  .toFixed(3)
  .replace(/0+$/, "")
  .replace(/[.,]$/, "")
  .replace(".", ",");
