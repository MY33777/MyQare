import PDFDocument from "pdfkit";
import { winAnsiSafe } from "@/lib/winAnsi";
import { formatEuros } from "@/lib/money";
import { DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/documents";
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

/*
 * Routes every string through winAnsiSafe on its way to the page.
 *
 * Wrapping the method once rather than each of the forty call sites: pdfkit
 * corrupts the REST of a text run when it meets a character outside WinAnsi, so a
 * single missed call would silently mangle a name — and the next person to add a
 * doc.text() would have no way to know they had to remember. See lib/winAnsi.ts.
 */
function guardText(doc: PDFKit.PDFDocument): void {
  const original = doc.text.bind(doc);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (doc as any).text = (value: unknown, ...rest: unknown[]) =>
    original(typeof value === "string" ? winAnsiSafe(value) : (value as string), ...(rest as []));
}

/** One approved document, as at the moment the shift was accepted. */
/**
 * The tallest an entry gets, in points, with room to spare.
 *
 * Measured at 161pt for a two-document entry; 200 leaves headroom for a longer
 * document list and a wrapped facility name without another round of arithmetic.
 */
const ENTRY_HEIGHT = 200;

export type DossierDocument = {
  kind: string;
  issuedOn: string | null;
  expiresOn: string | null;
  reviewedAt: string | null;
};

export type DossierEntry = {
  freelancerName: string;
  qualification: string;
  /*
   * The two numbers that make this document worth anything.
   *
   * The dossier is what a facility hands an inspector to show that the person who
   * worked that night was an independent contractor and was qualified to do it —
   * and it named neither the KvK registration that establishes the first nor the
   * BIG number that establishes the second. A name and a job title prove neither.
   *
   * Nullable, and printed as "niet vastgelegd" when absent, because saying so is
   * the honest answer and inventing a blank line is not: a facility reading its
   * own dossier should be able to see which engagements are thin.
   */
  kvk: string | null;
  bigNumber: string | null;
  bigVerifiedAt: string | null;
  /*
   * The papers the facility had accepted when it engaged this person.
   *
   * This is the Wkkgz half of the document. The facility's duty is to have
   * checked qualifications BEFORE deployment, and the dossier is what it hands an
   * inspector to show it did. Until now that evidence lived only in the
   * `documents` rows — which anonymise_account deletes, on the strength of a
   * comment saying the snapshot preserved it. The snapshot did capture it, from
   * migration 027 onwards. Nothing rendered it, in any screen, export or PDF, so
   * the deletion destroyed the only proof that survived.
   *
   * `null` means the record predates the capture and is genuinely unknown; an
   * empty array means the snapshot was taken and the person had no approved
   * documents at that moment. Those are different facts and the document says so.
   */
  documents: DossierDocument[] | null;
  /*
   * Whether the work actually happened.
   *
   * A cancelled assignment printed here as a full evidence entry — name, date,
   * duration, rate, papers — with nothing saying the shift was never worked. And
   * because assignments_shift_id_active_idx is a PARTIAL unique index (`where
   * status <> 'cancelled'`) and cancel_assignment reopens a future shift, ONE
   * night can carry two compliance records. The dossier printed both, so an
   * inspector asking "who worked ward X on 14 August" was handed two names and no
   * way to tell which.
   *
   * Kept rather than filtered out: that somebody accepted and then could not go
   * is part of the record, and a dossier that quietly drops rows is a dossier
   * somebody can accuse of being edited. It just has to say so.
   */
  cancelled: boolean;
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
  /**
   * Set when more assignments exist than this document carries.
   *
   * A dossier's whole value is being complete. One that quietly stops at a cap
   * looks complete and is not, which is worse than one that says where it stops —
   * an inspector who later finds the missing period has reason to doubt the rest.
   */
  truncatedAt?: number | null;
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
    guardText(doc);

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

    if (input.truncatedAt) {
      doc.fillColor("#a3201c");
      doc.text(
        `LET OP: dit overzicht is afgekapt op ${input.truncatedAt} opdrachten. ` +
          "Er zijn er meer in deze periode. Verklein de periode om een volledig overzicht te krijgen.",
      );
      doc.fillColor("#444444");
    }

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
       * document.
       *
       * Measured against the bottom MARGIN, not the page height, and against the
       * entry's real height. The old test compared `doc.y` to
       * `page.height - 150`, which with a 45pt bottom margin guarantees only
       * 105pt of usable space — while the entry grew to twelve lines when
       * "Documenten bij aanvang" was added. Rendering eight typical entries put
       * roughly one in three across a boundary, with the compliance statements on
       * one page and the name they belong to on the previous one.
       *
       * ENTRY_HEIGHT is deliberately generous. Reserving too much costs a page
       * break that was not strictly needed; reserving too little costs the
       * document its credibility.
       */
      if (doc.y > doc.page.height - doc.page.margins.bottom - ENTRY_HEIGHT) doc.addPage();

      doc.fontSize(11).font("Helvetica-Bold").fillColor("#000000");
      doc.text(
        `${index + 1}. ${entry.freelancerName} — ${entry.qualification}` +
          (entry.cancelled ? "  (geannuleerd — niet gewerkt)" : ""),
      );

      doc.fontSize(9).font("Helvetica").fillColor("#333333");

      const line = (label: string, value: string) => {
        doc.text(`${label}: `, { continued: true }).font("Helvetica-Bold").text(value);
        doc.font("Helvetica");
      };

      /*
       * Identity and competence first, before the commercial detail. This is the
       * order an inspector reads in: who was this, were they allowed to do it,
       * and only then what it cost.
       */
      line("KvK-nummer", entry.kvk?.trim() || "niet vastgelegd");
      line(
        "BIG-nummer",
        entry.bigNumber?.trim()
          ? entry.bigVerifiedAt
            ? `${entry.bigNumber} (gecontroleerd op ${formatDate(entry.bigVerifiedAt)})`
            : `${entry.bigNumber} (nog niet gecontroleerd)`
          : "niet van toepassing of niet vastgelegd",
      );

      /*
       * The papers, as at acceptance — and an explicit sentence when there were
       * none, rather than an omitted line. A missing line reads as an oversight;
       * a stated absence reads as a fact, and on a Wkkgz question the difference
       * is the whole point of the document.
       */
      if (entry.documents === null) {
        line("Documenten bij aanvang", "niet vastgelegd voor deze opdracht");
      } else if (entry.documents.length === 0) {
        line("Documenten bij aanvang", "geen goedgekeurde documenten op dat moment");
      } else {
        line(
          "Documenten bij aanvang",
          entry.documents
            .map((doc) => {
              const label = DOCUMENT_KIND_LABELS[doc.kind as DocumentKind] ?? doc.kind;
              const checked = doc.reviewedAt ? `goedgekeurd ${formatDate(doc.reviewedAt)}` : null;
              const valid = doc.expiresOn ? `geldig tot ${formatDate(doc.expiresOn)}` : null;
              const detail = [checked, valid].filter(Boolean).join(", ");
              return detail ? `${label} (${detail})` : label;
            })
            .join(" · "),
        );
      }

      /*
       * Said twice, in the heading and here. The heading is what a reader scans;
       * this line is what they read when they stop. On the one question this
       * document exists to answer, saying it once is not enough.
       */
      if (entry.cancelled) {
        line(
          "Status",
          "Geannuleerd — deze dienst is aangenomen maar niet gewerkt. Geen factuur, geen uren.",
        );
      }

      line("Dienst", `${formatDate(entry.startsAt)} · ${formatMinutes(entry.minutes)}`);
      line("Tarief", `${formatEuros(entry.rateCents)} per uur`);
      line("Aangeboden op", formatDate(entry.offeredAt));
      line("Geaccepteerd op", formatDate(entry.acceptedAt));
      line("Kon weigeren", entry.couldDecline ? "Ja" : "Nee");

      /*
       * Says what is actually known, which is narrower than "Nee".
       *
       * substitution_allowed is hardcoded false in accept_shift. That is true
       * about the PLATFORM — a shift is accepted by one named person and only
       * they can submit hours — and it is not a term the two parties agreed. They
       * may well have arranged otherwise between themselves, and this document
       * has no way to know.
       *
       * Printing a flat "Nee" turned a fact about our software into a claim about
       * their contract, on the one criterion where the Belastingdienst is most
       * interested in the answer. A dossier that overstates what it knows is
       * worth less than one that says less.
       */
      line(
        "Vervanging via het platform",
        entry.substitutionAllowed
          ? "Mogelijk"
          : "Niet ondersteund — wat partijen onderling afspraken staat hier niet vast",
      );
      line("Tarief bepaald door", RATE_SET_BY_LABELS[entry.rateSetBy] ?? entry.rateSetBy);
      // The number that turns one acceptance into evidence of a market.
      line(
        "Gelijktijdig aangeboden aan",
        `${entry.declinedOtherOffers} andere zorgprofessional(s)`,
      );
      // Says so plainly when there is no agreement, rather than printing a version
      // string that implies one existed. See MODEL_AGREEMENT_VERSION.
      line(
        "Modelovereenkomst",
        entry.modelAgreementVersion === "geen-modelovereenkomst"
          ? "Geen — niet vastgelegd voor deze opdracht"
          : entry.modelAgreementVersion,
      );

      doc.moveDown(0.8);
    }

    doc.end();
  });
}
