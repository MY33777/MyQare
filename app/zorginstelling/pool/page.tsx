import Link from "next/link";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { requireFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { qualificationLabel } from "@/lib/qualifications";
import { addToPoolAction, setPoolStatusAction } from "./actions";

export const metadata: Metadata = { title: "Mijn pool" };

type PoolRow = {
  freelancer_id: string;
  status: string;
  note: string | null;
  profiles: { full_name: string } | null;
  freelancers: { profession: string; big_number: string | null; big_verified_at: string | null } | null;
};

const STATUS_LABELS: Record<string, string> = {
  member: "In pool",
  star: "Favoriet",
  hidden: "Verborgen",
};

export default async function PoolPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; added?: string }>;
}) {
  const { org } = await requireFacilityAdmin("/zorginstelling/pool");
  const params = await searchParams;
  const supabase = await createClient();

  const { data: pool } = await supabase
    .from("pools")
    .select(
      "freelancer_id, status, note, profiles(full_name), freelancers(profession, big_number, big_verified_at)",
    )
    .eq("org_id", org.id)
    .returns<PoolRow[]>();

  const active = (pool ?? []).filter((row) => row.status !== "hidden");
  const hidden = (pool ?? []).filter((row) => row.status === "hidden");

  return (
    <>
      <PageHeader
        title="Mijn pool"
        description="De zorgprofessionals waar je mee werkt. Zij krijgen jouw diensten als eerste te zien."
      />

      {params.error ? <FormMessage kind="error">{authErrorMessage(params.error)}</FormMessage> : null}
      {params.added ? <FormMessage kind="ok">Toegevoegd aan je pool.</FormMessage> : null}

      <form action={addToPoolAction} className="card p-4 mb-6 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-64">
          <label className="label" htmlFor="email">
            Zorgprofessional toevoegen
          </label>
          <input
            className="input"
            id="email"
            name="email"
            type="email"
            placeholder="e-mailadres van de zzp'er"
            required
          />
          <p className="hint">
            Zij moeten al een MyQare-account hebben. Nog niet? Stuur ze de uitnodiging om zich aan te
            melden.
          </p>
        </div>
        <button className="btn btn-primary" type="submit">
          Toevoegen
        </button>
      </form>

      {active.length === 0 ? (
        <EmptyState
          title="Je pool is nog leeg"
          body="Voeg de zorgprofessionals toe waar je nu al mee werkt. Zonder pool wordt een dienst aan niemand aangeboden."
        />
      ) : (
        <div className="card table-scroll mb-8">
          <table className="table">
            <thead>
              <tr>
                <th>Naam</th>
                <th>Kwalificatie</th>
                <th>BIG</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {active.map((row) => (
                <tr key={row.freelancer_id}>
                  <td className="font-medium">
                    <Link href={`/zorginstelling/pool/${row.freelancer_id}`}>
                      {row.profiles?.full_name ?? "—"}
                    </Link>
                  </td>
                  <td>{qualificationLabel(row.freelancers?.profession)}</td>
                  <td>
                    {row.freelancers?.big_verified_at ? (
                      <span className="badge badge-ok">Geverifieerd</span>
                    ) : row.freelancers?.big_number ? (
                      <span className="badge badge-warn">Niet gecontroleerd</span>
                    ) : (
                      <span className="badge badge-neutral">Geen</span>
                    )}
                  </td>
                  <td>
                    <span className={row.status === "star" ? "badge badge-brand" : "badge badge-neutral"}>
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <form action={setPoolStatusAction}>
                        <input type="hidden" name="freelancer_id" value={row.freelancer_id} />
                        <input
                          type="hidden"
                          name="status"
                          value={row.status === "star" ? "member" : "star"}
                        />
                        <button className="btn btn-secondary" type="submit">
                          {row.status === "star" ? "Geen favoriet" : "Favoriet"}
                        </button>
                      </form>
                      <form action={setPoolStatusAction}>
                        <input type="hidden" name="freelancer_id" value={row.freelancer_id} />
                        <input type="hidden" name="status" value="hidden" />
                        <button className="btn btn-danger" type="submit">
                          Verbergen
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hidden.length > 0 ? (
        <section>
          <h2 className="text-lg font-bold mb-2">Verborgen</h2>
          <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
            Deze zorgprofessionals krijgen jouw diensten niet meer te zien. Dit geldt alleen voor{" "}
            {org.name} — andere instellingen merken hier niets van en hun werk elders verandert niet.
          </p>
          <div className="card table-scroll">
            <table className="table">
              <tbody>
                {hidden.map((row) => (
                  <tr key={row.freelancer_id}>
                    <td className="font-medium">{row.profiles?.full_name ?? "—"}</td>
                    <td>{qualificationLabel(row.freelancers?.profession)}</td>
                    <td>
                      <form action={setPoolStatusAction}>
                        <input type="hidden" name="freelancer_id" value={row.freelancer_id} />
                        <input type="hidden" name="status" value="member" />
                        <button className="btn btn-secondary" type="submit">
                          Weer tonen
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
