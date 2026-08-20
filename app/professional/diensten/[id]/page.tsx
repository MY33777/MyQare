import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { requireFreelancer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { calculateFee } from "@/lib/fees";
import { billableMinutes, formatDateTime, formatMinutes, formatTime } from "@/lib/hours";
import { formatEuros } from "@/lib/money";
import { qualificationLabel } from "@/lib/qualifications";
import { RatingForm } from "@/components/RatingForm";
import { submitRatingAction } from "@/lib/ratingActions";
import { cancelAssignmentAction } from "@/lib/cancelActions";
import { submitTimesheetAction } from "./actions";

export const metadata: Metadata = { title: "Dienst" };

type AssignmentDetail = {
  id: string;
  agreed_rate_cents: number;
  agreed_break_minutes: number;
  status: string;
  accepted_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  shifts: {
    profession: string;
    department: string | null;
    location: string | null;
    starts_at: string;
    ends_at: string;
    organisations: { name: string } | null;
  } | null;
  timesheets: {
    minutes_claimed: number;
    break_minutes: number;
    note: string | null;
    approved_at: string | null;
    disputed_at: string | null;
    dispute_reason: string | null;
  } | null;
};

/*
 * Said from the reader's side. The column stores the party, not a sentence, and
 * "facility" on its own tells a freelancer nothing about what happened to them.
 */
const CANCELLED_BY_LABEL: Record<string, string> = {
  facility: "De zorginstelling heeft deze dienst geannuleerd",
  freelancer: "Je hebt deze dienst zelf geannuleerd",
  staff: "MyQare heeft deze dienst geannuleerd",
};

export default async function AssignmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; submitted?: string; accepted?: string; rated?: string; cancelled?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { userId } = await requireFreelancer(`/professional/diensten/${id}`);
  const supabase = await createClient();

  const { data: assignment } = await supabase
    .from("assignments")
    .select(
      "id, agreed_rate_cents, agreed_break_minutes, status, accepted_at, cancelled_by, cancel_reason, cancelled_at, shifts(profession, department, location, starts_at, ends_at, organisations(name)), timesheets(minutes_claimed, break_minutes, note, approved_at, disputed_at, dispute_reason)",
    )
    .eq("id", id)
    .eq("freelancer_id", userId)
    .maybeSingle<AssignmentDetail>();

  if (!assignment || !assignment.shifts) notFound();

  // Whether this side has already had its say. One rating per direction, enforced
  // by a unique constraint — this only decides whether to show the form.
  const { data: ownRating } = await supabase
    .from("ratings")
    .select("id")
    .eq("assignment_id", id)
    .eq("direction", "freelancer_to_facility")
    .maybeSingle<{ id: string }>();

  const shift = assignment.shifts;
  const scheduled = billableMinutes(shift.starts_at, shift.ends_at, assignment.agreed_break_minutes);
  const sheet = assignment.timesheets;
  const claimed = sheet ? Math.max(0, sheet.minutes_claimed - sheet.break_minutes) : scheduled;
  const fee = calculateFee(claimed, assignment.agreed_rate_cents);
  const hasEnded = new Date(shift.ends_at) < new Date();
  const locked = Boolean(sheet?.approved_at) || assignment.status === "cancelled";

  // Prefill from the schedule: most shifts run as planned, so the common case
  // should be one tap rather than arithmetic done from memory a day later.
  const prefill = sheet ? sheet.minutes_claimed : scheduled + assignment.agreed_break_minutes;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={qualificationLabel(shift.profession)}
        description={shift.organisations?.name ?? undefined}
      />

      {query.accepted ? (
        <FormMessage kind="ok">
          Dienst aangenomen. De bemiddelingsvergoeding is van je saldo afgeschreven.
        </FormMessage>
      ) : null}
      {query.submitted ? (
        <FormMessage kind="ok">Uren ingediend. De instelling keurt ze goed of stelt een vraag.</FormMessage>
      ) : null}
      {query.cancelled ? (
        <FormMessage kind="ok">
          Dienst geannuleerd. De bemiddelingsvergoeding is teruggestort op je saldo.
        </FormMessage>
      ) : null}
      {query.error ? <FormMessage kind="error">{authErrorMessage(query.error)}</FormMessage> : null}

      {/*
        Who cancelled it, and the reason they gave.

        cancel_assignment() has written cancelled_by and cancel_reason since the
        day it was added, and no screen has ever read either. The shift simply
        turned into "Geannuleerd" — a freelancer whose Saturday night had just
        evaporated could not tell whether the ward pulled it, whether an admin
        stepped in, or why, and there was nowhere to go and look. Writing a
        reason into a column nobody displays is not recording a reason.
      */}
      {assignment.status === "cancelled" ? (
        <FormMessage kind="warn">
          <span className="font-semibold">
            {CANCELLED_BY_LABEL[assignment.cancelled_by ?? ""] ?? "Deze dienst is geannuleerd"}
            {assignment.cancelled_at ? " op " + formatDateTime(assignment.cancelled_at) : ""}.
          </span>
          {assignment.cancel_reason ? <> Reden: {assignment.cancel_reason}</> : null}
        </FormMessage>
      ) : null}


      <div className="card p-6 space-y-4 mb-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Wanneer
            </dt>
            <dd className="font-semibold tnum">
              {formatDateTime(shift.starts_at)} – {formatTime(shift.ends_at)}
            </dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Afgesproken tarief
            </dt>
            <dd className="font-semibold tnum">{formatEuros(assignment.agreed_rate_cents)} per uur</dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Afdeling
            </dt>
            <dd className="font-semibold">{shift.department ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Locatie
            </dt>
            <dd className="font-semibold">{shift.location ?? "—"}</dd>
          </div>
        </dl>

        <div className="rounded-lg p-4" style={{ background: "var(--surface-sunken)" }}>
          <div className="flex justify-between text-sm">
            <span>Te declareren</span>
            <span className="tnum font-semibold">{formatMinutes(claimed)}</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span>Opbrengst</span>
            <span className="tnum font-semibold">{formatEuros(fee.assignmentValueCents)}</span>
          </div>
        </div>
      </div>

      {sheet?.disputed_at ? (
        <FormMessage kind="error">
          De instelling heeft een vraag over je uren: {sheet.dispute_reason ?? "geen toelichting"}.
          Pas ze aan en dien opnieuw in.
        </FormMessage>
      ) : null}

      {locked ? (
        <>
          <div className="card p-6 mb-6">
            <p className="font-semibold">
              {sheet?.approved_at ? "Uren goedgekeurd" : "Deze dienst is geannuleerd"}
            </p>
            {sheet?.approved_at ? (
              <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                {formatMinutes(claimed)} goedgekeurd. De factuur wordt automatisch opgemaakt.
              </p>
            ) : null}
          </div>

          {assignment.status === "completed" && !ownRating ? (
            <RatingForm
              action={submitRatingAction}
              assignmentId={assignment.id}
              direction="freelancer_to_facility"
              heading={`Hoe was het werken bij ${shift.organisations?.name ?? "deze instelling"}?`}
            />
          ) : null}

          {query.rated ? <FormMessage kind="ok">Bedankt voor je beoordeling.</FormMessage> : null}
        </>
      ) : (
        <form action={submitTimesheetAction} className="card p-6 space-y-5">
          <input type="hidden" name="assignment_id" value={assignment.id} />

          <div>
            <h2 className="font-bold">Gewerkte uren</h2>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              {hasEnded
                ? "Vul in hoe lang je daadwerkelijk hebt gewerkt, inclusief pauze."
                : "Je kunt dit invullen zodra de dienst is afgelopen."}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="hours">
                Uren
              </label>
              <input
                className="input"
                id="hours"
                name="hours"
                type="number"
                min={0}
                max={24}
                defaultValue={Math.floor(prefill / 60)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="minutes">
                Minuten
              </label>
              <input
                className="input"
                id="minutes"
                name="minutes"
                type="number"
                min={0}
                max={59}
                step={5}
                defaultValue={prefill % 60}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="break_minutes">
                Pauze (min)
              </label>
              <input
                className="input"
                id="break_minutes"
                name="break_minutes"
                type="number"
                min={0}
                step={5}
                defaultValue={sheet?.break_minutes ?? assignment.agreed_break_minutes}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="note">
              Toelichting
            </label>
            <textarea
              className="textarea"
              id="note"
              name="note"
              rows={2}
              defaultValue={sheet?.note ?? ""}
              placeholder="Alleen nodig als de uren afwijken van de planning."
            />
          </div>

          <button className="btn btn-primary" type="submit" disabled={!hasEnded}>
            {sheet ? "Uren opnieuw indienen" : "Uren indienen"}
          </button>
        </form>
      )}

      {/*
        Cancelling is a normal event in shift work, so it stays visible rather than
        hidden behind a support request — but only until the shift has been worked.
        Once hours are approved there is nothing to cancel; undoing that is a credit
        note, not a cancellation.
      */}
      {/*
        `!sheet`, not `!sheet?.approved_at`. Submitting hours is the record that
        the shift was worked, and cancelling after that used to strand your own
        pay — the assignment left the facility's approval queue permanently and
        could never be invoiced. See lib/cancelActions.ts.
      */}
      {assignment.status === "confirmed" && !sheet ? (
        <details className="card p-5 mt-6">
          <summary className="cursor-pointer font-semibold">Dienst annuleren</summary>
          <p className="text-sm mt-3" style={{ color: "var(--text-muted)" }}>
            De bemiddelingsvergoeding krijg je volledig terug. Annuleren heeft geen gevolgen voor je
            beoordeling — maar laat het de instelling zo vroeg mogelijk weten, zij moeten de dienst
            opnieuw invullen.
          </p>
          <form action={cancelAssignmentAction} className="mt-4 flex flex-wrap gap-2 items-end">
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
                placeholder="bijv. ziek, dubbele boeking"
              />
            </div>
            <button className="btn btn-danger" type="submit">
              Annuleren
            </button>
          </form>
        </details>
      ) : null}
    </div>
  );
}
