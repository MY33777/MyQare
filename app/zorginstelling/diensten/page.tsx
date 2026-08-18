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
  shift_offers: { id: string; response: string | null }[];
};

function statusBadgeClass(status: string): string {
  if (status === "filled") return "badge badge-ok";
  if (status === "open") return "badge badge-brand";
  if (status === "cancelled") return "badge badge-danger";
  return "badge badge-neutral";
}

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; offered?: string }>;
}) {
  const { org } = await requireFacilityAdmin("/zorginstelling/diensten");
  const params = await searchParams;
  const supabase = await createClient();

  const { data: shifts } = await supabase
    .from("shifts")
    .select(
      "id, profession, department, starts_at, ends_at, hourly_rate_cents, break_minutes, status, shift_offers(id, response)",
    )
    .eq("org_id", org.id)
    .order("starts_at", { ascending: false })
    .limit(60)
    .returns<ShiftRow[]>();

  const offered = params.created ? Number(params.offered ?? 0) : null;

  return (
    <>
      <PageHeader
        title="Diensten"
        description="Alles wat je hebt geplaatst, nieuwste eerst."
        action={
          org.verified_at ? (
            <Link className="btn btn-primary" href="/zorginstelling/diensten/nieuw">
              Dienst plaatsen
            </Link>
          ) : null
        }
      />

      {offered !== null ? (
        offered > 0 ? (
          <FormMessage kind="ok">
            Dienst geplaatst en aangeboden aan {offered}{" "}
            {offered === 1 ? "zorgprofessional" : "zorgprofessionals"}.
          </FormMessage>
        ) : (
          /*
           * Posting into an empty pool is the most common early mistake, and it
           * fails silently — the shift exists, nobody hears about it. Worth saying
           * out loud rather than showing a cheerful success message.
           */
          <FormMessage kind="error">
            Dienst geplaatst, maar aan niemand aangeboden. Er zitten nog geen passende
            zorgprofessionals in je pool — voeg ze toe via <Link href="/zorginstelling/pool">Mijn pool</Link>.
          </FormMessage>
        )
      ) : null}

      {!shifts || shifts.length === 0 ? (
        <EmptyState
          title="Nog geen diensten"
          body="Zodra je een dienst plaatst verschijnt die hier, met wie erop heeft gereageerd."
        />
      ) : (
        <div className="card table-scroll">
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
                      <span className={statusBadgeClass(shift.status)}>
                        {SHIFT_STATUS_LABELS[shift.status] ?? shift.status}
                      </span>
                    </td>
                    <td>
                      <Link className="btn btn-secondary" href={`/zorginstelling/diensten/${shift.id}`}>
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
