import { describe, expect, it } from "vitest";
import { renderDossierPdf, type DossierEntry, type DossierInput } from "@/lib/dossierPdf";
import { extractPdfText, pdfContains } from "@/lib/pdfText";

/*
 * The dossier is the artefact the product exists to produce, and the one a
 * facility hands to an inspector. These tests render it and read the text back,
 * because a document that opens cleanly and omits the evidence is the failure that
 * matters.
 */

function entry(overrides: Partial<DossierEntry> = {}): DossierEntry {
  return {
    freelancerName: "J. de Vries",
    qualification: "Verzorgende IG",
    startsAt: "2026-08-14T05:00:00.000Z",
    endsAt: "2026-08-14T13:00:00.000Z",
    minutes: 450,
    rateCents: 4250,
    offeredAt: "2026-08-10T09:00:00.000Z",
    acceptedAt: "2026-08-11T14:30:00.000Z",
    couldDecline: true,
    substitutionAllowed: false,
    rateSetBy: "facility_offer_accepted",
    declinedOtherOffers: 11,
    modelAgreementVersion: "2026-08-v1",
    ...overrides,
  };
}

function dossier(entries: DossierEntry[]): DossierInput {
  return {
    facilityName: "Zorggroep De Maasoever",
    facilityKvk: "12345678",
    generatedAt: new Date("2026-08-18T00:00:00Z"),
    periodFrom: null,
    periodTo: null,
    entries,
  };
}

describe("renderDossierPdf", () => {
  it("produces a real PDF", async () => {
    const pdf = await renderDossierPdf(dossier([entry()]));
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(800);
  });

  it("identifies the facility and the period", async () => {
    const input = dossier([entry()]);
    input.periodFrom = "2026-08-01";
    input.periodTo = "2026-08-31";
    const text = extractPdfText(await renderDossierPdf(input));

    expect(pdfContains(text, "Dossier zelfstandigheid")).toBe(true);
    expect(pdfContains(text, "Zorggroep De Maasoever")).toBe(true);
    expect(pdfContains(text, "KvK 12345678")).toBe(true);
    expect(pdfContains(text, "1 opdracht")).toBe(true);
  });

  /*
   * The four facts a schijnzelfstandigheid check actually asks about. If any of
   * these stops appearing, the document has quietly become decorative.
   */
  it("carries the evidence the dossier exists for", async () => {
    const text = extractPdfText(await renderDossierPdf(dossier([entry()])));

    expect(pdfContains(text, "J. de Vries")).toBe(true);
    expect(pdfContains(text, "Kon weigeren: Ja")).toBe(true);
    expect(pdfContains(text, "Instelling bood aan")).toBe(true);
    expect(pdfContains(text, "2026-08-v1")).toBe(true);
    // A shift offered to twelve and taken by one is evidence of a market.
    expect(pdfContains(text, "11 andere")).toBe(true);
  });

  it("states its own limits rather than overclaiming", async () => {
    const text = extractPdfText(await renderDossierPdf(dossier([entry()])));
    expect(pdfContains(text, "geen juridisch oordeel")).toBe(true);
  });

  it("says so plainly when a period has no assignments", async () => {
    const text = extractPdfText(await renderDossierPdf(dossier([])));
    expect(pdfContains(text, "Geen opdrachten in deze periode")).toBe(true);
  });

  /*
   * Pagination. Thirty assignments run well past one page, and the guard that
   * pushes an entry to a new page rather than splitting it is easy to break.
   */
  it("paginates a long dossier without losing entries", async () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      entry({ freelancerName: `Zorgverlener ${index + 1}` }),
    );
    const text = extractPdfText(await renderDossierPdf(dossier(many)));

    expect(pdfContains(text, "Zorgverlener 1")).toBe(true);
    expect(pdfContains(text, "Zorgverlener 15")).toBe(true);
    expect(pdfContains(text, "Zorgverlener 30")).toBe(true);
    expect(pdfContains(text, "30 opdracht")).toBe(true);
  });

  it("renders a declined-substitution and negotiated-rate entry correctly", async () => {
    const text = extractPdfText(
      await renderDossierPdf(
        dossier([entry({ substitutionAllowed: true, rateSetBy: "negotiated" })]),
      ),
    );
    expect(pdfContains(text, "Vervanging toegestaan: Ja")).toBe(true);
    expect(pdfContains(text, "Onderhandeld")).toBe(true);
  });

  it("does not leak undefined when a name is missing", async () => {
    const text = extractPdfText(
      await renderDossierPdf(dossier([entry({ freelancerName: "Onbekend" })])),
    );
    expect(text).not.toMatch(/undefined|null/i);
  });
});
