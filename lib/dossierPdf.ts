import PDFDocument from "pdfkit";
import { formatEuros } from "@/lib/money";
import { formatDate, formatMinutes } from "@/lib/hours";

/*
 * The compliance dossier, as a document a facility can hand to an inspector.
 *
 * This is the artefact the whole product exists to produce. The app already shows
 * the same information on screen, but a screen is not something you attach to a
 * response, and "we have a system that tracks it" is a much weaker answer than a
 * dated PDF listing every assignment and what was true at the moment it was
 * accepted.
 *
 * Deliberately plain. It is evidence, not marketing — no logo, no colour, nothing
 * that invites the reader to wonder what else was styled for their benefit.
 */

export type DossierEntry = {
  freelancerName: string;
  qualification: string;
  startsAt: string;
  endsAt: string;
  minutes: number;
  rateCents: number;
  offeredAt: string;
  acceptedAt: string;
  couldDecline: boolean;
  substitutionAllowed: boolean;
  rateSetBy: string;
  declinedOtherOffers: number;
  modelAgreementVersion: string;
};

export type DossierInput = {
  facilityName: string;
  facilityKvk: string | null;
  generatedAt: Date;
  periodFrom: string | null;
  periodTo: string | null;
  entries: DossierEntry[];
};

const MARGIN = 45;

const RATE_SET_BY_LABELS: Record<string, string> = {
  facility_offer_accepted: "Instelling bood aan, zorgprofessional accepteerde",
  negotiated: "Onderhandeld",
  freelancer_quote: "Zorgprofessional gaf tarief op",
};

export function renderDossierPdf(input: DossierInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, font: "Helvetica" });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const width = doc.page.width - MARGIN * 2;

    doc.fontSize(16).font("Helvetica-Bold").text("Dossier zelfstandigheid", MARGIN, MARGIN);
    doc.fontSize(10).font("Helvetica").fillColor("#444444");
    doc.text(input.facilityName);
    if (input.facilityKvk) doc.text(`KvK ${input.facilityKvk}`);
    doc.text(`Opgesteld op ${formatDate(input.generatedAt)}`);
    if (input.periodFrom || input.periodTo) {
      doc.text(
        `Periode: ${input.periodFrom ? formatDate(input.periodFrom) : "begin"} tot en met ${
          input.periodTo ? formatDate(input.periodTo) : "heden"
        }`,
      );
    }
    doc.text(`${input.entries.length} opdracht(en)`);

    /*
     * States what the document is and is not, in the document itself. A dossier
     * that overstates its own weight is worse than none — the reader decides what
     * it proves, and finding an overreaching claim on page one colours everything
     * after it.
     */
    doc.moveDown(1);
    doc.fontSize(9).fillColor("#444444");
    doc.text(
      "Dit overzicht is automatisch samengesteld uit de vastlegging per opdracht op het moment " +
        "van aanvaarden. Het bevat geen juridisch oordeel over de arbeidsrelatie en is geen " +
        "vervanging van advies. Per opdracht is vastgelegd wie aanbood, wie accepteerde, welk " +
        "tarief is afgesproken en of weigeren mogelijk was.",
      { width },
    );

    doc.moveDown(1);
    doc.moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown(0.8);

    if (input.entries.length === 0) {
      doc.fontSize(11).fillColor("#000000").text("Geen opdrachten in deze periode.");
      doc.end();
      return;
    }

    for (const [index, entry] of input.entries.entries()) {
      /*
       * A page break mid-entry would split one assignment's evidence across two
       * pages, which is exactly the kind of thing that makes a reader doubt a
       * document. 150pt is comfortably more than the tallest entry below.
       */
      if (doc.y > doc.page.height - 150) doc.addPage();

      doc.fontSize(11).font("Helvetica-Bold").fillColor("#000000");
      doc.text(`${index + 1}. ${entry.freelancerName} — ${entry.qualification}`);

      doc.fontSize(9).font("Helvetica").fillColor("#333333");

      const line = (label: string, value: string) => {
        doc.text(`${label}: `, { continued: true }).font("Helvetica-Bold").text(value);
        doc.font("Helvetica");
      };

      line("Dienst", `${formatDate(entry.startsAt)} · ${formatMinutes(entry.minutes)}`);
      line("Tarief", `${formatEuros(entry.rateCents)} per uur`);
      line("Aangeboden op", formatDate(entry.offeredAt));
      line("Geaccepteerd op", formatDate(entry.acceptedAt));
      line("Kon weigeren", entry.couldDecline ? "Ja" : "Nee");
      line("Vervanging toegestaan", entry.substitutionAllowed ? "Ja" : "Nee");
      line("Tarief bepaald door", RATE_SET_BY_LABELS[entry.rateSetBy] ?? entry.rateSetBy);
      // The number that turns one acceptance into evidence of a market.
      line(
        "Gelijktijdig aangeboden aan",
        `${entry.declinedOtherOffers} andere zorgprofessional(s)`,
      );
      line("Modelovereenkomst", entry.modelAgreementVersion);

      doc.moveDown(0.8);
    }

    doc.end();
  });
}
