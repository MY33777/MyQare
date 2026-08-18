import { describe, expect, it } from "vitest";
import { csvEuros, csvFilename, csvHours, toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("emits semicolon-separated rows with a UTF-8 BOM", () => {
    const out = toCsv(["a", "b"], [["1", "2"]]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toContain('"a";"b"');
    expect(out).toContain('"1";"2"');
  });

  it("uses CRLF line endings", () => {
    expect(toCsv(["a"], [["1"]])).toBe('﻿"a"\r\n"1"\r\n');
  });

  it("escapes embedded quotes by doubling them", () => {
    expect(toCsv(["a"], [['he said "hi"']])).toContain('"he said ""hi"""');
  });

  it("keeps a semicolon inside a cell from splitting the row", () => {
    const out = toCsv(["a", "b"], [["een; twee", "drie"]]);
    expect(out).toContain('"een; twee";"drie"');
  });

  it("renders null and undefined as empty cells rather than the words", () => {
    const out = toCsv(["a", "b"], [[null, undefined]]);
    expect(out).toContain('"";""');
    expect(out).not.toMatch(/null|undefined/);
  });

  /*
   * Formula injection. These exports carry names and descriptions typed by other
   * users, and a cell starting with =, +, - or @ is EXECUTED when the file opens in
   * Excel or Sheets — inside the accountant's spreadsheet, not ours.
   */
  it("neutralises a formula in a name", () => {
    const attack = '=HYPERLINK("https://evil.example","Klik")';
    const out = toCsv(["naam"], [[attack]]);
    // Still present as readable text, but no longer starts with '='.
    expect(out).toContain("HYPERLINK");
    expect(out).not.toContain('"=HYPERLINK');
    expect(out).toContain('"\t=HYPERLINK');
  });

  it("neutralises every dangerous leading character", () => {
    for (const prefix of ["=", "+", "-", "@"]) {
      const out = toCsv(["x"], [[`${prefix}cmd`]]);
      expect(out, `prefix ${prefix} not neutralised`).toContain(`"\t${prefix}cmd"`);
    }
  });

  it("leaves ordinary text alone", () => {
    expect(toCsv(["x"], [["J. de Vries"]])).toContain('"J. de Vries"');
  });

  /*
   * A negative amount legitimately starts with a hyphen, so it gets the tab too.
   * That is the right trade: the cell still reads as -484,00 and a spreadsheet
   * treats it as text rather than executing it. Amounts that must stay summable go
   * through csvEuros in their own column.
   */
  it("treats a leading hyphen as dangerous, since Excel does", () => {
    expect(toCsv(["x"], [["-484,00"]])).toContain('"\t-484,00"');
  });
});

describe("csvEuros", () => {
  it("formats cents as a Dutch decimal with no currency symbol", () => {
    expect(csvEuros(48_400)).toBe("484,00");
    expect(csvEuros(5)).toBe("0,05");
    expect(csvEuros(0)).toBe("0,00");
  });

  it("pads the cents", () => {
    expect(csvEuros(40_005)).toBe("400,05");
  });

  it("handles negatives without losing a digit", () => {
    expect(csvEuros(-2_420)).toBe("-24,20");
  });

  /*
   * No euro sign on purpose. A currency symbol makes every amount a text cell, and
   * an accountant who cannot sum the column will retype the whole file.
   */
  it("never includes a currency symbol", () => {
    expect(csvEuros(48_400)).not.toMatch(/[€$]/);
  });
});

describe("csvHours", () => {
  it("converts minutes to decimal hours", () => {
    expect(csvHours(450)).toBe("7,50");
    expect(csvHours(480)).toBe("8,00");
  });

  it("rounds to two decimals", () => {
    expect(csvHours(465)).toBe("7,75");
    expect(csvHours(50)).toBe("0,83");
  });
});

describe("csvFilename", () => {
  it("slugs the name and stamps the date", () => {
    expect(csvFilename("facturen", "Zorggroep De Maasoever")).toMatch(
      /^facturen-zorggroep-de-maasoever-\d{4}-\d{2}-\d{2}\.csv$/,
    );
  });

  it("strips diacritics and punctuation, so the header stays valid", () => {
    const name = csvFilename("facturen", "Zörg & Welzijn B.V.");
    expect(name).toMatch(/^facturen-zorg-welzijn-b-v-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(name).not.toMatch(/[^a-z0-9.\-]/);
  });
});
