/*
 * Making text safe for the PDF renderer.
 *
 * pdfkit's standard-14 fonts are declared /WinAnsiEncoding, and its encoder emits
 * one byte per character as two hex digits. For a character outside WinAnsi it
 * emits the codepoint instead — three digits for U+0141 — and the hex string
 * silently becomes odd-length. Every byte after that point is read a nibble out of
 * step, so the rest of the run is garbage:
 *
 *     "Lukasz"  ->  <4c756b61737a>    12 digits, correct
 *     "Łukasz"  ->  <141756b61737a>   13 digits, everything after Ł is wrong
 *
 * Which matters because the two documents this product exists to produce — the
 * invoice and the compliance dossier — both print people's names. Polish, Turkish,
 * Czech and Hungarian names are entirely ordinary in Dutch healthcare, and the
 * failure is silent: the PDF opens, it just says something else.
 *
 * The honest fix is embedding a Unicode font. That is a real dependency and a
 * bigger change; until then, transliterating is far better than corrupting, and
 * this is small enough to be obviously correct.
 */

/**
 * The characters WinAnsi (CP1252) can represent beyond Latin-1's own range.
 *
 * Latin-1 (U+0020–U+00FF minus the C1 control block) maps one-to-one, so only
 * these need listing.
 */
const CP1252_EXTRAS = new Set([
  "€", // €
  "‚",
  "ƒ",
  "„",
  "…",
  "†",
  "‡",
  "ˆ",
  "‰",
  "Š",
  "‹",
  "Œ",
  "Ž",
  "‘",
  "’",
  "“",
  "”",
  "•",
  "–",
  "—",
  "˜",
  "™",
  "š",
  "›",
  "œ",
  "ž",
  "Ÿ",
]);

function representable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  // Printable Latin-1, excluding the C1 control range that CP1252 reuses.
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return CP1252_EXTRAS.has(char);
}

/**
 * A few letters that decomposition cannot help with, because the diacritic is
 * part of the glyph rather than a combining mark. Ł is the one that actually
 * turns up in Dutch healthcare rosters; the rest are here so the list is not
 * suspiciously Polish-only.
 */
const TRANSLITERATIONS: Record<string, string> = {
  "Ł": "L", // Ł
  "ł": "l", // ł
  "Đ": "D", // Đ
  "đ": "d", // đ
  "Ħ": "H",
  "ħ": "h",
  "Ŧ": "T",
  "ŧ": "t",
  "Ø": "O", // Ø is in Latin-1, but included for symmetry with ø handling
  "ı": "i", // ı, Turkish dotless i
  "İ": "I", // İ, Turkish dotted capital I
  "Ƶ": "Z",
  "ƶ": "z",
};

/**
 * Rewrites a string so every character survives WinAnsi encoding.
 *
 * Tries, in order: the character as-is; a known transliteration; the base letter
 * with its accent stripped; and finally "?" so something visible remains rather
 * than a hole.
 *
 * Deliberately NOT lossy-silent — an unrepresentable character becomes a
 * character, not nothing. A name rendered "Lukasz" is imperfect and readable; a
 * name rendered "" is a document that appears to be about nobody.
 */
export function winAnsiSafe(value: string): string {
  if (!value) return value;

  let out = "";

  for (const char of value) {
    if (representable(char)) {
      out += char;
      continue;
    }

    const mapped = TRANSLITERATIONS[char];
    if (mapped) {
      out += mapped;
      continue;
    }

    /*
     * Decompose and drop the combining marks: "ș" (s + comma below) becomes "s",
     * "ő" becomes "o". This catches most of Central and Eastern Europe without
     * enumerating it.
     */
    const stripped = char
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");

    if (stripped && [...stripped].every(representable)) {
      out += stripped;
      continue;
    }

    out += "?";
  }

  return out;
}

/** True when the string would have been corrupted. Used by the tests. */
export function needsTransliteration(value: string): boolean {
  return [...(value ?? "")].some((char) => !representable(char));
}
