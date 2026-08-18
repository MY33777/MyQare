import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { requireFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMinutes, formatShiftWindow } from "@/lib/hours";
import { formatEuros } from "@/lib/money";
import { qualificationLabel } from "@/lib/qualifications";

export const metadata: Metadata = { title: "Dossier" };

type DossierRow = {
  assignment_id: string;
  model_agreement_version: string;
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
    profiles: { full_name: string } | null;
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

  const { data: records } = await supabase
    .from("compliance_records")
    .select(
      "assignment_id, model_agreement_version, offered_at, accepted_at, could_decline, substitution_allowed, rate_set_by, declined_other_offers, assignments!inner(id, agreed_rate_cents, status, org_id, profiles!assignments_freelancer_id_fkey(full_name), shifts(profession, starts_at, ends_at), timesheets(minutes_claimed, break_minutes))",
    )
    .eq("assignments.org_id", org.id)
    .order("accepted_at", { ascending: false })
    .limit(100)
    .returns<DossierRow[]>();

  return (
    <>
      <PageHeader
        title="Dossier"
        description="Per opdracht vastgelegd wie wat aanbood, wie accepteerde, en dat weigeren mogelijk was."
      />

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

      {!records || records.length === 0 ? (
        <EmptyState
          title="Nog geen dossier"
          body="Zodra een zorgprofessional een dienst aanneemt, wordt hier automatisch een record vastgelegd."
        />
      ) : (
        <div className="card table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Zorgprofessional</th>
                <th>Dienst</th>
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
                return (
                  <tr key={record.assignment_id}>
                    <td className="font-medium">{assignment?.profiles?.full_name ?? "—"}</td>
                    <td>
                      {qualificationLabel(assignment?.shifts?.profession)}
                      <span className="block text-xs tnum" style={{ color: "var(--text-muted)" }}>
                        {assignment?.shifts
                          ? formatShiftWindow(assignment.shifts.starts_at, assignment.shifts.ends_at)
                          : "—"}
                      </span>
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
                    <td style={{ color: "var(--text-muted)" }}>{record.model_agreement_version}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {records && records.length > 0 ? (
        <p className="text-sm mt-4" style={{ color: "var(--text-muted)" }}>
          {records.length} opdracht{records.length === 1 ? "" : "en"} vastgelegd. Van elke opdracht is
          ook een volledige momentopname bewaard: tarief, functie, tijden en de gegevens van beide
          partijen zoals ze op dat moment waren.
        </p>
      ) : null}
    </>
  );
}
