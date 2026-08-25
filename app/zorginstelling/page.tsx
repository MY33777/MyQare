import Link from "next/link";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { requireFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatEuros } from "@/lib/money";
import { formatShiftWindow } from "@/lib/hours";
import { qualificationLabel } from "@/lib/qualifications";
import { Checklist } from "@/components/Checklist";
import { facilityChecklist, nextStep } from "@/lib/onboarding";

export const metadata: Metadata = { title: "Overzicht" };

type ShiftRow = {
  id: string;
  profession: string;
  department: string | null;
  starts_at: string;
  ends_at: string;
  hourly_rate_cents: number;
  status: string;
  /*
   * An ARRAY, because a shift can carry a cancelled assignment plus its
   * replacement — migration 008 replaced the unique constraint with a partial
   * index so a cancelled one stops reserving its shift, and PostgREST infers
   * cardinality from that constraint. See the long note in
   * app/zorginstelling/diensten/[id]/page.tsx, where typing this as an object
   * made every shift render a card naming nobody.
   */
  assignments:
    | { status: string; freelancers: { profiles: { full_name: string } | null } | null }[]
    | null;
};

/**
 * The name of whoever took the shift, if anybody has.
 *
 * A shift can carry a cancelled assignment plus its replacement — see migration
 * 008 — so this picks the live one rather than [0], which would name last week's
 * withdrawal as the person turning up tomorrow.
 */
function filledBy(shift: {
  assignments?:
    | { status: string; freelancers: { profiles: { full_name: string } | null } | null }[]
    | null;
}): string | null {
  const live = (shift.assignments ?? []).find((row) => row.status !== "cancelled");
  return live?.freelancers?.profiles?.full_name ?? null;
}

export default async function FacilityDashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  /*
   * The dashboard is a redirect TARGET and rendered nothing it was sent.
   *
   * /zorginstelling/diensten/nieuw bounces an unverified facility here with
   * ?error=not_verified, and this page took no searchParams at all — so she
   * clicked "Dienst plaatsen", the screen reloaded, and nothing whatsoever
   * happened or was said. The most common reading of that is that the click
   * did not register, so she clicks again.
   */
  const params = await searchParams;
  const { org } = await requireFacilityAdmin("/zorginstelling");
  const supabase = await createClient();

  const now = new Date().toISOString();

  const [{ data: upcoming }, { count: poolCount }, { count: openCount }, { count: shiftTotal }] =
    await Promise.all([
    supabase
      .from("shifts")
      .select(
        "id, profession, department, starts_at, ends_at, hourly_rate_cents, status, " +
          "assignments(status, freelancers(profiles(full_name)))",
      )
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
    // Every shift ever posted, not just open ones — the checklist asks whether
    // they have posted at all, and a filled shift still counts as having started.
    supabase
      .from("shifts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id),
  ]);

  const checklist = facilityChecklist({
    verified: Boolean(org.verified_at),
    hasBillingEmail: Boolean(org.billing_email),
    hasBillingAddress: Boolean(org.address_line && org.postcode && org.city),
    poolCount: poolCount ?? 0,
    shiftCount: shiftTotal ?? 0,
    assignmentCount: 0,
  });

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

      {params.error ? (
        <FormMessage kind="warn">{authErrorMessage(params.error)}</FormMessage>
      ) : null}

      {/*
        Replaces the old standalone "not verified" banner. Verification is one step
        among four, and showing it alone hid the step that actually fails silently:
        an empty pool means a posted shift reaches nobody while reporting success.
      */}
      <Checklist steps={checklist} next={nextStep(checklist)} />

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
        <div className="card table-scroll" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
          <table className="table">
            <thead>
              <tr>
                <th>Wanneer</th>
                <th>Functie</th>
                <th>Afdeling</th>
                <th>Tarief</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {upcoming.map((shift) => (
                <tr key={shift.id}>
                  <td className="tnum">{formatShiftWindow(shift.starts_at, shift.ends_at)}</td>
                  <td>{qualificationLabel(shift.profession)}</td>
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
                    {/*
                      Who is coming, not merely that somebody is.

                      "Ingevuld" answered the smaller half of the question. A
                      coordinator looking at tomorrow needs the name — to ring
                      them, to know whether it is somebody the ward has had
                      before — and getting it meant opening the shift.
                    */}
                    {filledBy(shift) ? (
                      <span className="block text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                        {filledBy(shift)}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {/*
                      The row was not a link at all, so the dashboard listed the
                      week and gave no way into any of it.
                    */}
                    <Link className="text-sm" href={`/zorginstelling/diensten/${shift.id}`}>
                      Bekijken
                    </Link>
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
