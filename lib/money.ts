/*
 * All money in MyQare is an integer number of eurocents.
 *
 * Nothing in this file returns or accepts a euro float. 0.05 is not
 * representable in binary floating point, and a 5% fee applied to thousands of
 * assignments with float arithmetic drifts away from the invoices already sent.
 * Cents as integers cannot drift, so the conversion to a human-readable string
 * happens exactly once, at the edge, here.
 */

/** Basis points, so percentages stay integers: 500 = 5%, 2100 = 21%. */
export type BasisPoints = number;

export const PERCENT = 100 as const; // 1% in basis points

/**
 * Applies a basis-point rate to an amount in cents, rounding half-up.
 *
 * Half-up rather than JavaScript's default banker's-rounding-free `toFixed`
 * behaviour because that is what the amounts on a Dutch invoice do, and because
 * rounding a fee *down* by a cent thousands of times is a slow leak in the
 * customer's favour that still has to be reconciled.
 */
export function applyRate(amountCents: number, rate: BasisPoints): number {
  if (!Number.isInteger(amountCents)) {
    throw new Error(`applyRate expects integer cents, got ${amountCents}`);
  }
  // Sign-aware so a negative amount (a reversal) rounds symmetrically rather
  // than always toward positive infinity, which would make a refund one cent
  // different from the charge it reverses.
  const sign = amountCents < 0 ? -1 : 1;
  return sign * Math.round((Math.abs(amountCents) * rate) / 10_000);
}

const NL_EURO = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
});

/** "€ 1.234,56" — Dutch grouping and decimal separators. */
export function formatEuros(cents: number): string {
  return NL_EURO.format(cents / 100);
}

/**
 * Parses user input into cents. Accepts both Dutch and English conventions,
 * because a coordinator typing an hourly rate will use a comma ("42,50") and
 * anyone pasting from a spreadsheet may produce a dot.
 *
 * Returns null rather than NaN or 0 for unusable input: an unparseable rate must
 * stop the form, not silently become free work.
 */
export function parseEurosToCents(input: string): number | null {
  const cleaned = input
    .trim()
    .replace(/^€\s*/, "")
    .replace(/\s/g, "");
  if (cleaned === "") return null;

  // If both separators appear, the last one is the decimal separator and the
  // other is thousands grouping ("1.234,56" and "1,234.56" both work).
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalised: string;
  if (lastComma >= 0 && lastDot >= 0) {
    normalised =
      lastComma > lastDot
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (lastComma >= 0) {
    /*
     * A LONE separator followed by exactly three digits is thousands, not cents.
     *
     * With one separator this always treated it as the decimal point, so "5.000"
     * — the format this product's own screens print, via formatEuros — parsed as
     * € 5,00. A freelancer reading the hint "maximaal € 5.000,00" and typing
     * "5.000" got a Stripe checkout for five euros, passed both the MIN and MAX
     * guards on the way through, and ended up with a balance that still could not
     * cover the shift she topped up for. "2.500" was worse: it became € 2,50 and
     * was refused as below the minimum, telling somebody who asked for two and a
     * half thousand euros that the lowest amount is € 5,00.
     *
     * Three digits is the whole test. A cent count has one or two; "1,5" is one
     * and a half euros and stays that way. Anything else — "1.2345" — is not a
     * number a person types on purpose, and the pattern check below rejects it.
     */
    normalised = /,\d{3}$/.test(cleaned)
      ? cleaned.replace(/,/g, "")
      : cleaned.replace(",", ".");
  } else if (lastDot >= 0) {
    normalised = /\.\d{3}$/.test(cleaned) ? cleaned.replace(/\./g, "") : cleaned;
  } else {
    normalised = cleaned;
  }

  if (!/^-?\d*\.?\d*$/.test(normalised) || normalised === "." || normalised === "-") {
    return null;
  }

  const euros = Number(normalised);
  if (!Number.isFinite(euros)) return null;
  return Math.round(euros * 100);
}

/**
 * Cents as a bare Dutch amount, for prefilling a form field.
 *
 * formatEuros renders "€ 42,50", which is right on a screen and wrong in an
 * <input>: parseEurosToCents would have to strip a currency symbol back off, and
 * the field would look pre-formatted rather than editable. This gives "42,50".
 *
 * Comma, not a point. It is what a Dutch user types and what parseEurosToCents
 * reads back, so a copied shift round-trips to the same rate rather than to
 * four thousand two hundred and fifty euros.
 */
export function centsToEuroInput(cents: number): string {
  if (!Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}
