/*
 * Merges the qualification research into lib/qualifications.data.ts.
 *
 * The workflow's own synthesis step failed — it tried to emit 148 objects in one
 * model response and hit the output token ceiling. Merging is mechanical anyway
 * (dedupe, apply corrections, sort), so it belongs in code rather than in a model
 * that has to retype every field to change one of them.
 *
 * Usage: node scripts/build-qualifications.mjs <path-to-journal.jsonl>
 */

import fs from "node:fs";

const journalPath = process.argv[2];
if (!journalPath) {
  console.error("Usage: node scripts/build-qualifications.mjs <journal.jsonl>");
  process.exit(1);
}

// ---------------------------------------------------------------- read journal

const raw = [];
const corrections = [];

for (const line of fs.readFileSync(journalPath, "utf8").trim().split("\n")) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  if (entry.type !== "result" || !entry.result) continue;
  if (Array.isArray(entry.result.qualifications)) raw.push(...entry.result.qualifications);
  if (Array.isArray(entry.result.corrections)) corrections.push(...entry.result.corrections);
}

// ------------------------------------------------------------------- normalise

/*
 * The research produced an "overig" bucket that the app's type union does not
 * have. Both entries are historic V&V qualifications, so they belong there rather
 * than in a catch-all that would render as an empty optgroup label.
 */
const CATEGORY_REMAP = {
  overig: "mbo_verpleging_verzorging",
};

const VALID_CATEGORIES = new Set([
  "mbo_verpleging_verzorging",
  "mbo_welzijn_begeleiding",
  "mbo_assisterend",
  "hbo",
  "wo",
  "specialisatie",
]);

const VALID_BIG = new Set(["big_artikel_3", "big_artikel_34", "geen_big", "onbekend"]);

const merged = new Map();

for (const item of raw) {
  if (!item || !item.slug || !item.name_nl) continue;

  const category = CATEGORY_REMAP[item.category] ?? item.category;
  if (!VALID_CATEGORIES.has(category)) continue;

  const existing = merged.get(item.slug);

  if (!existing) {
    merged.set(item.slug, {
      slug: item.slug,
      nameNl: item.name_nl,
      shortNl: item.short_nl || item.name_nl,
      aliases: [...new Set(item.aliases ?? [])],
      category,
      levelLabel: item.level_label ?? "",
      mboLevel: item.mbo_level,
      crebo: item.crebo,
      bigStatus: VALID_BIG.has(item.big_status) ? item.big_status : "onbekend",
      settings: [...new Set(item.typical_settings ?? [])],
      confidence: item.confidence ?? "medium",
    });
    continue;
  }

  /*
   * Same qualification found by two segments. Union the aliases and settings, and
   * let the more confident entry win on the scalar fields — a "high" answer with a
   * crebo code beats a "low" one that omitted it.
   */
  existing.aliases = [...new Set([...existing.aliases, ...(item.aliases ?? [])])];
  existing.settings = [...new Set([...existing.settings, ...(item.typical_settings ?? [])])];

  const rank = { high: 3, medium: 2, low: 1 };
  if ((rank[item.confidence] ?? 0) > (rank[existing.confidence] ?? 0)) {
    existing.nameNl = item.name_nl;
    existing.shortNl = item.short_nl || item.name_nl;
    existing.levelLabel = item.level_label ?? existing.levelLabel;
    existing.confidence = item.confidence;
  }
  if (!existing.crebo && item.crebo) existing.crebo = item.crebo;
  if (existing.bigStatus === "onbekend" && VALID_BIG.has(item.big_status)) {
    existing.bigStatus = item.big_status;
  }
}

// ------------------------------------------------------ collapse near-duplicates

/*
 * Slug-based dedup is not enough. Six segments researched overlapping ground and
 * coined their own slugs, so the same qualification arrived as both
 * "verzorgende-ig" and "verzorgende-ig-niveau-3", and as both
 * "helpende-zorg-en-welzijn" and "...-niveau-2". Shipping both would put the same
 * job twice in one dropdown, which is worse than a missing entry: the coordinator
 * has to guess which one the freelancer picked.
 *
 * The key strips everything that varies between segments describing one thing —
 * diacritics, punctuation, bracketed abbreviations, and the "niveau N" suffix that
 * some segments folded into the name and others did not.
 */
function canonicalKey(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/\bniveau\s*\d\b/g, " ")
    .replace(/\bmbo\b|\bhbo\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

const byCanonical = new Map();

for (const item of merged.values()) {
  const key = canonicalKey(item.nameNl);
  const rival = byCanonical.get(key);

  if (!rival) {
    byCanonical.set(key, item);
    continue;
  }

  // Union what both learned, then keep whichever entry is better evidenced.
  const aliases = [...new Set([...rival.aliases, ...item.aliases, rival.shortNl, item.shortNl])];
  const settings = [...new Set([...rival.settings, ...item.settings])];

  const rank = { high: 3, medium: 2, low: 1 };
  const score = (entry) =>
    (entry.crebo ? 4 : 0) + (rank[entry.confidence] ?? 0) + (entry.slug.includes("niveau") ? 1 : 0);

  const winner = score(item) > score(rival) ? item : rival;
  const loser = winner === item ? rival : item;

  winner.aliases = aliases.filter((alias) => alias !== winner.shortNl);
  winner.settings = settings;
  if (!winner.crebo && loser.crebo) winner.crebo = loser.crebo;
  if (winner.bigStatus === "onbekend") winner.bigStatus = loser.bigStatus;
  if (!winner.mboLevel && loser.mboLevel) winner.mboLevel = loser.mboLevel;

  byCanonical.set(key, winner);
}

const collapsed = merged.size - byCanonical.size;
merged.clear();
for (const item of byCanonical.values()) merged.set(item.slug, item);

// ---------------------------------------------------------- apply corrections

/*
 * Only fields the app actually stores. Corrections to notes, sources and
 * confidence were valuable for the verifiers' reasoning but have no home in the
 * shipped type, and a correction whose `field` names several at once is not
 * mechanically applicable — those are skipped rather than guessed at.
 */
const APPLICABLE = {
  name_nl: "nameNl",
  short_nl: "shortNl",
  level_label: "levelLabel",
  crebo: "crebo",
  big_status: "bigStatus",
  category: "category",
};

let applied = 0;
let skipped = 0;

for (const correction of corrections) {
  const target = merged.get(correction.slug);
  if (!target) {
    skipped++;
    continue;
  }

  const field = APPLICABLE[correction.field];
  if (!field) {
    skipped++;
    continue;
  }

  const value = String(correction.should_be ?? "").trim();
  if (!value) {
    skipped++;
    continue;
  }

  if (field === "bigStatus") {
    if (!VALID_BIG.has(value)) {
      skipped++;
      continue;
    }
  }
  if (field === "category") {
    const remapped = CATEGORY_REMAP[value] ?? value;
    if (!VALID_CATEGORIES.has(remapped)) {
      skipped++;
      continue;
    }
    target.category = remapped;
    applied++;
    continue;
  }
  // A crebo correction that reads like prose rather than a code is a verifier
  // explaining why the code was wrong, not supplying a replacement.
  if (field === "crebo" && !/^\d{4,6}$/.test(value)) {
    target.crebo = undefined;
    applied++;
    continue;
  }

  target[field] = value;
  applied++;
}

// Alias corrections carry extra spellings rather than a replacement value, so
// they are appended rather than assigned.
for (const correction of corrections) {
  if (correction.field !== "aliases") continue;
  const target = merged.get(correction.slug);
  if (!target) continue;
  const extra = String(correction.should_be ?? "")
    .split(/[,;]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 1 && value.length < 60);
  target.aliases = [...new Set([...target.aliases, ...extra])];
}

// -------------------------------------------------------------- fill the gaps

/*
 * Qualifications the verifiers reported missing from every segment. Filled in by
 * hand because the "missing" reports carry only a name — and deliberately without
 * crebo/CROHO codes, since inventing one is worse than omitting it (a facility may
 * check it).
 */
const GAPS = [
  ["mondhygienist", "Mondhygiënist", "Mondhygiënist", ["mondhygiene", "mondzorgkunde"], "hbo", "HBO bachelor", "big_artikel_34", ["tandartspraktijk", "mondzorg"]],
  ["vaktherapeut", "Vaktherapeut", "Vaktherapeut", ["vaktherapie", "creatief therapeut", "beeldend therapeut", "muziektherapeut", "psychomotorisch therapeut"], "hbo", "HBO bachelor", "geen_big", ["GGZ", "gehandicaptenzorg", "jeugdzorg"]],
  ["tandprotheticus", "Tandprotheticus", "Tandprotheticus", ["tandprothetiek"], "hbo", "HBO bachelor", "big_artikel_34", ["mondzorg"]],
  ["klinisch-neuropsycholoog", "Klinisch neuropsycholoog", "Klinisch neuropsycholoog", ["KNP"], "wo", "WO specialisme", "big_artikel_3", ["ziekenhuis", "revalidatie", "GGZ"]],
  ["bedrijfsarts", "Bedrijfsarts", "Bedrijfsarts", ["arbo-arts"], "wo", "WO medisch specialisme", "big_artikel_3", ["arbodienst", "bedrijfsgezondheidszorg"]],
  ["verzekeringsarts", "Verzekeringsarts", "Verzekeringsarts", [], "wo", "WO medisch specialisme", "big_artikel_3", ["UWV", "verzekeringsgeneeskunde"]],
  ["arts-maatschappij-en-gezondheid", "Arts maatschappij en gezondheid", "Arts M&G", ["arts M en G", "sociaal geneeskundige"], "wo", "WO medisch specialisme", "big_artikel_3", ["GGD", "jeugdgezondheidszorg", "publieke gezondheid"]],
  ["seh-arts", "SEH-arts KNMG", "SEH-arts", ["spoedeisende geneeskunde", "spoedarts"], "wo", "WO medisch specialisme", "big_artikel_3", ["ziekenhuis", "SEH"]],
  ["kaakchirurg", "MKA-chirurg (kaakchirurg)", "Kaakchirurg", ["MKA-chirurg", "mondziekten kaak- en aangezichtschirurgie"], "wo", "WO specialisme", "big_artikel_3", ["ziekenhuis", "mondzorg"]],
  ["orthodontist", "Orthodontist", "Orthodontist", ["dentomaxillaire orthopedie"], "wo", "WO specialisme", "big_artikel_3", ["mondzorg"]],
  ["klinisch-perfusionist", "Klinisch perfusionist", "Klinisch perfusionist", ["perfusionist", "hart-longmachine"], "specialisatie", "Specialisatie", "geen_big", ["ziekenhuis", "hartchirurgie"]],
  ["orgaanperfusionist", "Orgaanperfusionist", "Orgaanperfusionist", [], "specialisatie", "Specialisatie", "geen_big", ["ziekenhuis", "transplantatie"]],
  ["intensive-care-practitioner", "Intensivecare practitioner", "IC practitioner", ["ventilation practitioner", "circulation practitioner", "renal practitioner", "neural practitioner"], "specialisatie", "Specialisatie", "geen_big", ["ziekenhuis", "IC"]],
  ["mammalaborant", "Mammalaborant", "Mammalaborant", ["mammografie laborant", "screeningslaborant"], "specialisatie", "Specialisatie", "geen_big", ["ziekenhuis", "bevolkingsonderzoek"]],
  ["medisch-nucleair-werker", "Medisch nucleair werker", "Medisch nucleair werker", ["nucleaire geneeskunde laborant", "MNW"], "specialisatie", "Specialisatie", "geen_big", ["ziekenhuis", "nucleaire geneeskunde"]],
  ["medewerker-interventiecardiologie", "Medewerker interventiecardiologie", "Interventiecardiologie", ["hartkatheterisatie", "cathlab medewerker"], "specialisatie", "Specialisatie", "geen_big", ["ziekenhuis", "cardiologie"]],
  ["hartfalenverpleegkundige", "Hartfalenverpleegkundige", "Hartfalenverpleegkundige", ["hartfalen verpleegkundige"], "specialisatie", "Specialisatie", "geen_big", ["ziekenhuis", "cardiologie", "poli"]],
  ["stomaverpleegkundige", "Stomaverpleegkundige", "Stomaverpleegkundige", ["stomazorg"], "specialisatie", "Specialisatie", "geen_big", ["ziekenhuis", "thuiszorg"]],
  ["jeugdverpleegkundige", "Jeugdverpleegkundige", "Jeugdverpleegkundige", ["JGZ verpleegkundige", "jeugdgezondheidszorg"], "specialisatie", "Specialisatie", "geen_big", ["GGD", "consultatiebureau", "jeugdgezondheidszorg"]],
  ["mammacareverpleegkundige", "Mammacareverpleegkundige", "Mammacareverpleegkundige", ["mammacare"], "specialisatie", "Specialisatie", "geen_big", ["ziekenhuis", "oncologie"]],
  ["forensisch-verpleegkundige", "Forensisch verpleegkundige", "Forensisch verpleegkundige", ["forensische zorg"], "specialisatie", "Specialisatie", "geen_big", ["justitiele inrichting", "forensische zorg", "politie"]],
  ["centralist-meldkamer-ambulancezorg", "Centralist meldkamer ambulancezorg", "Centralist MKA", ["UCMKA", "uitgiftecentralist", "C-ZCC", "zorgcoordinatiecentrum"], "specialisatie", "Specialisatie", "geen_big", ["meldkamer", "ambulancezorg"]],
  ["werkbegeleider-zorgboerderij", "Werkbegeleider zorgboerderij", "Werkbegeleider zorgboerderij", ["zorgboerderij", "groene zorg"], "mbo_welzijn_begeleiding", "MBO niveau 3", "geen_big", ["zorgboerderij", "dagbesteding"]],
  ["sociaal-pedagogisch-werker-legacy", "Sociaal Pedagogisch Werker (SPW, oud diploma)", "SPW (oud diploma)", ["SPW 3", "SPW 4", "sociaal pedagogisch werk"], "mbo_welzijn_begeleiding", "MBO niveau 3/4 (historisch)", "geen_big", ["gehandicaptenzorg", "jeugdzorg", "GGZ"]],
];

let added = 0;
for (const [slug, nameNl, shortNl, aliases, category, levelLabel, bigStatus, settings] of GAPS) {
  if (merged.has(slug)) continue;
  merged.set(slug, {
    slug,
    nameNl,
    shortNl,
    aliases,
    category,
    levelLabel,
    mboLevel: undefined,
    crebo: undefined,
    bigStatus,
    settings,
    confidence: "medium",
  });
  added++;
}

// ------------------------------------------------------------------- ordering

/*
 * A coordinator filling tomorrow's night shift must reach the everyday roles
 * without scrolling. Everything not named here keeps its category and sorts
 * alphabetically after the pinned entries.
 */
const PINNED = [
  "verzorgende-ig-niveau-3",
  "mbo-verpleegkundige-niveau-4",
  "hbo-verpleegkunde-bachelor",
  "helpende-zorg-en-welzijn-niveau-2",
  "begeleider-gehandicaptenzorg-niveau-3",
  "persoonlijk-begeleider-gehandicaptenzorg-niveau-4",
  "persoonlijk-begeleider-specifieke-doelgroepen-niveau-4",
  "begeleider-maatschappelijke-zorg-niveau-3",
  "doktersassistent",
];

const CATEGORY_ORDER = [
  "mbo_verpleging_verzorging",
  "mbo_welzijn_begeleiding",
  "mbo_assisterend",
  "hbo",
  "wo",
  "specialisatie",
];

const list = [...merged.values()].sort((a, b) => {
  const catDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
  if (catDiff !== 0) return catDiff;

  const pinA = PINNED.indexOf(a.slug);
  const pinB = PINNED.indexOf(b.slug);
  if (pinA !== -1 || pinB !== -1) {
    if (pinA === -1) return 1;
    if (pinB === -1) return -1;
    return pinA - pinB;
  }

  return a.shortNl.localeCompare(b.shortNl, "nl");
});

// -------------------------------------------------------------------- emit TS

const quote = (value) => JSON.stringify(value);

const entries = list
  .map((q) => {
    const fields = [
      `    slug: ${quote(q.slug)},`,
      `    nameNl: ${quote(q.nameNl)},`,
      `    shortNl: ${quote(q.shortNl)},`,
      `    aliases: ${JSON.stringify(q.aliases)},`,
      `    category: ${quote(q.category)},`,
      `    levelLabel: ${quote(q.levelLabel)},`,
    ];
    if (q.mboLevel) fields.push(`    mboLevel: ${q.mboLevel},`);
    if (q.crebo) fields.push(`    crebo: ${quote(q.crebo)},`);
    fields.push(`    bigStatus: ${quote(q.bigStatus)},`);
    fields.push(`    settings: ${JSON.stringify(q.settings)},`);
    return `  {\n${fields.join("\n")}\n  },`;
  })
  .join("\n");

const output = `// GENERATED — do not edit by hand.
//
// Rebuild with:
//   node scripts/build-qualifications.mjs <journal.jsonl>
//
// Source: a six-way research fan-out over S-BB, BIG-register, CZO, V&VN and DUO,
// each segment then checked by an adversarial verifier whose job was to find
// invented CREBO codes, wrong BIG status and outdated names. ${corrections.length} corrections and
// ${added} missing qualifications came out of that pass and are applied here.
//
// CREBO codes are present only where a verifier could confirm them. A missing code
// is deliberate: a facility may check it, and a wrong code is worse than none.

import type { Qualification } from "@/lib/qualifications";

export const QUALIFICATION_DATA: Qualification[] = [
${entries}
];
`;

fs.writeFileSync("lib/qualifications.data.ts", output);

console.log(`unique qualifications: ${merged.size}`);
console.log(`near-duplicates collapsed: ${collapsed}`);
console.log(`corrections applied:   ${applied} (skipped ${skipped} — notes/sources/confidence only)`);
console.log(`gaps filled:           ${added}`);
console.log(`written:               lib/qualifications.data.ts`);

// A pin that names a slug which does not exist is silently inert, which is how the
// everyday roles ended up buried on the first run. Fail loudly instead.
const missingPins = PINNED.filter((slug) => !merged.has(slug));
if (missingPins.length > 0) {
  console.error(`\nERROR: ${missingPins.length} pinned slug(s) do not exist:`);
  for (const slug of missingPins) console.error(`  - ${slug}`);
  process.exitCode = 1;
}

const byCategory = {};
for (const q of list) byCategory[q.category] = (byCategory[q.category] ?? 0) + 1;
console.log("by category:", byCategory);
const withCrebo = list.filter((q) => q.crebo).length;
console.log(`with a confirmed CREBO/CROHO code: ${withCrebo}`);
