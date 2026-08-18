import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { requireFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { billableMinutes, formatMinutes, formatShiftWindow } from "@/lib/hours";
import { formatEuros } from "@/lib/money";
import { qualificationLabel } from "@/lib/qualifications";
import { RatingForm } from "@/components/RatingForm";
import { submitRatingAction } from "@/lib/ratingActions";
import { approveTimesheetAction, disputeTimesheetAction } from "./actions";

export const metadata: Metadata = { title: "Uren goedkeuren" };

type PendingRow = {
  id: string;
  agreed_rate_cents: number;
  agreed_break_minutes: number;
  status: string;
  profiles: { full_name: string } | null;
  shifts: {
    profession: string;
    department: string | null;
    starts_at: string;
    ends_at: string;
  } | null;
  timesheets: {
    minutes_claimed: number;
    break_minutes: number;
    note: string | null;
    approved_at: string | null;
    disputed_at: string | null;
  } | null;
};

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; approved?: string; disputed?: string; rated?: string }>;
}) {
  const { org } = await requireFacilityAdmin("/zorginstelling/uren");
  const params = await searchParams;
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("assignments")
    .select(
      "id, agreed_rate_cents, agreed_break_minutes, status, profiles!assignments_freelancer_id_fkey(full_name), shifts(profession, department, starts_at, ends_at), timesheets(minutes_claimed, break_minutes, note, approved_at, disputed_at)",
    )
    .eq("org_id", org.id)
    .neq("status", "cancelled")
    .order("accepted_at", { ascending: false })
    .limit(60)
    .returns<PendingRow[]>();

  // Only rows where the freelancer has actually submitted something and it is
  // not yet approved need a decision. Everything else is noise on this page.
  const pending = (rows ?? []).filter((row) => row.timesheets && !row.timesheets.approved_at);

  /*
   * Completed work still awaiting this facility's rating. Kept on the same page as
   * approvals rather than given its own tab: rating is a thirty-second job that
   * only ever happens if it is in front of the person who just approved the hours.
   */
  const completed = (rows ?? []).filter((row) => row.status === "completed");

  const { data: existingRatings } = await supabase
    .from("ratings")
    .select("assignment_id")
    .eq("direction", "facility_to_freelancer")
    .in("assignment_id", completed.length > 0 ? completed.map((row) => row.id) : ["none"])
    .returns<{ assignment_id: string }[]>();

  const rated = new Set((existingRatings ?? []).map((row) => row.assignment_id));
  const toRate = completed.filter((row) => !rated.has(row.id));

  return (
    <>
      <PageHeader
        title="Uren goedkeuren"
        description="Zodra je goedkeurt wordt de factuur automatisch opgemaakt en verstuurd."
      />

      {params.error ? <FormMessage kind="error">{authErrorMessage(params.error)}</FormMessage> : null}
      {params.approved ? <FormMessage kind="ok">Uren goedgekeurd.</FormMessage> : null}
      {params.rated ? <FormMessage kind="ok">Beoordeling opgeslagen.</FormMessage> : null}
      {params.disputed ? (
        <FormMessage kind="ok">
          Je vraag is doorgegeven. De zorgprofessional kan de uren aanpassen en opnieuw indienen.
        </FormMessage>
      ) : null}

      {pending.length === 0 && toRate.length === 0 ? (
        <EmptyState
          title="Niets te beoordelen"
          body="Zodra een zorgprofessional gewerkte uren indient, verschijnen ze hier."
        />
      ) : pending.length === 0 ? null : (
        <div className="grid gap-4">
          {pending.map((row) => {
            const sheet = row.timesheets!;
            const scheduled = row.shifts
              ? billableMinutes(row.shifts.starts_at, row.shifts.ends_at, row.agreed_break_minutes)
              : 0;
            const claimed = Math.max(0, sheet.minutes_claimed - sheet.break_minutes);
            const differs = claimed !== scheduled;

            return (
              <div key={row.id} className="card p-5">
                <div className="flex flex-wrap justify-between gap-4 mb-3">
                  <div>
                    <p className="font-bold">{row.profiles?.full_name ?? "—"}</p>
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                      {qualificationLabel(row.shifts?.profession)}
                      {row.shifts?.department ? ` · ${row.shifts.department}` : ""}
                    </p>
                    <p className="text-sm tnum" style={{ color: "var(--text-muted)" }}>
                      {row.shifts
                        ? formatShiftWindow(row.shifts.starts_at, row.shifts.ends_at)
                        : "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold tnum">
                      {formatEuros(Math.round((claimed * row.agreed_rate_cents) / 60))}
                    </p>
                    <p className="text-sm tnum" style={{ color: "var(--text-muted)" }}>
                      {formatMinutes(claimed)} @ {formatEuros(row.agreed_rate_cents)}/uur
                    </p>
                  </div>
                </div>

                {/*
                  Flagged only when the claim differs from the schedule. A shift
                  that ran as planned needs no scrutiny, and highlighting every row
                  equally trains people to approve without looking.
                */}
                {differs ? (
                  <p
                    className="text-sm rounded-lg px-3 py-2 mb-3"
                    style={{ background: "var(--warn-subtle)", color: "var(--warn)" }}
                  >
                    Wijkt af van de planning: {formatMinutes(scheduled)} gepland,{" "}
                    {formatMinutes(claimed)} gedeclareerd.
                    {sheet.note ? ` Toelichting: ${sheet.note}` : ""}
                  </p>
                ) : sheet.note ? (
                  <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
                    {sheet.note}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-3 items-end">
                  <form action={approveTimesheetAction}>
                    <input type="hidden" name="assignment_id" value={row.id} />
                    <button className="btn btn-primary" type="submit">
                      Goedkeuren
                    </button>
                  </form>
                  <form action={disputeTimesheetAction} className="flex gap-2 items-end flex-1 min-w-64">
                    <input type="hidden" name="assignment_id" value={row.id} />
                    <div className="flex-1">
                      <label className="label" htmlFor={`reason-${row.id}`}>
                        Vraag stellen
                      </label>
                      <input
                        className="input"
                        id={`reason-${row.id}`}
                        name="reason"
                        type="text"
                        placeholder="Wat klopt er niet?"
                      />
                    </div>
                    <button className="btn btn-secondary" type="submit">
                      Versturen
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toRate.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-lg font-bold mb-1">Beoordelen</h2>
          <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
            Afgeronde diensten die je nog niet hebt beoordeeld. Je oordeel telt mee in een
            gemiddelde en is nooit als losse beoordeling met jouw naam zichtbaar.
          </p>

          <div className="grid gap-4">
            {toRate.map((row) => (
              <div key={row.id}>
                <p className="font-semibold mb-2">
                  {row.profiles?.full_name ?? "—"}
                  <span className="font-normal text-sm ml-2" style={{ color: "var(--text-muted)" }}>
                    {qualificationLabel(row.shifts?.profession)}
                    {row.shifts
                      ? ` · ${formatShiftWindow(row.shifts.starts_at, row.shifts.ends_at)}`
                      : ""}
                  </span>
                </p>
                <RatingForm
                  action={submitRatingAction}
                  assignmentId={row.id}
                  direction="facility_to_freelancer"
                  heading={`Hoe ging het met ${row.profiles?.full_name ?? "deze zorgprofessional"}?`}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
