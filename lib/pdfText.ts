import zlib from "node:zlib";

/*
 * Pulls the visible text back out of a PDF we generated.
 *
 * Exists so the invoice can be checked by machine rather than by eye. An invoice
 * is the only artefact a customer's accountant ever sees, and "the file is a valid
 * PDF" is a much weaker claim than "the file says €484,00".
 *
 * Only good enough for our own output — pdfkit with the standard Helvetica fonts,
 * where the byte values are the characters. It is not a general PDF parser and
 * would not survive an embedded subset font with a custom encoding.
 */

/**
 * pdfkit writes text as hex strings inside a kerning array:
 *
 *   [<4a> 20 <2e> 40 <20646520> 80 <5672696573> 0] TJ
 *
 * where the numbers are kern adjustments between the runs. Naively searching the
 * stream for "J. de Vries" therefore finds nothing, because the string is split
 * across four hex chunks with numbers in between.
 */
export function extractPdfText(pdf: Buffer): string {
  const latin = pdf.toString("latin1");

  // Inflate every FlateDecode content stream. Anything that fails to inflate is
  // an image or a font, not text.
  let content = "";
  const streamStart = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamStart.exec(latin)) !== null) {
    const start = match.index + match[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      content += zlib.inflateSync(pdf.subarray(start, end)).toString("latin1");
    } catch {
      // Not a deflated text stream.
    }
  }

  const pieces: string[] = [];

  // Hex runs: <48656c6c6f>
  for (const hex of content.matchAll(/<([0-9a-fA-F]+)>/g)) {
    pieces.push(hexToString(hex[1]));
  }

  // Literal runs: (Hello) Tj — pdfkit uses these when no kerning applies.
  for (const literal of content.matchAll(/\(((?:\\.|[^()\\])*)\)\s*Tj/g)) {
    pieces.push(literal[1].replace(/\\([()\\])/g, "$1"));
  }

  return pieces.join("");
}

/*
 * The 0x80–0x9F range of WinAnsiEncoding, which is where PDF's standard fonts put
 * the characters Latin-1 leaves undefined.
 *
 * The euro sign is the one that matters here: every amount on an invoice starts
 * with it, it lives at 0x80, and decoding it as raw Latin-1 yields an invisible
 * control character. That made a correct PDF look like it was missing all of its
 * totals — the check reported a defect that was entirely in the checker.
 */
const WIN_ANSI_HIGH: Record<number, string> = {
  0x80: "€", // €
  0x82: "‚",
  0x83: "ƒ",
  0x84: "„",
  0x85: "…",
  0x86: "†",
  0x87: "‡",
  0x88: "ˆ",
  0x89: "‰",
  0x8a: "Š",
  0x8b: "‹",
  0x8c: "Œ",
  0x8e: "Ž",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
  0x98: "˜",
  0x99: "™",
  0x9a: "š",
  0x9b: "›",
  0x9c: "œ",
  0x9e: "ž",
  0x9f: "Ÿ",
};

function hexToString(hex: string): string {
  const clean = hex.length % 2 === 0 ? hex : `${hex}0`;
  let out = "";
  for (let i = 0; i < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    out += WIN_ANSI_HIGH[code] ?? String.fromCharCode(code);
  }
  return out;
}

/**
 * Whether the text contains a phrase, ignoring the whitespace pdfkit introduces
 * between kerned runs. "€ 484,00" may come back as "€484,00" or "€  484,00"
 * depending on where the kerning fell.
 */
export function pdfContains(text: string, phrase: string): boolean {
  const strip = (value: string) => value.replace(/\s+/g, "").toLowerCase();
  return strip(text).includes(strip(phrase));
}
