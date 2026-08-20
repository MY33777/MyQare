import Link from "next/link";
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
import { SubmitButton } from "@/components/SubmitButton";

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
    profiles: { full_name: string } | null;
  }[];
  /*
   * An ARRAY, not an object.
   *
   * PostgREST decides one-to-one versus one-to-many from the presence of a UNIQUE
   * CONSTRAINT, and does not consider partial indexes. Migration 008 replaced
   * `assignments.shift_id ... unique` with a partial unique index so a cancelled
   * assignment would stop reserving its shift — correct, and it silently changed
   * the shape of this embed.
   *
   * Typed as an object before, so an empty array (no assignment at all) was
   * truthy and its .status undefined: every shift rendered a "Wie komt er" card
   * naming nobody. Now there can also genuinely be more than one row per shift —
   * a cancelled one plus its replacement.
   */
  assignments: {
    id: string;
    status: string;
    accepted_at: string;
    cancelled_at: string | null;
    cancelled_by: string | null;
    cancel_reason: string | null;
    // Present once the freelancer submitted hours, which is the point after which
    // cancelling would strand their pay. See lib/cancelActions.ts.
    timesheets: { claimed_at: string | null } | null;
    /*
     * Phone comes from profile_contact, whose policy requires an actual assignment
     * with this facility (migration 004). The old rule lived only in JSX, so the
     * number was one PostgREST call away for any pool facility.
     */
    profiles: { full_name: string; profile_contact: { phone: string | null } | null } | null;
  }[];
};

/*
 * Said from the coordinator's side, which is a different sentence from the one
 * the freelancer sees for the same row.
 */
const CANCELLED_BY_LABEL: Record<string, string> = {
  facility: "Jullie hebben deze opdracht geannuleerd",
  freelancer: "De zorgprofessional heeft deze opdracht geannuleerd",
  staff: "MyQare heeft deze opdracht geannuleerd",
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
      "id, profession, department, location, region, starts_at, ends_at, hourly_rate_cents, break_minutes, description, status, visibility, respond_by, shift_offers(id, response, responded_at, viewed_at, profiles(full_name)), assignments(id, status, accepted_at, cancelled_at, cancelled_by, cancel_reason, timesheets(claimed_at), profiles!assignments_freelancer_id_fkey(full_name, profile_contact(phone)))",
    )
    .eq("id", id)
    .eq("org_id", org.id)
    .maybeSingle<ShiftDetail>();

  if (!shift) notFound();

  const minutes = billableMinutes(shift.starts_at, shift.ends_at, shift.break_minutes);
  /*
   * The live one, if any. A shift can now carry a cancelled assignment plus its
   * replacement, so "the assignment" is whichever is not cancelled — picking
   * [0] would show last week's no-show as the person turning up tomorrow.
   */
  const assignment = (shift.assignments ?? []).find((row) => row.status !== "cancelled") ?? null;

  /*
   * The most recent cancellation, if the shift carries one.
   *
   * cancelled_by and cancel_reason were written by cancel_assignment() from the
   * start and read by no screen at all. For a coordinator this is the operational
   * question, not a footnote: a shift that has quietly gone back to "open" the
   * evening before it runs means something different depending on whether the
   * freelancer withdrew, whether the ward itself pulled it earlier, or whether
   * MyQare intervened — and the reason is often the thing that decides who to
   * call next.
   */
  const cancellation =
    (shift.assignments ?? [])
      .filter((row) => row.status === "cancelled" && row.cancelled_at)
      .sort((a, b) => (a.cancelled_at! < b.cancelled_at! ? 1 : -1))[0] ?? null;
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

      {cancellation && !assignment ? (
        <FormMessage kind="warn">
          <span className="font-semibold">
            {CANCELLED_BY_LABEL[cancellation.cancelled_by ?? ""] ??
              "Deze opdracht is geannuleerd"}
            {cancellation.cancelled_at
              ? " op " + formatDateTime(cancellation.cancelled_at)
              : ""}
            . De dienst staat weer open.
          </span>
          {cancellation.cancel_reason ? <> Reden: {cancellation.cancel_reason}</> : null}
        </FormMessage>
      ) : null}


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
      {assignment ? (
        <div className="card p-6 mb-6" style={{ borderColor: "var(--ok)" }}>
          <h2 className="font-bold mb-2">Wie komt er</h2>
          <p className="text-lg font-semibold">{assignment.profiles?.full_name ?? "—"}</p>
          {assignment.profiles?.profile_contact?.phone ? (
            <p className="text-sm tnum" style={{ color: "var(--text-muted)" }}>
              <a href={`tel:${assignment.profiles.profile_contact?.phone}`}>{assignment.profiles.profile_contact?.phone}</a>
            </p>
          ) : null}
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            Aangenomen op {formatDateTime(assignment.accepted_at)}
          </p>

          {/*
            Gone once hours are in. Cancelling then took the shift out of the
            approval queue for good and left the freelancer unable to be paid for
            work they had already done — see lib/cancelActions.ts. What is wanted
            at that point is disputing the hours, not erasing the assignment.
          */}
          {assignment.timesheets ? (
            <p className="text-sm mt-4" style={{ color: "var(--text-muted)" }}>
              De uren zijn ingediend, dus deze dienst is gewerkt en kan niet meer worden
              geannuleerd. Kloppen de uren niet? Stuur ze terug met een reden vanuit{" "}
              <Link href="/zorginstelling/uren">Uren</Link>.
            </p>
          ) : (
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
              <SubmitButton className="btn btn-danger">
                Annuleren
              </SubmitButton>
            </form>
          </details>
          )}
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
