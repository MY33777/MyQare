import { describe, expect, it } from "vitest";
import { renderInvoicePdf, type InvoicePdfInput } from "@/lib/invoicePdf";
import { extractPdfText, pdfContains } from "@/lib/pdfText";
import { assignmentValueCents } from "@/lib/fees";
import { invoiceAmounts } from "@/lib/vat";
import { formatEuros } from "@/lib/money";

/*
 * The invoice is the only artefact a customer's accountant ever sees, and it is
 * the hardest thing in the product to check by hand — producing one through the
 * app needs a database, an approved timesheet and a real assignment.
 *
 * So these tests render the real PDF and read the text back out of it. "It is a
 * valid PDF" is a much weaker claim than "it says € 484,00", and the failure worth
 * catching is a document that opens perfectly and shows the wrong number.
 */

const ISSUED = new Date("2026-08-18T00:00:00Z");
const DUE = new Date("2026-09-17T00:00:00Z");

function invoice(minutes: number, rateCents: number, vatExempt: boolean | null): InvoicePdfInput {
  const net = assignmentValueCents(minutes, rateCents);
  const amounts = invoiceAmounts(net, vatExempt);
  return {
    number: "2026-0042",
    issuedOn: ISSUED,
    dueOn: DUE,
    freelancer: {
      name: "J. de Vries",
      kvk: "87654321",
      bigNumber: "19012345678",
      email: "j.devries@example.nl",
      address: "Voorbeeldstraat 12, 3011 AA Rotterdam",
    },
    facility: {
      name: "Zorggroep De Maasoever",
      kvk: "12345678",
      address: "Zorglaan 8",
      postcode: "3021 BB",
      city: "Rotterdam",
    },
    line: {
      description: "Verzorgende IG",
      shiftDate: new Date("2026-08-14T05:00:00Z"),
      minutes,
      rateCents,
    },
    amountExVatCents: amounts.amountExVatCents,
    vatRateBp: amounts.vatRateBp,
    vatAmountCents: amounts.vatAmountCents,
    totalCents: amounts.totalCents,
    vatNote: amounts.vatNote,
  };
}

describe("renderInvoicePdf", () => {
  it("produces a real PDF file", async () => {
    const pdf = await renderInvoicePdf(invoice(480, 5000, false));
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(800);
  });

  it("carries both parties, so the invoice can identify itself", async () => {
    const pdf = await renderInvoicePdf(invoice(480, 5000, false));
    const text = extractPdfText(pdf);

    for (const phrase of [
      "FACTUUR",
      "2026-0042",
      "J. de Vries",
      "KvK 87654321",
      "BIG 19012345678",
      "Zorggroep De Maasoever",
      "Verzorgende IG",
    ]) {
      expect(pdfContains(text, phrase), `missing: ${phrase}`).toBe(true);
    }
  });

  /*
   * The amounts. If any of these ever stops matching, somebody is being invoiced a
   * number the app never showed them.
   */
  it("prints the taxable amounts it was given", async () => {
    const input = invoice(480, 5000, false);
    const text = extractPdfText(await renderInvoicePdf(input));

    expect(input.totalCents).toBe(48_400); // €400 + 21%
    expect(pdfContains(text, formatEuros(input.amountExVatCents))).toBe(true);
    expect(pdfContains(text, formatEuros(input.vatAmountCents))).toBe(true);
    expect(pdfContains(text, formatEuros(input.totalCents))).toBe(true);
  });

  it("prints awkward rounding exactly as computed", async () => {
    const input = invoice(731, 3333, false);
    const text = extractPdfText(await renderInvoicePdf(input));

    expect(input.amountExVatCents).toBe(40_607);
    expect(input.totalCents).toBe(49_134);
    expect(pdfContains(text, formatEuros(input.totalCents))).toBe(true);
  });

  /*
   * An exempt invoice must SAY it is exempt rather than showing a silent € 0,00.
   * The facility's bookkeeper needs to see why no VAT was charged.
   */
  it("spells out the exemption instead of showing a zero", async () => {
    const input = invoice(450, 4250, true);
    const text = extractPdfText(await renderInvoicePdf(input));

    expect(input.vatAmountCents).toBe(0);
    expect(pdfContains(text, "vrijgesteld")).toBe(true);
    expect(pdfContains(text, formatEuros(input.totalCents))).toBe(true);
  });

  /*
   * MyQare must appear as the tool that produced the document, never as the
   * invoicing party. An invoice that reads like it came from an agency undermines
   * the exact impression the rest of the product is built to create.
   */
  it("names the freelancer as the sender and MyQare only as the tool", async () => {
    const text = extractPdfText(await renderInvoicePdf(invoice(480, 5000, false)));

    expect(pdfContains(text, "namens J. de Vries")).toBe(true);
    expect(pdfContains(text, "MyQare is geen partij bij de opdracht")).toBe(true);
  });

  it("survives a freelancer with no KvK or BIG number on file", async () => {
    const input = invoice(480, 5000, false);
    input.freelancer.kvk = null;
    input.freelancer.bigNumber = null;
    input.freelancer.address = null;

    const pdf = await renderInvoicePdf(input);
    const text = extractPdfText(pdf);

    // No "undefined" or "null" leaking onto a document sent to a customer.
    expect(text).not.toMatch(/undefined|null/i);
    expect(pdfContains(text, "J. de Vries")).toBe(true);
  });
});

describe("extractPdfText", () => {
  /*
   * Regression guard for the checker itself. PDF standard fonts use
   * WinAnsiEncoding, where € is byte 0x80 rather than U+20AC — decoding it as raw
   * Latin-1 turns it into an invisible control character and makes every amount
   * on a perfectly good invoice look missing.
   */
  it("decodes the euro sign out of WinAnsiEncoding", async () => {
    const text = extractPdfText(await renderInvoicePdf(invoice(480, 5000, false)));
    expect(text).toContain("€");
  });

  it("reassembles strings that kerning split across hex runs", async () => {
    // "J. de Vries" is emitted as four separate hex chunks with kern values
    // between them, so a naive substring search over the stream finds nothing.
    const text = extractPdfText(await renderInvoicePdf(invoice(480, 5000, false)));
    expect(pdfContains(text, "J. de Vries")).toBe(true);
  });
});
