/*
 * Renders a sample invoice to disk so it can actually be looked at.
 *
 * The PDF is the only artefact a customer's accountant ever sees, and it is the
 * one part of the product that cannot be checked by a unit test or by loading a
 * page — it needs a database, an approved timesheet and a real assignment before
 * the app will produce one. This bypasses all of that.
 *
 * Usage:
 *   npx tsx scripts/preview-invoice.mts [outdir]
 *
 * Renders three cases, because the interesting differences are between them:
 * VAT-exempt (the common case for BIG-registered care), taxable at 21%, and a
 * long shift with awkward rounding.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderInvoicePdf, type InvoicePdfInput } from "../lib/invoicePdf";
import { assignmentValueCents } from "../lib/fees";
import { invoiceAmounts } from "../lib/vat";
import { dueDate } from "../lib/invoiceNumber";
import { formatEuros } from "../lib/money";
import { formatMinutes } from "../lib/hours";
import { extractPdfText, pdfContains } from "../lib/pdfText";

const outDir = process.argv[2] ?? join(process.cwd(), ".preview");
mkdirSync(outDir, { recursive: true });

const ISSUED = new Date("2026-08-18T00:00:00Z");

type Case = {
  file: string;
  label: string;
  minutes: number;
  rateCents: number;
  vatExempt: boolean | null;
};

const CASES: Case[] = [
  {
    file: "invoice-exempt.pdf",
    label: "Vrijgesteld (BIG-geregistreerd)",
    minutes: 450,
    rateCents: 4250,
    vatExempt: true,
  },
  {
    file: "invoice-taxable.pdf",
    label: "Belast met 21% btw",
    minutes: 480,
    rateCents: 5000,
    vatExempt: false,
  },
  {
    file: "invoice-awkward.pdf",
    label: "Lange dienst met lastige afronding",
    minutes: 731,
    rateCents: 3333,
    vatExempt: false,
  },
];

function build(testCase: Case): InvoicePdfInput {
  const net = assignmentValueCents(testCase.minutes, testCase.rateCents);
  const amounts = invoiceAmounts(net, testCase.vatExempt);

  return {
    number: "2026-0042",
    issuedOn: ISSUED,
    dueOn: dueDate(ISSUED),
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
      description: "Verzorgende IG (VIG'er)",
      shiftDate: new Date("2026-08-14T05:00:00Z"),
      minutes: testCase.minutes,
      rateCents: testCase.rateCents,
    },
    amountExVatCents: amounts.amountExVatCents,
    vatRateBp: amounts.vatRateBp,
    vatAmountCents: amounts.vatAmountCents,
    totalCents: amounts.totalCents,
    vatNote: amounts.vatNote,
  };
}

for (const testCase of CASES) {
  const input = build(testCase);
  const pdf = await renderInvoicePdf(input);

  const path = join(outDir, testCase.file);
  writeFileSync(path, pdf);

  // A PDF that is not a PDF is the failure this script exists to catch — pdfkit
  // resolving an empty or truncated buffer would otherwise only surface as a
  // corrupt attachment in a customer's inbox.
  const header = pdf.subarray(0, 5).toString("latin1");

  /*
   * Reading the text back is the check that matters. A valid PDF header proves
   * almost nothing — the failure worth catching is a document that opens fine and
   * shows the wrong amount, or a blank one where a field was undefined.
   */
  const text = extractPdfText(pdf);
  const required = [
    "FACTUUR",
    input.number,
    input.freelancer.name,
    input.facility.name,
    input.line.description,
    formatEuros(input.totalCents),
  ];
  const missing = required.filter((phrase) => !pdfContains(text, phrase));

  const ok = header === "%PDF-" && pdf.length > 800 && missing.length === 0;

  console.log(
    [
      ok ? "OK  " : "FAIL",
      testCase.file.padEnd(22),
      `${(pdf.length / 1024).toFixed(1)}kB`.padStart(8),
      formatMinutes(testCase.minutes).padStart(9),
      formatEuros(input.amountExVatCents).padStart(12),
      `btw ${formatEuros(input.vatAmountCents)}`.padStart(16),
      `totaal ${formatEuros(input.totalCents)}`.padStart(20),
      testCase.label,
    ].join("  "),
  );

  if (missing.length > 0) console.log(`     missing from PDF text: ${missing.join(" | ")}`);
  if (!ok) process.exitCode = 1;
}

console.log(`\nWritten to ${outDir}`);
