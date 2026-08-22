import Link from "next/link";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { requireFreelancer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { billableMinutes, formatMinutes, formatShiftWindow } from "@/lib/hours";
import { formatEuros } from "@/lib/money";
import { qualificationLabel } from "@/lib/qualifications";

export const metadata: Metadata = { title: "Mijn diensten" };

type AssignmentRow = {
  id: string;
  agreed_rate_cents: number;
  agreed_break_minutes: number;
  status: string;
  shifts: {
    profession: string;
    department: string | null;
    starts_at: string;
    ends_at: string;
    organisations: { name: string } | null;
  } | null;
  timesheets: {
    minutes_claimed: number;
    /*
     * The unpaid break, which this page did not fetch and therefore did not
     * subtract. minutes_claimed is the GROSS worked duration; every other path
     * in the product takes the break off it before pricing. See below.
     */
    break_minutes: number;
    approved_at: string | null;
    disputed_at: string | null;
  } | null;
};

function timesheetBadge(row: AssignmentRow) {
  if (row.status === "cancelled") return <span className="badge badge-danger">Geannuleerd</span>;
  if (row.timesheets?.approved_at) return <span className="badge badge-ok">Goedgekeurd</span>;
  if (row.timesheets?.disputed_at) return <span className="badge badge-danger">Betwist</span>;
  if (row.timesheets) return <span className="badge badge-warn">Wacht op goedkeuring</span>;
  if (new Date(row.shifts?.ends_at ?? 0) < new Date()) {
    return <span className="badge badge-warn">Uren invullen</span>;
  }
  return <span className="badge badge-brand">Gepland</span>;
}

export default async function MyAssignmentsPage() {
  const { userId } = await requireFreelancer("/professional/diensten");
  const supabase = await createClient();

  const { data: assignments } = await supabase
    .from("assignments")
    .select(
      "id, agreed_rate_cents, agreed_break_minutes, status, shifts(profession, department, starts_at, ends_at, organisations(name)), timesheets(minutes_claimed, break_minutes, approved_at, disputed_at)",
    )
    .eq("freelancer_id", userId)
    .order("accepted_at", { ascending: false })
    .limit(60)
    .returns<AssignmentRow[]>();

  return (
    <>
      <PageHeader title="Mijn diensten" description="Alles wat je hebt aangenomen." />

      {!assignments || assignments.length === 0 ? (
        <EmptyState
          title="Nog geen diensten"
          body="Diensten die je aanneemt verschijnen hier, met de uren die je invult."
        />
      ) : (
        <div className="card table-scroll" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
          <table className="table">
            <thead>
              <tr>
                <th>Wanneer</th>
                <th>Instelling</th>
                <th>Kwalificatie</th>
                <th>Gepland</th>
                <th>Opbrengst</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {assignments.map((row) => {
                const scheduled = row.shifts
                  ? billableMinutes(row.shifts.starts_at, row.shifts.ends_at, row.agreed_break_minutes)
                  : 0;
                /*
                 * The break comes off, as it does everywhere else.
                 *
                 * minutes_claimed is gross — the freelancer submits when she
                 * arrived and left — and break_minutes is a separate column that
                 * lib/invoices.ts, approveTimesheet, the approval queue and the
                 * assignment detail page all subtract. This page did not even
                 * fetch it, so the moment hours were submitted the "Opbrengst"
                 * column jumped by half an hour's pay and then disagreed with the
                 * invoice that followed.
                 *
                 * Clamped at zero for the same reason billableMinutes clamps: a
                 * break longer than the shift is a typo, not negative earnings.
                 */
                const minutes = row.timesheets
                  ? Math.max(0, row.timesheets.minutes_claimed - row.timesheets.break_minutes)
                  : scheduled;
                return (
                  <tr key={row.id}>
                    <td className="tnum">
                      {row.shifts ? formatShiftWindow(row.shifts.starts_at, row.shifts.ends_at) : "—"}
                    </td>
                    <td>{row.shifts?.organisations?.name ?? "—"}</td>
                    <td>{qualificationLabel(row.shifts?.profession)}</td>
                    <td className="tnum">{formatMinutes(scheduled)}</td>
                    <td className="tnum">
                      {formatEuros(Math.round((minutes * row.agreed_rate_cents) / 60))}
                    </td>
                    <td>{timesheetBadge(row)}</td>
                    <td>
                      <Link className="btn btn-secondary" href={`/professional/diensten/${row.id}`}>
                        Openen
                      </Link>
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
