import { QUALIFICATION_DATA } from "@/lib/qualifications.data";

/*
 * The controlled vocabulary of Dutch healthcare qualifications.
 *
 * This is the single most important list in the product. A coordinator picks the
 * qualification a shift REQUIRES; a freelancer picks the ones they HOLD; matching
 * is the intersection. Free text was the alternative and it fails immediately —
 * "Verzorgende IG", "verzorgende ig", "VIG" and "Verzorgende Individuele
 * Gezondheidszorg" are one qualification and four strings.
 *
 * A missing entry means a real professional cannot describe themselves, so the
 * list errs toward completeness: 170 entries covering MBO niveau 1 through WO
 * specialisms and post-initial nursing specialisations.
 *
 * The data lives in the generated lib/qualifications.data.ts. That file imports
 * only the TYPE from here, which is erased at compile time, so there is no runtime
 * cycle — and no registration side effect to get the ordering of wrong.
 *
 * NOTE ON bigStatus: whether a qualification leads to a Wet BIG registration
 * decides what a facility must verify. It is recorded per qualification but never
 * used to *decide* VAT automatically — that stays an explicit per-freelancer
 * determination in lib/vat.ts, because the exemption depends on what the person
 * actually did on the shift, not only on their diploma.
 */

export type QualificationCategory =
  | "mbo_verpleging_verzorging"
  | "mbo_welzijn_begeleiding"
  | "mbo_assisterend"
  | "hbo"
  | "wo"
  | "specialisatie";

export type BigStatus = "big_artikel_3" | "big_artikel_34" | "geen_big" | "onbekend";

export type Qualification = {
  /** Stable id. Stored in the database — never renamed once shipped. */
  slug: string;
  /** Name as it appears on the diploma. */
  nameNl: string;
  /** What practitioners actually say. Used in dropdowns and on shift cards. */
  shortNl: string;
  /** Other spellings and abbreviations, matched when searching. */
  aliases: string[];
  category: QualificationCategory;
  /** Human label: "MBO niveau 3", "HBO bachelor", "Specialisatie". */
  levelLabel: string;
  mboLevel?: number;
  /**
   * CREBO (MBO) or CROHO (HBO) code, present ONLY where a verifier could confirm
   * it against S-BB or DUO. A missing code is deliberate — a facility may look it
   * up, and a wrong code is worse than none.
   */
  crebo?: string;
  bigStatus: BigStatus;
  /** Where this qualification typically works — used to suggest, never to restrict. */
  settings: string[];
};

export const CATEGORY_LABELS: Record<QualificationCategory, string> = {
  mbo_verpleging_verzorging: "MBO — Verpleging & Verzorging",
  mbo_welzijn_begeleiding: "MBO — Welzijn & Begeleiding",
  mbo_assisterend: "MBO — Assisterende gezondheidszorg",
  hbo: "HBO",
  wo: "WO",
  specialisatie: "Specialisatie",
};

export const BIG_STATUS_LABELS: Record<BigStatus, string> = {
  big_artikel_3: "BIG-geregistreerd (artikel 3)",
  big_artikel_34: "Beschermde opleidingstitel (artikel 34)",
  geen_big: "Geen BIG-registratie",
  onbekend: "Onbekend",
};

/**
 * Ordered so the most commonly hired roles come first within each category — a
 * coordinator filling tomorrow's night shift reaches Verzorgende IG and
 * Verpleegkundige without scrolling. The ordering is applied by the generator.
 */
/**
 * Slugs that describe the same thing as another entry, and the one that wins.
 *
 * The research produced two rows for fourteen professions: the education
 * ("Fysiotherapie (hbo-bachelor)") and the profession ("Fysiotherapeut"). Both
 * carry shortNl "Fysiotherapeut", so the dropdown showed two identical-looking
 * rows — and a region shift only reached the half of the holders who happened to
 * click the same one the coordinator did. Invisible from both sides: every screen
 * renders shortNl, so the two are indistinguishable everywhere except in the
 * matching, where they are not equal.
 *
 * The profession entry survives in each pair. Its BIG status is the accurate one
 * — the education rows had Fysiotherapeut as article 34 and Verloskundige as no
 * registration at all, both wrong — and it is the term a coordinator posts. The
 * education row's CREBO and diploma name are folded into the survivor below, so
 * nothing verifiable is lost.
 *
 * Kept as a redirect rather than deleted outright because rows already written
 * with a retired slug must keep resolving. Nothing renames a shipped slug.
 */
const RETIRED_SLUGS: Record<string, string> = {
  "wo-farmacie-apotheker": "apotheker",
  "hbo-voeding-en-dietetiek-bachelor": "dietist",
  "hbo-ergotherapie-bachelor": "ergotherapeut",
  "hbo-fysiotherapie-bachelor": "fysiotherapeut",
  "hbo-huidtherapie-bachelor": "huidtherapeut",
  "hbo-logopedie-bachelor": "logopedist",
  "hbo-mondzorgkunde-bachelor": "mondhygienist",
  "hbo-oefentherapie-bachelor": "oefentherapeut",
  "hbo-optometrie-bachelor": "optometrist",
  "hbo-orthoptie-bachelor": "orthoptist",
  "praktijkondersteuner-huisartsenzorg-ggz": "poh-ggz",
  "hbo-podotherapie-bachelor": "podotherapeut",
  "wo-tandheelkunde-tandarts": "tandarts",
  "hbo-verloskunde-bachelor": "verloskundige",
};

/*
 * Fold each retired entry into its survivor, then drop it from the list.
 *
 * Done here rather than by hand-editing the generated data file so the merge is
 * visible and reversible, and so a regenerated taxonomy cannot silently undo it.
 */
const QUALIFICATIONS_MERGED: Qualification[] = (() => {
  const bySlug = new Map(QUALIFICATION_DATA.map((q) => [q.slug, { ...q }]));

  for (const [retired, canonical] of Object.entries(RETIRED_SLUGS)) {
    const from = bySlug.get(retired);
    const into = bySlug.get(canonical);
    if (!from || !into) continue;

    // The CREBO lived on the education row; it is the verifiable half of the pair.
    if (!into.crebo && from.crebo) into.crebo = from.crebo;

    // The diploma name stays searchable — somebody looking for "Mondzorgkunde"
    // should still land on Mondhygiënist.
    into.aliases = Array.from(new Set([...into.aliases, from.nameNl, ...from.aliases]));

    bySlug.delete(retired);
  }

  // Preserve the generator's ordering, which puts the most commonly hired first.
  return QUALIFICATION_DATA.filter((q) => bySlug.has(q.slug)).map((q) => bySlug.get(q.slug)!);
})();

export const QUALIFICATIONS: Qualification[] = QUALIFICATIONS_MERGED;

const BY_SLUG = new Map(QUALIFICATIONS.map((q) => [q.slug, q]));

/**
 * The slug a stored value should be treated as.
 *
 * Everything that compares or looks up a qualification goes through this, so a
 * row written before the merge still matches one written after it.
 */
export function canonicalQualificationSlug(slug: string): string {
  return RETIRED_SLUGS[slug] ?? slug;
}

export function findQualification(slug: string): Qualification | undefined {
  return BY_SLUG.get(canonicalQualificationSlug(slug));
}

/** Label for a stored slug, falling back to the raw value so old data still renders. */
export function qualificationLabel(slug: string | null | undefined): string {
  if (!slug) return "—";
  return BY_SLUG.get(canonicalQualificationSlug(slug))?.shortNl ?? slug;
}

export function isKnownQualification(slug: string): boolean {
  return BY_SLUG.has(canonicalQualificationSlug(slug));
}

/** Grouped for an <optgroup> dropdown, in category order. */
export function qualificationsByCategory(): {
  category: QualificationCategory;
  label: string;
  items: Qualification[];
}[] {
  const order: QualificationCategory[] = [
    "mbo_verpleging_verzorging",
    "mbo_welzijn_begeleiding",
    "mbo_assisterend",
    "hbo",
    "wo",
    "specialisatie",
  ];
  return order
    .map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      items: QUALIFICATIONS.filter((q) => q.category === category),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Substring search across name, short name and aliases.
 *
 * Aliases carry the weight here: someone typing "VIG", "HBO-V" or "MBO-V" is using
 * an abbreviation that appears in no official name.
 */
export function searchQualifications(query: string, limit = 20): Qualification[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return QUALIFICATIONS.slice(0, limit);

  const matches = QUALIFICATIONS.filter((q) => {
    const haystack = [q.nameNl, q.shortNl, ...q.aliases].join(" ").toLowerCase();
    return haystack.includes(needle);
  });

  // Exact short-name matches first, then prefix matches, then the rest — so typing
  // "verpleegkundige" does not bury the plain one under every specialism.
  return matches.sort((a, b) => rankMatch(a, needle) - rankMatch(b, needle)).slice(0, limit);
}

function rankMatch(q: Qualification, needle: string): number {
  const short = q.shortNl.toLowerCase();
  if (short === needle) return 0;
  if (short.startsWith(needle)) return 1;
  if (q.aliases.some((a) => a.toLowerCase() === needle)) return 2;
  return 3;
}
