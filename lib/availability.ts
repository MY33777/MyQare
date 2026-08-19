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

/**
 * Loose region comparison.
 *
 * Region is free text on both sides — "Rotterdam", "Rotterdam-Rijnmond",
 * "Zuid-Holland" all appear — so an equality check would match almost nothing.
 * Either string containing the other is treated as a match, which is generous in
 * the right direction: over-offering is visible and declinable, under-offering is
 * silent.
 *
 * An unset region on either side means no restriction. A freelancer who never
 * filled the field has not opted out of anything.
 */
export function regionMatches(
  shiftRegion: string | null | undefined,
  freelancerRegion: string | null | undefined,
): boolean {
  const shift = (shiftRegion ?? "").trim().toLowerCase();
  const freelancer = (freelancerRegion ?? "").trim().toLowerCase();

  /*
   * A missing region is not a wildcard.
   *
   * This used to `return true` when either side was blank, on the reasoning that
   * under-offering is the worse error. That holds inside a pool, where the
   * facility already knows everyone. It does not hold here: region is only
   * consulted for the one visibility that reaches strangers, and a facility whose
   * organisation has no city set — the field is optional at onboarding — silently
   * broadcast every shift to EVERY freelancer on the platform. Each of those
   * offers is a row in shift_offers, and shift_offers is what grants that facility
   * standing read access to the freelancer's BIG number and rate.
   *
   * So a blank on either side means no match, and the shift form now refuses to
   * post a region-wide shift without a region at all.
   */
  if (!shift || !freelancer) return false;
  return shift.includes(freelancer) || freelancer.includes(shift);
}

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
