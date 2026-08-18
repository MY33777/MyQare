import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { requireFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { billableMinutes, formatDateTime, formatMinutes, formatTime } from "@/lib/hours";
import { formatEuros } from "@/lib/money";
import { qualificationLabel } from "@/lib/qualifications";
import { SHIFT_STATUS_LABELS, VISIBILITY_LABELS, type ShiftVisibility } from "@/lib/shifts";
import { cancelAssignmentAction } from "@/lib/cancelActions";

export const metadata: Metadata = { title: "Dienst" };

type ShiftDetail = {
  id: string;
  profession: string;
  department: string | null;
  location: string | null;
  region: string | null;
  starts_at: string;
  ends_at: string;
  hourly_rate_cents: number;
  break_minutes: number;
  description: string | null;
  status: string;
  visibility: string;
  respond_by: string | null;
  shift_offers: {
    id: string;
    response: string | null;
    responded_at: string | null;
    viewed_at: string | null;
    profiles: { full_name: string; phone: string | null } | null;
  }[];
  assignments: {
    id: string;
    status: string;
    accepted_at: string;
    profiles: { full_name: string; phone: string | null } | null;
  } | null;
};

export default async function FacilityShiftDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; cancelled?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { org } = await requireFacilityAdmin(`/zorginstelling/diensten/${id}`);
  const supabase = await createClient();

  const { data: shift } = await supabase
    .from("shifts")
    .select(
      "id, profession, department, location, region, starts_at, ends_at, hourly_rate_cents, break_minutes, description, status, visibility, respond_by, shift_offers(id, response, responded_at, viewed_at, profiles(full_name, phone)), assignments(id, status, accepted_at, profiles!assignments_freelancer_id_fkey(full_name, phone))",
    )
    .eq("id", id)
    .eq("org_id", org.id)
    .maybeSingle<ShiftDetail>();

  if (!shift) notFound();

  const minutes = billableMinutes(shift.starts_at, shift.ends_at, shift.break_minutes);
  const assignment = shift.assignments;
  const offers = shift.shift_offers ?? [];

  const accepted = offers.filter((offer) => offer.response === "accept");
  const declined = offers.filter((offer) => offer.response === "decline");
  const silent = offers.filter((offer) => !offer.response);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={qualificationLabel(shift.profession)}
        description={`${formatDateTime(shift.starts_at)} – ${formatTime(shift.ends_at)}`}
      />

      {query.cancelled ? (
        <FormMessage kind="ok">
          Opdracht geannuleerd. De dienst staat weer open, de bemiddelingsvergoeding is
          teruggestort.
        </FormMessage>
      ) : null}
      {query.error ? <FormMessage kind="error">{authErrorMessage(query.error)}</FormMessage> : null}

      <div className="card p-6 mb-6">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Duur
            </dt>
            <dd className="font-semibold tnum">{formatMinutes(minutes)}</dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Tarief
            </dt>
            <dd className="font-semibold tnum">{formatEuros(shift.hourly_rate_cents)} / uur</dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Totaal
            </dt>
            <dd className="font-semibold tnum">
              {formatEuros(Math.round((minutes * shift.hourly_rate_cents) / 60))}
            </dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Afdeling
            </dt>
            <dd className="font-semibold">{shift.department ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Aangeboden aan
            </dt>
            <dd className="font-semibold">
              {VISIBILITY_LABELS[shift.visibility as ShiftVisibility] ?? shift.visibility}
              {shift.visibility === "region" && shift.region ? ` (${shift.region})` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Status
            </dt>
            <dd>
              <span
                className={
                  shift.status === "filled"
                    ? "badge badge-ok"
                    : shift.status === "open"
                      ? "badge badge-brand"
                      : "badge badge-neutral"
                }
              >
                {SHIFT_STATUS_LABELS[shift.status] ?? shift.status}
              </span>
            </dd>
          </div>
        </dl>

        {shift.description ? (
          <p className="text-sm mt-4" style={{ color: "var(--text-muted)" }}>
            {shift.description}
          </p>
        ) : null}
      </div>

      {/*
        Who is actually coming. The list page could only say that somebody had
        accepted, which is useless to the coordinator on the day — they need a name
        and a number.
      */}
      {assignment && assignment.status !== "cancelled" ? (
        <div className="card p-6 mb-6" style={{ borderColor: "var(--ok)" }}>
          <h2 className="font-bold mb-2">Wie komt er</h2>
          <p className="text-lg font-semibold">{assignment.profiles?.full_name ?? "—"}</p>
          {assignment.profiles?.phone ? (
            <p className="text-sm tnum" style={{ color: "var(--text-muted)" }}>
              <a href={`tel:${assignment.profiles.phone}`}>{assignment.profiles.phone}</a>
            </p>
          ) : null}
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            Aangenomen op {formatDateTime(assignment.accepted_at)}
          </p>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold">Opdracht annuleren</summary>
            <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>
              De zorgprofessional krijgt de bemiddelingsvergoeding volledig terug en de dienst komt
              weer open te staan. Laat het ze zo vroeg mogelijk weten — ze hebben die dag
              vrijgehouden.
            </p>
            <form action={cancelAssignmentAction} className="mt-3 flex flex-wrap gap-2 items-end">
              <input type="hidden" name="assignment_id" value={assignment.id} />
              <div className="flex-1 min-w-56">
                <label className="label" htmlFor="cancel_reason">
                  Reden
                </label>
                <input
                  className="input"
                  id="cancel_reason"
                  name="reason"
                  type="text"
                  placeholder="bijv. dienst vervalt, bezetting rond"
                />
              </div>
              <button className="btn btn-danger" type="submit">
                Annuleren
              </button>
            </form>
          </details>
        </div>
      ) : null}

      <h2 className="text-lg font-bold mb-3">Reacties ({offers.length} aangeboden)</h2>

      <div className="card table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Zorgprofessional</th>
              <th>Reactie</th>
              <th>Wanneer</th>
            </tr>
          </thead>
          <tbody>
            {offers.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ color: "var(--text-muted)" }}>
                  Deze dienst is aan niemand aangeboden. Er zaten geen passende zorgprofessionals in
                  je pool op het moment van plaatsen.
                </td>
              </tr>
            ) : (
              [...accepted, ...silent, ...declined].map((offer) => (
                <tr key={offer.id}>
                  <td className="font-medium">{offer.profiles?.full_name ?? "—"}</td>
                  <td>
                    {offer.response === "accept" ? (
                      <span className="badge badge-ok">Aangenomen</span>
                    ) : offer.response === "decline" ? (
                      <span className="badge badge-neutral">Niet beschikbaar</span>
                    ) : offer.viewed_at ? (
                      <span className="badge badge-warn">Bekeken</span>
                    ) : (
                      <span className="badge badge-neutral">Nog niet gereageerd</span>
                    )}
                  </td>
                  <td className="tnum" style={{ color: "var(--text-muted)" }}>
                    {offer.responded_at ? formatDateTime(offer.responded_at) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/*
        Recorded for the dossier, and worth showing here too: a shift offered to
        twelve people and declined by eleven is evidence of a market, not of an
        instruction to an employee.
      */}
      {offers.length > 0 ? (
        <p className="text-sm mt-3" style={{ color: "var(--text-muted)" }}>
          {accepted.length} aangenomen · {declined.length} niet beschikbaar · {silent.length} nog geen
          reactie. Dit wordt vastgelegd in het dossier.
        </p>
      ) : null}
    </div>
  );
}
