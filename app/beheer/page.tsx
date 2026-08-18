import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { formatDate } from "@/lib/hours";
import { qualificationLabel } from "@/lib/qualifications";
import { verifyBigAction, verifyOrganisationAction } from "./actions";

export const metadata: Metadata = { title: "Beheer" };

type OrgRow = {
  id: string;
  name: string;
  kvk: string | null;
  billing_email: string | null;
  verified_at: string | null;
  created_at: string;
};

type FreelancerRow = {
  profile_id: string;
  big_number: string | null;
  big_verified_at: string | null;
  profession: string;
  profiles: { full_name: string } | null;
};

export default async function StaffDashboard({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;

  // Service role: this page's entire purpose is to see across every tenant, which
  // is exactly what RLS is built to prevent. The staff check happens in the layout
  // and again in every action.
  const admin = getSupabaseAdmin();

  const [{ data: orgs }, { data: freelancers }] = await Promise.all([
    admin
      .from("organisations")
      .select("id, name, kvk, billing_email, verified_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<OrgRow[]>(),
    admin
      .from("freelancers")
      .select("profile_id, big_number, big_verified_at, profession, profiles(full_name)")
      .not("big_number", "is", null)
      .is("big_verified_at", null)
      .limit(100)
      .returns<FreelancerRow[]>(),
  ]);

  const pendingOrgs = (orgs ?? []).filter((org) => !org.verified_at);
  const verifiedOrgs = (orgs ?? []).filter((org) => org.verified_at);

  return (
    <>
      <PageHeader
        title="Te verifiëren"
        description="Zorginstellingen kunnen pas diensten plaatsen nadat hier een mens naar hun KvK-inschrijving heeft gekeken."
      />

      {params.saved ? <FormMessage kind="ok">Opgeslagen.</FormMessage> : null}
      {params.error ? <FormMessage kind="error">Er ging iets mis.</FormMessage> : null}

      <h2 className="text-lg font-bold mb-3">Wachtende zorginstellingen</h2>
      {pendingOrgs.length === 0 ? (
        <EmptyState title="Niets te verifiëren" body="Alle zorginstellingen zijn beoordeeld." />
      ) : (
        <div className="card table-scroll mb-8">
          <table className="table">
            <thead>
              <tr>
                <th>Naam</th>
                <th>KvK</th>
                <th>Factuur-e-mail</th>
                <th>Aangemeld</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pendingOrgs.map((org) => (
                <tr key={org.id}>
                  <td className="font-medium">{org.name}</td>
                  <td className="tnum">{org.kvk ?? "—"}</td>
                  <td style={{ color: "var(--text-muted)" }}>{org.billing_email ?? "—"}</td>
                  <td className="tnum">{formatDate(org.created_at)}</td>
                  <td>
                    <form action={verifyOrganisationAction}>
                      <input type="hidden" name="org_id" value={org.id} />
                      <input type="hidden" name="approve" value="true" />
                      <button className="btn btn-primary" type="submit">
                        Verifiëren
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="text-lg font-bold mb-3">BIG-nummers om te controleren</h2>
      <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
        Zoek het nummer op in het BIG-register voordat je het goedkeurt. Instellingen leunen hierop
        voor hun eigen Wkkgz-plicht, dus een vinkje zonder controle is erger dan geen vinkje.
      </p>
      {!freelancers || freelancers.length === 0 ? (
        <EmptyState title="Niets te controleren" body="Er staan geen ongecontroleerde BIG-nummers open." />
      ) : (
        <div className="card table-scroll mb-8">
          <table className="table">
            <thead>
              <tr>
                <th>Naam</th>
                <th>Kwalificatie</th>
                <th>BIG-nummer</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {freelancers.map((row) => (
                <tr key={row.profile_id}>
                  <td className="font-medium">{row.profiles?.full_name ?? "—"}</td>
                  <td>{qualificationLabel(row.profession)}</td>
                  <td className="tnum">{row.big_number}</td>
                  <td>
                    <form action={verifyBigAction}>
                      <input type="hidden" name="freelancer_id" value={row.profile_id} />
                      <input type="hidden" name="approve" value="true" />
                      <button className="btn btn-primary" type="submit">
                        Gecontroleerd
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {verifiedOrgs.length > 0 ? (
        <details>
          <summary className="cursor-pointer font-bold mb-3">
            Geverifieerde zorginstellingen ({verifiedOrgs.length})
          </summary>
          <div className="card table-scroll mt-3">
            <table className="table">
              <tbody>
                {verifiedOrgs.map((org) => (
                  <tr key={org.id}>
                    <td className="font-medium">{org.name}</td>
                    <td className="tnum">{org.kvk ?? "—"}</td>
                    <td className="tnum">{org.verified_at ? formatDate(org.verified_at) : "—"}</td>
                    <td>
                      <form action={verifyOrganisationAction}>
                        <input type="hidden" name="org_id" value={org.id} />
                        <input type="hidden" name="approve" value="false" />
                        <button className="btn btn-danger" type="submit">
                          Intrekken
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </>
  );
}
