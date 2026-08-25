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
import { withdrawShiftAction } from "@/app/zorginstelling/diensten/withdrawActions";
import { cancelAssignmentAction } from "@/lib/cancelActions";
import { SubmitButton } from "@/components/SubmitButton";
import { regionLabel } from "@/lib/regions";

export const metadata: Metadata = { title: "Dienst" };

type ShiftDetail = {
  id: string;
  profession: string;
  department: string | null;
  location: string | null;
  region: string | null;
  /** The code the fan-out actually matched on. Migration 022. */
  region_code: string | null;
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
    freelancers: { profiles: { full_name: string } | null } | null;
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
    freelancer_id: string;
    /*
     * The Wkkgz answer, on the screen where the question is asked.
     *
     * This card told a coordinator who was coming and gave them a phone number,
     * and said nothing about whether that person's papers were in order — which
     * is the facility's own legal duty, not the freelancer's, and the reason the
     * dossier exists at all. Checking it meant leaving this page for the pool.
     */
    freelancers: {
      big_number: string | null;
      big_verified_at: string | null;
      /*
       * Reached THROUGH freelancers, because that is where the foreign key goes.
       *
       * `assignments.freelancer_id` references `freelancers(profile_id)`, not
       * `profiles`, so `profiles!assignments_freelancer_id_fkey(...)` names a
       * relationship PostgREST cannot resolve — the whole query fails, not just
       * this column. Twelve queries carried that embed; scripts/check-embeds.mjs
       * now refuses any new one.
       *
       * Phone comes from profile_contact, whose policy requires an actual
       * assignment with this facility (migration 004). The old rule lived only in
       * JSX, so the number was one PostgREST call away for any pool facility.
       */
      profiles: { full_name: string; profile_contact: { phone: string | null } | null } | null;
    } | null;
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
      "id, profession, department, location, region, region_code, starts_at, ends_at, hourly_rate_cents, break_minutes, description, status, visibility, respond_by, shift_offers(id, response, responded_at, viewed_at, freelancers(profiles(full_name))), assignments(id, status, accepted_at, cancelled_at, cancelled_by, cancel_reason, freelancer_id, timesheets(claimed_at), freelancers!assignments_freelancer_id_fkey(big_number, big_verified_at, profiles(full_name, profile_contact(phone))))",
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
  /*
   * Only actual refusals.
   *
   * This counted 'decline', which accept_shift also wrote against everybody whose
   * offer it closed when somebody else was faster — so the tally read as eleven
   * refusals for a shift taken in four minutes that nobody had turned down. See
   * migration 023.
   */
  const declined = offers.filter((offer) => offer.response === "decline");
  const expired = offers.filter((offer) => offer.response === "expired");
  const silent = offers.filter((offer) => !offer.response);

  /*
   * What the status actually IS, as opposed to what the column says.
   *
   * Three things end an open shift and only one of them is written down: it can
   * be accepted (status flips to 'filled'), the deadline to respond can pass, or
   * the shift itself can start. The last two happen by the clock and nothing
   * updates the row, so the screen has to work them out — the same three
   * conditions /professional/aanbod already applies before showing an offer.
   */
  const now = new Date();
  const started = new Date(shift.starts_at) <= now;
  const deadlinePassed = Boolean(shift.respond_by && new Date(shift.respond_by) < now);
  const lapsed = shift.status === "open" && (started || deadlinePassed);

  const statusLabel = lapsed
    ? started
      ? "Niet ingevuld"
      : "Reactietermijn verlopen"
    : (SHIFT_STATUS_LABELS[shift.status] ?? shift.status);

  const statusBadge = lapsed
    ? "badge badge-warn"
    : shift.status === "filled"
      ? "badge badge-ok"
      : shift.status === "open"
        ? "badge badge-brand"
        : shift.status === "cancelled"
          ? "badge badge-danger"
          : "badge badge-neutral";

  // Withdrawing is only meaningful while it is genuinely still on offer.
  const canWithdraw = shift.status === "open" && !started;

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
              {/*
                The CODE's label, not the old free-text column.

                shifts.region still holds whatever the organisation's city was at
                posting time; shifts.region_code is what the fan-out actually
                matched on (migration 022). Rendering the first as "the region
                this was offered to" told a coordinator something other than what
                the platform did.
              */}
              {shift.visibility === "region" && shift.region_code
                ? ` (${regionLabel(shift.region_code)})`
                : ""}
            </dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Status
            </dt>
            <dd>
              {/*
                "Open" is a claim about the future, and nothing in the product
                ever moves an unfilled shift off it — functions.sql writes
                'expired' only from 'filled'. So a shift nobody took still read
                "Open" a week after the night it was for, and the deadline the
                coordinator set was never shown back to her at all, though the
                freelancer side filters on it in three places and prints it twice.
                Computed here rather than written to the column, because the
                column is what accept_shift guards on.
              */}
              <span className={statusBadge}>{statusLabel}</span>
            </dd>
          </div>
          {/*
            The deadline she set, or the one the form promised to set for her
            ("tweederde van de tijd tot die dienst, met een maximum van 48 uur").
            respond_by was fetched and typed on this page and rendered nowhere,
            while the freelancer's side prints it twice — so the two halves of one
            agreement were visible to only one of the parties.
          */}
          {shift.respond_by ? (
            <div>
              <dt className="label">Reageren voor</dt>
              <dd className="tnum">
                {formatDateTime(shift.respond_by)}
                {deadlinePassed && shift.status === "open" ? (
                  <span className="block text-xs" style={{ color: "var(--warn)" }}>
                    Verstreken — niemand kan deze dienst nog aannemen.
                  </span>
                ) : null}
              </dd>
            </div>
          ) : null}
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
      {/*
        THE WAY BACK, which did not exist.
        See app/zorginstelling/diensten/withdrawActions.ts.
      */}
      {canWithdraw ? (
        <div className="card p-5 mb-6">
          <h2 className="font-bold mb-2">Toch niet nodig?</h2>
          <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
            Haal de dienst van het bord. Hij verdwijnt uit ieders aanbod en er is niets in rekening
            gebracht. Klopt er iets niet aan de tijden of het tarief? Haal deze weg en plaats een
            nieuwe — een geplaatste dienst kan niet worden aangepast, omdat mensen er al op
            gereageerd kunnen hebben.
          </p>
          <form action={withdrawShiftAction}>
            <input type="hidden" name="shift_id" value={shift.id} />
            <SubmitButton className="btn btn-secondary">Dienst intrekken</SubmitButton>
          </form>
        </div>
      ) : null}

      {assignment ? (
        <div className="card p-6 mb-6" style={{ borderColor: "var(--ok)" }}>
          <h2 className="font-bold mb-2">Wie komt er</h2>
          <p className="text-lg font-semibold">{assignment.freelancers?.profiles?.full_name ?? "—"}</p>
          {assignment.freelancers?.profiles?.profile_contact?.phone ? (
            <p className="text-sm tnum" style={{ color: "var(--text-muted)" }}>
              <a href={`tel:${assignment.freelancers.profiles?.profile_contact?.phone}`}>
                {assignment.freelancers.profiles?.profile_contact?.phone}
              </a>
            </p>
          ) : null}
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            Aangenomen op {formatDateTime(assignment.accepted_at)}
          </p>

          {/*
            Papers, at a glance. Verifying that somebody is qualified before they
            work is the facility's duty under Wkkgz, and this page — the one open
            the evening before a shift — required leaving it to find out.
          */}
          <div className="flex flex-wrap gap-2 mt-3">
            {assignment.freelancers?.big_verified_at ? (
              <span className="badge badge-ok">BIG gecontroleerd</span>
            ) : assignment.freelancers?.big_number ? (
              <span className="badge badge-warn">BIG nog niet gecontroleerd</span>
            ) : null}
            <Link
              className="badge badge-neutral no-underline"
              href={`/zorginstelling/pool/${assignment.freelancer_id}`}
            >
              Documenten bekijken
            </Link>
          </div>

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

      <div className="card table-scroll" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
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
              /*
                expired belongs in this list too.

                Migration 023 moved offers closed by a fill from 'decline' to
                'expired'. Before that they appeared here under declined; the new
                value was added to the bucket list and to the badge branch below,
                and never to the rows actually rendered — so they vanished from
                the table entirely, and the badge branch for them was unreachable.
                The dossier counts them; this screen stopped showing them.
              */
              [...accepted, ...silent, ...declined, ...expired].map((offer) => (
                <tr key={offer.id}>
                  <td className="font-medium">{offer.freelancers?.profiles?.full_name ?? "—"}</td>
                  <td>
                    {offer.response === "accept" ? (
                      <span className="badge badge-ok">Aangenomen</span>
                    ) : offer.response === "decline" ? (
                      <span className="badge badge-neutral">Niet beschikbaar</span>
                    ) : offer.response === "expired" ? (
                      /*
                        Not a refusal, and it must not read as one. This person
                        never answered — usually never even opened it, because the
                        shift was taken within minutes.
                      */
                      <span className="badge badge-neutral">Vergeven aan een ander</span>
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
          {accepted.length} aangenomen · {declined.length} niet beschikbaar
          {expired.length > 0 ? ` · ${expired.length} vergeven aan een ander` : ""} ·{" "}
          {silent.length} nog geen reactie. Dit wordt vastgelegd in het dossier.
        </p>
      ) : null}
    </div>
  );
}
