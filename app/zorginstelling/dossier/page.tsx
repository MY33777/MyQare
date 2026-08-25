import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { requireFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMinutes, formatShiftWindow } from "@/lib/hours";
import { formatEuros } from "@/lib/money";
import { qualificationLabel } from "@/lib/qualifications";
import { DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/documents";

export const metadata: Metadata = { title: "Dossier" };

/**
 * How many records this SCREEN lists. The pdf export has its own, higher cap.
 *
 * Printed in the footer when reached: the line used to read "N opdrachten
 * vastgelegd", which stated a page limit as the total number of assignments on
 * record.
 */
const DOSSIER_PAGE_CAP = 100;

/**
 * How many records the EXPORT reads, and therefore how far the person filter
 * beside it has to see. Kept equal to the export route's own cap on purpose: a
 * dropdown that offers fewer people than the document can contain is the defect
 * this constant exists to prevent.
 */
const DOSSIER_EXPORT_CAP = 1000;

type DossierRow = {
  assignment_id: string;
  model_agreement_version: string;
  /*
   * Everything as it was at acceptance.
   *
   * The EXPORT was moved onto this in round 6; this page was not, and its own
   * footer says a snapshot is kept. So the screen went on rebuilding every
   * column from live joins — the thing the snapshot exists to prevent — while
   * telling the reader otherwise.
   */
  snapshot: unknown;
  offered_at: string;
  accepted_at: string;
  could_decline: boolean;
  substitution_allowed: boolean;
  rate_set_by: string;
  declined_other_offers: number;
  assignments: {
    id: string;
    agreed_rate_cents: number;
    status: string;
    freelancer_id: string;
    freelancers: { profiles: { full_name: string } | null } | null;
    shifts: { profession: string; starts_at: string; ends_at: string } | null;
    timesheets: { minutes_claimed: number; break_minutes: number } | null;
  } | null;
};

const RATE_SET_BY_LABELS: Record<string, string> = {
  facility_offer_accepted: "Instelling bood aan, zorgprofessional accepteerde",
  negotiated: "Onderhandeld",
  freelancer_quote: "Zorgprofessional gaf tarief op",
};

export default async function DossierPage() {
  const { org } = await requireFacilityAdmin("/zorginstelling/dossier");
  const supabase = await createClient();

  const { data: records, error: recordsError } = await supabase
    .from("compliance_records")
    .select(
      "assignment_id, model_agreement_version, offered_at, accepted_at, could_decline, substitution_allowed, rate_set_by, declined_other_offers, snapshot, assignments!inner(id, freelancer_id, agreed_rate_cents, status, org_id, freelancers(profiles(full_name)), shifts(profession, starts_at, ends_at), timesheets(minutes_claimed, break_minutes))",
    )
    .eq("assignments.org_id", org.id)
    .order("accepted_at", { ascending: false })
    .limit(DOSSIER_PAGE_CAP)
    .returns<DossierRow[]>();

  /*
   * A failed read is not "no dossier".
   *
   * The error was discarded, so a blip rendered the empty state — "Nog geen
   * dossier" — on the one screen a facility opens because an inspector asked for
   * it. Telling somebody their compliance evidence does not exist, calmly, is a
   * worse outcome than an error, and this is the same shape the approval queue
   * beside it already guards.
   */
  const dossierFailed = Boolean(recordsError);

  /*
   * Everybody who appears in the EXPORTABLE dossier, once each.
   *
   * This was built from `records` — the newest 100, which is what the table shows
   * — while the export it feeds reads up to 1000 over the whole history. The
   * comment justified that as "offering a name that has no records in it would
   * produce an empty pdf", but the failure that existed was the reverse: a nurse
   * who last worked here 150 assignments ago was simply absent from the dropdown,
   * so the only export available was "Iedereen" — a document naming up to a
   * thousand other people, their KvK and BIG numbers and their papers. Strictly
   * more personal data than the question asked for, which is the outcome the
   * filter exists to prevent.
   *
   * Its own query, over the same set the export reads, selecting only what a
   * dropdown needs.
   */
  const { data: everyone } = await supabase
    .from("compliance_records")
    .select("snapshot, assignments!inner(freelancer_id, org_id, freelancers(profiles(full_name)))")
    .eq("assignments.org_id", org.id)
    .order("accepted_at", { ascending: false })
    .limit(DOSSIER_EXPORT_CAP)
    .returns<
      {
        snapshot: unknown;
        assignments: {
          freelancer_id: string;
          freelancers: { profiles: { full_name: string } | null } | null;
        } | null;
      }[]
    >();

  const people = [
    ...new Map(
      (everyone ?? [])
        .map((record) => {
          const snap = record.snapshot as { freelancer?: { full_name?: string | null } } | null;
          const id = record.assignments?.freelancer_id;
          if (!id) return null;
          return [
            id,
            {
              id,
              name:
                snap?.freelancer?.full_name ??
                record.assignments?.freelancers?.profiles?.full_name ??
                "Onbekend",
            },
          ] as const;
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name, "nl"));

  return (
    <>
      <PageHeader
        title="Dossier"
        description="Per opdracht vastgelegd wie wat aanbood, wie accepteerde, en dat weigeren mogelijk was."
      />

      {/*
        A plain GET form, so the browser handles the download itself. A Server
        Action cannot return a file — it returns data and would need a second
        round trip to fetch the bytes.
      */}
      <form action="/zorginstelling/dossier/export" method="get" className="card p-4 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="from">
              Vanaf
            </label>
            <input className="input" id="from" name="from" type="date" />
          </div>
          <div>
            <label className="label" htmlFor="to">
              Tot en met
            </label>
            <input className="input" id="to" name="to" type="date" />
          </div>
          <div>
            <label className="label" htmlFor="freelancer_id">
              Zorgprofessional
            </label>
            {/*
              /hoe-het-werkt has promised "per periode of per zorgprofessional"
              since it was written, and only the period existed. It is also the
              shape the document is usually needed in: a question is about ONE
              working relationship, and a dossier covering forty other people is
              both harder to read and more personal data than was asked for.
            */}
            <select className="select" id="freelancer_id" name="freelancer_id" defaultValue="">
              <option value="">Iedereen</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" type="submit">
            Exporteer als pdf
          </button>
        </div>
        <p className="hint">
          Laat de datums leeg voor het volledige dossier. Dit is het document dat je meestuurt als
          er vragen komen over de inzet van zzp&apos;ers.
        </p>
      </form>

      <div className="card p-5 mb-6">
        <h2 className="font-bold mb-2">Waarom dit bestaat</h2>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          De Belastingdienst handhaaft sinds januari 2025 weer op schijnzelfstandigheid en kijkt in
          2026 specifiek naar driehoeksrelaties tussen zzp&apos;er, opdrachtgever en bemiddelaar.
          De vraag die dan gesteld wordt is of de zorgprofessional daadwerkelijk vrij was: vrij om te
          weigeren, vrij om het tarief af te spreken, niet exclusief gebonden. Elke regel hieronder
          legt dat vast op het moment dat het gebeurde — niet achteraf gereconstrueerd.
        </p>
        <p className="text-sm mt-3" style={{ color: "var(--text-muted)" }}>
          Dit is geen juridisch advies en geen garantie. Het is bewijsmateriaal. Laat je
          modelovereenkomst en werkwijze toetsen door je eigen jurist.
        </p>
      </div>

      {dossierFailed ? (
        <FormMessage kind="error">
          Het dossier kon niet worden geladen. Dit is geen leeg dossier — probeer het zo opnieuw, en
          neem contact op als het blijft misgaan.
        </FormMessage>
      ) : null}

      {dossierFailed ? null : !records || records.length === 0 ? (
        <EmptyState
          title="Nog geen dossier"
          body="Zodra een zorgprofessional een dienst aanneemt, wordt hier automatisch een record vastgelegd."
        />
      ) : (
        <div className="card table-scroll" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
          <table className="table">
            <thead>
              <tr>
                <th>Zorgprofessional</th>
                <th>Dienst</th>
                <th>Documenten bij aanvang</th>
                <th>Aangeboden</th>
                <th>Geaccepteerd</th>
                <th>Tarief</th>
                <th>Kon weigeren</th>
                <th>Ook aangeboden aan</th>
                <th>Modelovereenkomst</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const assignment = record.assignments;

                /*
                 * The snapshot first, the live join only as a fallback.
                 *
                 * Same rule as the export. Reading these live meant the screen
                 * rewrote its own history when somebody edited a profile, which
                 * is what the footer promises it does not do.
                 */
                const snap = (record.snapshot ?? null) as {
                  shift?: {
                    qualification?: string | null;
                    starts_at?: string | null;
                    ends_at?: string | null;
                  } | null;
                  freelancer?: {
                    full_name?: string | null;
                    /*
                     * The approved documents at acceptance. Captured since
                     * migration 027 and rendered by nothing until now — which
                     * mattered, because anonymise_account deletes the documents
                     * rows on the stated grounds that this preserves the Wkkgz
                     * evidence. It only preserves it if something shows it.
                     */
                    documents?:
                      | {
                          kind?: string | null;
                          expires_on?: string | null;
                          reviewed_at?: string | null;
                        }[]
                      | null;
                  } | null;
                } | null;

                const startsAt = snap?.shift?.starts_at ?? assignment?.shifts?.starts_at ?? null;
                const endsAt = snap?.shift?.ends_at ?? assignment?.shifts?.ends_at ?? null;

                return (
                  <tr key={record.assignment_id}>
                    <td className="font-medium">
                      {snap?.freelancer?.full_name ?? assignment?.freelancers?.profiles?.full_name ?? "—"}
                      {/*
                        The row stays and says what it is. One night can carry two
                        records — cancel_assignment reopens a future shift and the
                        active-assignment index is partial — so without this the
                        table lists two people for one shift and no way to tell
                        which of them worked it.
                      */}
                      {assignment?.status === "cancelled" ? (
                        <span className="badge badge-danger ml-2">Geannuleerd</span>
                      ) : null}
                    </td>
                    <td>
                      {qualificationLabel(
                        snap?.shift?.qualification ?? assignment?.shifts?.profession,
                      )}
                      <span className="block text-xs tnum" style={{ color: "var(--text-muted)" }}>
                        {startsAt && endsAt ? formatShiftWindow(startsAt, endsAt) : "—"}
                      </span>
                    </td>
                    <td style={{ color: "var(--text-muted)" }} className="text-xs">
                      {/*
                        Absent and empty are different answers and the screen says
                        which. A record from before the capture existed must not
                        read as "there were no documents" — that is a claim about a
                        check nobody made. Same three states as the PDF.
                      */}
                      {!Array.isArray(snap?.freelancer?.documents) ? (
                        "Niet vastgelegd"
                      ) : snap.freelancer.documents.length === 0 ? (
                        "Geen goedgekeurde documenten"
                      ) : (
                        <>
                          {snap.freelancer.documents.map((doc, i) => (
                            <span key={i} className="block">
                              {DOCUMENT_KIND_LABELS[doc?.kind as DocumentKind] ?? doc?.kind ?? "—"}
                              {doc?.expires_on ? ` · tot ${formatDate(doc.expires_on)}` : ""}
                            </span>
                          ))}
                        </>
                      )}
                    </td>
                    <td className="tnum">{formatDate(record.offered_at)}</td>
                    <td className="tnum">{formatDate(record.accepted_at)}</td>
                    <td className="tnum">
                      {assignment ? formatEuros(assignment.agreed_rate_cents) : "—"}
                      <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                        {RATE_SET_BY_LABELS[record.rate_set_by] ?? record.rate_set_by}
                      </span>
                    </td>
                    <td>
                      {record.could_decline ? (
                        <span className="badge badge-ok">Ja</span>
                      ) : (
                        <span className="badge badge-danger">Nee</span>
                      )}
                    </td>
                    <td className="tnum">
                      {/*
                        How many other people the shift was genuinely open to. A
                        shift offered to one person looks like an instruction; one
                        offered to twelve looks like a market.
                      */}
                      {record.declined_other_offers}
                    </td>
                    <td style={{ color: "var(--text-muted)" }}>
                      {/*
                        The same words the PDF uses. This printed the raw slug, so
                        the screen said "geen-modelovereenkomst" where the document
                        beside it said "Geen — niet vastgelegd voor deze opdracht".
                        One rule, two places, drifted apart the moment the PDF was
                        fixed. See lib/dossierPdf.ts.
                      */}
                      {record.model_agreement_version === "geen-modelovereenkomst"
                        ? "Geen — niet vastgelegd"
                        : record.model_agreement_version}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {records && records.length > 0 ? (
        <p className="text-sm mt-4" style={{ color: "var(--text-muted)" }}>
          {records.length} opdracht{records.length === 1 ? "" : "en"}
          {records.length >= DOSSIER_PAGE_CAP ? ` (meer dan ${DOSSIER_PAGE_CAP} — deze lijst is afgekapt, de pdf-export bevat er meer)` : ""}.
          Van elke opdracht is ook een volledige momentopname bewaard: tarief, functie, tijden en de
          gegevens van beide partijen zoals ze op dat moment waren. Die momentopname is wat de
          pdf-export afdrukt, zodat het document niet verandert als iemand later zijn profiel
          aanpast.
        </p>
      ) : null}
    </>
  );
}
