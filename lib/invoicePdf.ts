import PDFDocument from "pdfkit";
import { formatEuros } from "@/lib/money";
import { formatDate, formatMinutes } from "@/lib/hours";

/*
 * Renders the invoice PDF.
 *
 * The invoicing party is the FREELANCER, not MyQare. We generate the document on
 * their behalf, so their name, KvK and address are the sender throughout, and
 * MyQare appears only as a one-line footnote explaining how the document was
 * produced. Getting this backwards would make the invoice look like an agency
 * invoice, which is both wrong and precisely the impression the whole product is
 * built to avoid.
 */

export type InvoicePdfInput = {
  number: string;
  issuedOn: Date;
  dueOn: Date;
  freelancer: {
    /** Trading name from invoice_settings, falling back to the person's name. */
    name: string;
    kvk: string | null;
    bigNumber: string | null;
    email: string | null;
    address?: string | null;
    postcode?: string | null;
    city?: string | null;
    /*
     * btw-identificatienummer. Required on an invoice that charges VAT
     * (art. 35a Wet OB) and meaningless on an exempt one, so it is printed only
     * when present rather than shown as an empty field.
     */
    vatNumber?: string | null;
    iban?: string | null;
    accountHolder?: string | null;
  };
  /** Free text under the totals: payment instructions, a reference. */
  paymentNote?: string | null;
  facility: {
    name: string;
    kvk: string | null;
    address?: string | null;
    postcode?: string | null;
    city?: string | null;
  };
  line: {
    description: string;
    shiftDate: Date;
    minutes: number;
    rateCents: number;
  };
  amountExVatCents: number;
  vatRateBp: number;
  vatAmountCents: number;
  totalCents: number;
  vatNote: string;
};

const MARGIN = 50;

/**
 * Builds the PDF in memory and resolves the bytes.
 *
 * Buffered rather than streamed because the result goes straight into Supabase
 * Storage and is attached to an email — both want the whole thing, and an
 * invoice is a couple of pages at most.
 */
export function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Helvetica is one of the 14 fonts built into the PDF spec, so no font file
    // has to be bundled or found on disk at runtime — which is the usual way
    // pdfkit breaks in a serverless deployment.
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, font: "Helvetica" });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - MARGIN * 2;
    const right = doc.page.width - MARGIN;

    // ---- Sender: the freelancer ----
    doc.fontSize(18).font("Helvetica-Bold").text(input.freelancer.name, MARGIN, MARGIN);
    doc.fontSize(9).font("Helvetica").fillColor("#555555");
    if (input.freelancer.address) doc.text(input.freelancer.address);
    // Postcode and town on one line, the way a Dutch address is written.
    const town = [input.freelancer.postcode, input.freelancer.city].filter(Boolean).join("  ");
    if (town) doc.text(town);
    if (input.freelancer.kvk) doc.text(`KvK ${input.freelancer.kvk}`);
    if (input.freelancer.vatNumber) doc.text(`Btw-id ${input.freelancer.vatNumber}`);
    if (input.freelancer.bigNumber) doc.text(`BIG ${input.freelancer.bigNumber}`);
    if (input.freelancer.email) doc.text(input.freelancer.email);

    // ---- Invoice meta, right aligned ----
    doc.fillColor("#000000").fontSize(20).font("Helvetica-Bold");
    doc.text("FACTUUR", MARGIN, MARGIN, { width: pageWidth, align: "right" });
    doc.fontSize(9).font("Helvetica").fillColor("#555555");
    doc.text(`Factuurnummer: ${input.number}`, { width: pageWidth, align: "right" });
    doc.text(`Factuurdatum: ${formatDate(input.issuedOn)}`, { width: pageWidth, align: "right" });
    doc.text(`Vervaldatum: ${formatDate(input.dueOn)}`, { width: pageWidth, align: "right" });

    // ---- Recipient ----
    doc.moveDown(3);
    const recipientTop = doc.y;
    doc.fillColor("#555555").fontSize(9).text("Factuuradres", MARGIN, recipientTop);
    doc.fillColor("#000000").fontSize(11).font("Helvetica-Bold").text(input.facility.name);
    doc.fontSize(9).font("Helvetica").fillColor("#555555");
    if (input.facility.address) doc.text(input.facility.address);
    if (input.facility.postcode || input.facility.city) {
      doc.text([input.facility.postcode, input.facility.city].filter(Boolean).join("  "));
    }
    if (input.facility.kvk) doc.text(`KvK ${input.facility.kvk}`);

    // ---- Line items ----
    doc.moveDown(2);
    const tableTop = doc.y;
    const colDescription = MARGIN;
    const colHours = MARGIN + 300;
    const colRate = MARGIN + 375;
    const colAmount = MARGIN + 450;

    doc.fontSize(9).font("Helvetica-Bold").fillColor("#000000");
    doc.text("Omschrijving", colDescription, tableTop);
    doc.text("Uren", colHours, tableTop, { width: 60, align: "right" });
    doc.text("Tarief", colRate, tableTop, { width: 60, align: "right" });
    doc.text("Bedrag", colAmount, tableTop, { width: right - colAmount, align: "right" });

    doc
      .moveTo(MARGIN, tableTop + 14)
      .lineTo(right, tableTop + 14)
      .strokeColor("#cccccc")
      .stroke();

    const rowTop = tableTop + 22;
    doc.font("Helvetica").fillColor("#000000");
    doc.text(`${input.line.description} — ${formatDate(input.line.shiftDate)}`, colDescription, rowTop, {
      width: 290,
    });
    doc.text(formatMinutes(input.line.minutes), colHours, rowTop, { width: 60, align: "right" });
    doc.text(formatEuros(input.line.rateCents), colRate, rowTop, { width: 60, align: "right" });
    doc.text(formatEuros(input.amountExVatCents), colAmount, rowTop, {
      width: right - colAmount,
      align: "right",
    });

    // ---- Totals ----
    let y = rowTop + 40;
    const labelX = MARGIN + 330;
    const valueX = colAmount;
    const valueWidth = right - colAmount;

    const totalRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9);
      doc.text(label, labelX, y, { width: 115, align: "right" });
      doc.text(value, valueX, y, { width: valueWidth, align: "right" });
      y += bold ? 18 : 14;
    };

    totalRow("Subtotaal", formatEuros(input.amountExVatCents));

    // An exempt invoice shows the exemption rather than a silent "0,00" — the
    // facility's bookkeeper needs to see WHY no VAT was charged.
    if (input.vatRateBp > 0) {
      totalRow(`Btw ${input.vatRateBp / 100}%`, formatEuros(input.vatAmountCents));
    } else {
      totalRow("Btw", "vrijgesteld");
    }

    doc.moveTo(labelX, y + 2).lineTo(right, y + 2).strokeColor("#cccccc").stroke();
    y += 8;
    totalRow("Totaal", formatEuros(input.totalCents), true);

    // ---- Footnotes ----
    doc.moveDown(4);
    doc.fontSize(8).fillColor("#555555").font("Helvetica");
    doc.text(input.vatNote, MARGIN, Math.max(doc.y, y + 30), { width: pageWidth });
    doc.moveDown(0.5);
    /*
     * Where the money goes. An invoice without an account number gets paid late
     * or not at all, and chasing it is the work a freelancer came here to avoid —
     * so lib/invoiceSettings.ts refuses to issue one without an IBAN.
     */
    const term = Math.round((input.dueOn.getTime() - input.issuedOn.getTime()) / 86_400_000);
    if (input.freelancer.iban) {
      const holder = input.freelancer.accountHolder || input.freelancer.name;
      doc.text(
        `Te voldoen binnen ${term} dagen na factuurdatum op ${input.freelancer.iban} ` +
          `ten name van ${holder}, onder vermelding van factuurnummer ${input.number}.`,
        { width: pageWidth },
      );
    } else {
      doc.text(`Te voldoen binnen ${term} dagen na factuurdatum.`, { width: pageWidth });
    }

    if (input.paymentNote) {
      doc.moveDown(0.5);
      doc.text(input.paymentNote, { width: pageWidth });
    }

    doc.moveDown(0.5);
    doc.text(
      `Deze factuur is namens ${input.freelancer.name} automatisch opgemaakt via MyQare. ` +
        "MyQare is geen partij bij de opdracht en brengt de zorginstelling niets in rekening.",
      { width: pageWidth },
    );

    doc.end();
  });
}
