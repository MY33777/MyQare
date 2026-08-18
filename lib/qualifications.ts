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
 * list errs toward completeness.
 *
 * NOTE ON big_status: whether a qualification leads to a Wet BIG registration
 * decides both what a facility must verify and, indirectly, how lib/vat.ts treats
 * the invoice. It is recorded per qualification but never used to *decide* VAT
 * automatically — that stays an explicit per-freelancer determination, because
 * the exemption depends on what the person actually did on the shift, not only on
 * their diploma.
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
  mboLevel?: 1 | 2 | 3 | 4;
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

/**
 * Ordered so the most commonly hired roles come first within each category. A
 * coordinator filling tomorrow's night shift should reach Verzorgende IG and
 * Verpleegkundige without scrolling.
 */
export const QUALIFICATIONS: Qualification[] = [
  // Populated by lib/qualifications.data.ts — see the generated file.
];

const BY_SLUG = new Map<string, Qualification>();

/** Registers the taxonomy. Called once at module load by the data file. */
export function registerQualifications(list: Qualification[]): void {
  QUALIFICATIONS.length = 0;
  QUALIFICATIONS.push(...list);
  BY_SLUG.clear();
  for (const q of list) BY_SLUG.set(q.slug, q);
}

export function findQualification(slug: string): Qualification | undefined {
  return BY_SLUG.get(slug);
}

/** Label for a stored slug, falling back to the raw value so old data still renders. */
export function qualificationLabel(slug: string | null | undefined): string {
  if (!slug) return "—";
  return BY_SLUG.get(slug)?.shortNl ?? slug;
}

export function isKnownQualification(slug: string): boolean {
  return BY_SLUG.has(slug);
}

/** Grouped for an <optgroup> dropdown, in category order. */
export function qualificationsByCategory(): { category: QualificationCategory; label: string; items: Qualification[] }[] {
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
 * Aliases carry the weight here: someone typing "VIG" or "HBO-V" or "MBO-V" is
 * using an abbreviation that appears in no official name.
 */
export function searchQualifications(query: string, limit = 20): Qualification[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return QUALIFICATIONS.slice(0, limit);

  const matches = QUALIFICATIONS.filter((q) => {
    const haystack = [q.nameNl, q.shortNl, ...q.aliases].join(" ").toLowerCase();
    return haystack.includes(needle);
  });

  // Exact short-name matches first, then prefix matches, then the rest — so
  // typing "verpleegkundige" does not bury the plain one under every specialism.
  return matches
    .sort((a, b) => rankMatch(a, needle) - rankMatch(b, needle))
    .slice(0, limit);
}

function rankMatch(q: Qualification, needle: string): number {
  const short = q.shortNl.toLowerCase();
  if (short === needle) return 0;
  if (short.startsWith(needle)) return 1;
  if (q.aliases.some((a) => a.toLowerCase() === needle)) return 2;
  return 3;
}
