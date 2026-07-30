import Link from "next/link";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { requireFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatEuros } from "@/lib/money";
import { formatShiftWindow } from "@/lib/hours";

export const metadata: Metadata = { title: "Overzicht" };

type ShiftRow = {
  id: string;
  profession: string;
  department: string | null;
  starts_at: string;
  ends_at: string;
  hourly_rate_cents: number;
  status: string;
};

export default async function FacilityDashboard() {
  const { org } = await requireFacilityAdmin("/zorginstelling");
  const supabase = await createClient();

  const now = new Date().toISOString();

  const [{ data: upcoming }, { count: poolCount }, { count: openCount }] = await Promise.all([
    supabase
      .from("shifts")
      .select("id, profession, department, starts_at, ends_at, hourly_rate_cents, status")
      .eq("org_id", org.id)
      .gte("starts_at", now)
      .order("starts_at", { ascending: true })
      .limit(8)
      .returns<ShiftRow[]>(),
    supabase
      .from("pools")
      .select("freelancer_id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .neq("status", "hidden"),
    supabase
      .from("shifts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .eq("status", "open")
      .gte("starts_at", now),
  ]);

  return (
    <>
      <PageHeader
        title={org.name}
        description="Overzicht van je openstaande en aankomende diensten."
        action={
          org.verified_at ? (
            <Link className="btn btn-primary" href="/zorginstelling/diensten/nieuw">
              Dienst plaatsen
            </Link>
          ) : null
        }
      />

      {!org.verified_at ? (
        <div
          className="card p-4 mb-6"
          style={{ borderColor: "var(--warn)", background: "var(--warn-subtle)" }}
        >
          <p className="font-semibold" style={{ color: "var(--warn)" }}>
            We controleren je inschrijving nog
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--warn)" }}>
            Zodra je KvK-gegevens zijn gecontroleerd kun je diensten plaatsen. Dat duurt meestal één
            werkdag. Je kunt in de tussentijd al je pool opbouwen.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <div className="card p-4">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Open diensten
          </p>
          <p className="text-2xl font-bold tnum mt-1">{openCount ?? 0}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Zorgprofessionals in pool
          </p>
          <p className="text-2xl font-bold tnum mt-1">{poolCount ?? 0}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Kosten voor jou
          </p>
          <p className="text-2xl font-bold tnum mt-1">{formatEuros(0)}</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            MyQare is gratis voor zorginstellingen.
          </p>
        </div>
      </div>

      <h2 className="text-lg font-bold mb-3">Aankomende diensten</h2>

      {!upcoming || upcoming.length === 0 ? (
        <EmptyState
          title="Nog geen aankomende diensten"
          body={
            org.verified_at
              ? "Plaats een dienst en de zorgprofessionals in je pool krijgen direct een melding."
              : "Zodra je account is geverifieerd kun je je eerste dienst plaatsen."
          }
        />
      ) : (
        <div className="card table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Wanneer</th>
                <th>Functie</th>
                <th>Afdeling</th>
                <th>Tarief</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((shift) => (
                <tr key={shift.id}>
                  <td className="tnum">{formatShiftWindow(shift.starts_at, shift.ends_at)}</td>
                  <td>{shift.profession}</td>
                  <td style={{ color: "var(--text-muted)" }}>{shift.department ?? "—"}</td>
                  <td className="tnum">{formatEuros(shift.hourly_rate_cents)} / uur</td>
                  <td>
                    <span
                      className={
                        shift.status === "filled"
                          ? "badge badge-ok"
                          : shift.status === "open"
                            ? "badge badge-brand"
                            : "badge badge-neutral"
                      }
                    >
                      {shift.status === "filled"
                        ? "Ingevuld"
                        : shift.status === "open"
                          ? "Open"
                          : shift.status === "cancelled"
                            ? "Geannuleerd"
                            : "Verlopen"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
