import Link from "next/link";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { requireFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatEuros } from "@/lib/money";
import { billableMinutes, formatMinutes, formatShiftWindow } from "@/lib/hours";
import { qualificationLabel } from "@/lib/qualifications";
import { SHIFT_STATUS_LABELS } from "@/lib/shifts";

export const metadata: Metadata = { title: "Diensten" };

type ShiftRow = {
  id: string;
  profession: string;
  department: string | null;
  starts_at: string;
  ends_at: string;
  hourly_rate_cents: number;
  break_minutes: number;
  status: string;
  respond_by: string | null;
  shift_offers: { id: string; response: string | null }[];
};

/**
 * What the status IS, not what the column says.
 *
 * Three things end an open shift and only one is written down: acceptance flips
 * the row to 'filled', while a passed deadline and a shift that has simply begun
 * change nothing at all — functions.sql writes 'expired' only from 'filled'. So a
 * shift nobody took still read "Open" a week after the night it was for, on the
 * screen a coordinator scans to see what still needs covering.
 *
 * Computed rather than written, because the column is what accept_shift guards
 * on and a cron that rewrites history is a worse answer than a screen that reads
 * the clock. The freelancer's side already applies these same three conditions
 * before showing an offer.
 */
function shiftStatus(shift: { status: string; starts_at: string; respond_by: string | null }): {
  label: string;
  className: string;
} {
  const now = Date.now();

  if (shift.status === "open") {
    if (new Date(shift.starts_at).getTime() <= now) {
      return { label: "Niet ingevuld", className: "badge badge-warn" };
    }
    if (shift.respond_by && new Date(shift.respond_by).getTime() < now) {
      return { label: "Reactietermijn verlopen", className: "badge badge-warn" };
    }
    return { label: "Open", className: "badge badge-brand" };
  }

  const label = SHIFT_STATUS_LABELS[shift.status] ?? shift.status;

  if (shift.status === "filled") return { label, className: "badge badge-ok" };
  if (shift.status === "cancelled") return { label, className: "badge badge-danger" };
  return { label, className: "badge badge-neutral" };
}

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{
    created?: string;
    offered?: string;
    shifts?: string;
    failed?: string;
    withdrawn?: string;
    error?: string;
  }>;
}) {
  const { org } = await requireFacilityAdmin("/zorginstelling/diensten");
  const params = await searchParams;
  const supabase = await createClient();

  const { data: shifts } = await supabase
    .from("shifts")
    .select(
      // respond_by, so the list can tell an open shift from a lapsed one.
      "id, profession, department, starts_at, ends_at, hourly_rate_cents, break_minutes, status, respond_by, shift_offers(id, response)",
    )
    .eq("org_id", org.id)
    .order("starts_at", { ascending: false })
    .limit(60)
    .returns<ShiftRow[]>();

  const posted = params.created !== undefined ? Number(params.shifts ?? 0) : null;
  const offered = Number(params.offered ?? 0);
  const failed = Number(params.failed ?? 0);

  return (
    <>
      <PageHeader
        title="Diensten"
        /*
          It sorts on starts_at descending, which is "latest shift first" — not
          "nieuwste eerst", which reads as most-recently-created. For a
          coordinator those differ by exactly the thing they care about: a shift
          posted this morning for next month sat above tonight's gap.
        */
        description="Alles wat je hebt geplaatst, de laatste dienst in de tijd bovenaan."
        action={
          org.verified_at ? (
            <Link className="btn btn-primary" href="/zorginstelling/diensten/nieuw">
              Dienst plaatsen
            </Link>
          ) : null
        }
      />

      {/*
        Nothing was created. Checked FIRST, because the branches below both read
        as some flavour of success: a series where every insert failed came out as
        "Dienst geplaatst, maar aan niemand aangeboden" and blamed the facility's
        pool for a failure on our side. The coordinator then goes looking for a
        shift that does not exist.
      */}
      {params.withdrawn ? (
        <FormMessage kind="ok">
          Dienst ingetrokken. Hij staat niet meer in het aanbod en er is niets in rekening gebracht.
        </FormMessage>
      ) : null}

      {posted !== null && posted === 0 ? (
        <FormMessage kind="error">
          Er is geen enkele dienst geplaatst — er ging iets mis aan onze kant, niet aan die van
          jou. Probeer het opnieuw; blijft het misgaan, laat het ons weten.
        </FormMessage>
      ) : posted !== null ? (
        offered > 0 ? (
          <FormMessage kind="ok">
            {posted === 1 ? "Dienst" : `${posted} diensten`} geplaatst, samen {offered} keer
            aangeboden.
            {failed > 0 ? ` ${failed} dienst(en) konden niet worden geplaatst.` : ""}
          </FormMessage>
        ) : (
          /*
           * Posting into an empty pool is the most common early mistake, and it
           * fails silently — the shift exists, nobody hears about it. Worth saying
           * out loud rather than showing a cheerful success message.
           */
          <FormMessage kind="warn">
            Dienst geplaatst, maar aan niemand aangeboden — er is niemand gevonden die past. Dat
            komt door één van drie dingen: er zit nog niemand met deze kwalificatie in je{" "}
            <Link href="/zorginstelling/pool">pool</Link>, je koos &quot;alleen favorieten&quot; en
            die zijn er nog niet, of je plaatste een regio-aanbod voor een regio waar nog niemand
            werkt. De dienst staat gewoon open: pas je pool aan of plaats hem opnieuw met een
            andere zichtbaarheid.
          </FormMessage>
        )
      ) : null}

      {!shifts || shifts.length === 0 ? (
        <EmptyState
          title="Nog geen diensten"
          body="Zodra je een dienst plaatst verschijnt die hier, met wie erop heeft gereageerd."
        />
      ) : (
        <div className="card table-scroll" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
          <table className="table">
            <thead>
              <tr>
                <th>Wanneer</th>
                <th>Kwalificatie</th>
                <th>Afdeling</th>
                <th>Duur</th>
                <th>Tarief</th>
                <th>Aangeboden</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift) => {
                const minutes = billableMinutes(shift.starts_at, shift.ends_at, shift.break_minutes);
                const accepted = shift.shift_offers?.some((offer) => offer.response === "accept");
                return (
                  <tr key={shift.id}>
                    <td className="tnum">{formatShiftWindow(shift.starts_at, shift.ends_at)}</td>
                    <td>{qualificationLabel(shift.profession)}</td>
                    <td style={{ color: "var(--text-muted)" }}>{shift.department ?? "—"}</td>
                    <td className="tnum">{formatMinutes(minutes)}</td>
                    <td className="tnum">{formatEuros(shift.hourly_rate_cents)}</td>
                    <td className="tnum">
                      {shift.shift_offers?.length ?? 0}
                      {accepted ? (
                        <span className="badge badge-ok ml-2">aangenomen</span>
                      ) : null}
                    </td>
                    <td>
                      {(() => {
                        const state = shiftStatus(shift);
                        return <span className={state.className}>{state.label}</span>;
                      })()}
                    </td>
                    <td>
                      <div className="flex gap-2 justify-end">
                        <Link
                          className="btn btn-secondary"
                          href={`/zorginstelling/diensten/${shift.id}`}
                        >
                          Openen
                        </Link>
                        {/*
                          The same shift again, next week.

                          A ward that needed a night nurse this Tuesday usually
                          needed one last Tuesday too — same qualification, same
                          ward, same rate, same break, same visibility. Retyping
                          thirteen fields for a difference of one date is the
                          friction that ends with somebody phoning an agency
                          instead. The form copies everything except the times,
                          which are the one thing genuinely different each time.
                        */}
                        <Link
                          className="btn btn-secondary"
                          href={`/zorginstelling/diensten/nieuw?from=${shift.id}`}
                        >
                          Opnieuw plaatsen
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
