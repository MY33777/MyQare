import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { winAnsiSafe, needsTransliteration } from "@/lib/winAnsi";

/*
 * The bug this exists to prevent, stated as a test.
 *
 * pdfkit declares the standard-14 fonts /WinAnsiEncoding and writes one byte per
 * character as two hex digits. Given a character outside WinAnsi it writes the
 * CODEPOINT instead — three digits for U+0141 — so the hex string becomes
 * odd-length and every byte after it is read a nibble out of step. The PDF still
 * opens. It just says something else from that point on.
 *
 * Both documents this product exists to produce print people's names, and Polish,
 * Turkish, Czech and Hungarian names are entirely ordinary in Dutch healthcare.
 */

/** Renders the strings uncompressed and returns the hex runs pdfkit emitted. */
function hexRuns(strings: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ font: "Helvetica", compress: false });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => {
      const raw = Buffer.concat(chunks).toString("latin1");
      resolve([...raw.matchAll(/<([0-9A-Fa-f]+)>/g)].map((match) => match[1]));
    });
    for (const value of strings) doc.text(value);
    doc.end();
  });
}

const AWKWARD = [
  "Łukasz Wiśniewski",
  "Ayşe Yıldız",
  "İstanbul",
  "Þór Jónsson",
  "Đorđe",
];

const FINE = ["Zoë Müller", "Renée Bakker", "€ 42,50", "Jan de Vries", "Aïcha"];

describe("winAnsiSafe", () => {
  it("reproduces the corruption when it is NOT applied", async () => {
    // Guards the premise. If pdfkit ever fixes this, the test fails loudly and
    // the transliteration can be reconsidered rather than carried forever.
    const runs = await hexRuns(["Łukasz"]);
    expect(runs.some((run) => run.length % 2 !== 0)).toBe(true);
  });

  it("produces only even-length runs for names that would have broken", async () => {
    const runs = await hexRuns(AWKWARD.map(winAnsiSafe));
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.filter((run) => run.length % 2 !== 0)).toEqual([]);
  });

  it("leaves everything WinAnsi can already represent untouched", () => {
    // Dutch and German diacritics, and the euro sign, are all in CP1252. Stripping
    // them would be a regression dressed as a fix.
    for (const value of FINE) {
      expect(needsTransliteration(value)).toBe(false);
      expect(winAnsiSafe(value)).toBe(value);
    }
  });

  it("transliterates rather than deleting", () => {
    expect(winAnsiSafe("Łukasz")).toBe("Lukasz");
    expect(winAnsiSafe("Wiśniewski")).toBe("Wisniewski");
    expect(winAnsiSafe("Ayşe")).toBe("Ayse");
    expect(winAnsiSafe("Yıldız")).toBe("Yildiz");
    expect(winAnsiSafe("İstanbul")).toBe("Istanbul");
  });

  it("never returns an empty string for a non-empty name", () => {
    // A name rendered as nothing is a document that appears to be about nobody.
    for (const value of [...AWKWARD, "日本語", "العربية"]) {
      expect(winAnsiSafe(value).length).toBeGreaterThan(0);
    }
  });

  it("leaves empty input alone", () => {
    expect(winAnsiSafe("")).toBe("");
  });
});
