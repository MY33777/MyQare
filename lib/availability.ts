/*
 * Availability, and matching a shift to the people who could actually take it.
 *
 * Opt-out rather than opt-in: a freelancer blocks the days they cannot work, and
 * everything else counts as "might be available". Requiring people to mark
 * themselves available looks tidier and fails badly — anyone who forgets to
 * maintain a calendar silently vanishes from every offer, and the first they know
 * is that work stopped arriving. Under-offering is invisible to both sides, which
 * makes it the worse error.
 */

import { canonicalQualificationSlug } from "@/lib/qualifications";

export type AvailabilityBlock = {
  id: string;
  starts_on: string;
  ends_on: string;
  reason: string | null;
};

/** Calendar date in Amsterdam for an instant, as YYYY-MM-DD. */
export function shiftDateKey(instant: Date | string, timeZone = "Europe/Amsterdam"): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  // en-CA is the one locale that formats as YYYY-MM-DD without reassembling parts.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Whether a block covers a given date. Both ends inclusive — someone entering a
 * single day gets starts_on === ends_on, and that day must count as blocked.
 */
export function blockCoversDate(block: AvailabilityBlock, dateKey: string): boolean {
  // ISO dates compare correctly as strings, so no parsing is needed.
  return dateKey >= block.starts_on && dateKey <= block.ends_on;
}

/**
 * Is this freelancer blocked for a shift?
 *
 * Checked against the shift's START date in Amsterdam. A night shift beginning
 * 23:00 on the 14th and ending 07:00 on the 15th belongs to the 14th — that is the
 * evening the person committed, and it is how they think about which day they
 * worked.
 */
export function isBlockedForShift(blocks: AvailabilityBlock[], shiftStartsAt: string): boolean {
  const key = shiftDateKey(shiftStartsAt);
  return blocks.some((block) => blockCoversDate(block, key));
}

/*
 * regionMatches MOVED to lib/regions.ts.
 *
 * It compared two free-text values with substring containment in both
 * directions, which made a one-character region a wildcard over the whole
 * country — and every match writes a shift_offers row granting that facility a
 * standing read of the freelancer's profile. Region is now a code from a fixed
 * list and the comparison is exact, so the function belongs with the list.
 */


/**
 * Does this freelancer hold the qualification a shift asks for?
 *
 * Checks BOTH the main profession and the specialisations list. Onboarding only
 * sets `profession`, and `specialisations` starts empty — matching on
 * specialisations alone (as the first cut did) means a region-wide shift reaches
 * nobody at all.
 */
export function qualificationMatches(
  required: string,
  profession: string | null | undefined,
  specialisations: string[] | null | undefined,
): boolean {
  if (!required) return true;

  /*
   * Both sides are canonicalised before comparing. Fourteen professions had two
   * slugs for one thing — the education and the profession — so a shift posted as
   * "fysiotherapeut" silently failed to reach everyone who had picked
   * "hbo-fysiotherapie-bachelor", and vice versa. See RETIRED_SLUGS.
   */
  const want = canonicalQualificationSlug(required);
  if (canonicalQualificationSlug((profession ?? "").trim()) === want) return true;
  return (specialisations ?? []).some((slug) => canonicalQualificationSlug(slug) === want);
}
