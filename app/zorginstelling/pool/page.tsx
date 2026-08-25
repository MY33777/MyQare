import Link from "next/link";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { requireFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { qualificationLabel } from "@/lib/qualifications";
import { addToPoolAction, setPoolStatusAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Mijn pool" };

type PoolRow = {
  freelancer_id: string;
  status: string;
  note: string | null;
  freelancers: {
    profession: string;
    big_number: string | null;
    big_verified_at: string | null;
    profiles: { full_name: string } | null;
  } | null;
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
      "freelancer_id, status, note, freelancers(profession, big_number, big_verified_at, profiles(full_name))",
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

      {/*
        The form is not offered while the gate is closed.

        addToPoolAction refuses until the organisation is verified, and so does the
        policy behind it. Rendering the form anyway meant she typed a colleague's
        address and was refused afterwards, which is the worst order to find out.
        And "Mijn pool" is an unconditional nav item, so fixing the dashboard
        checklist alone would have left this reachable and still broken.
      */}
      {!org.verified_at ? (
        <div className="card p-5 mb-6">
          <h2 className="font-bold mb-2">Nog even geduld</h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Je pool kun je opbouwen zodra we je KvK-inschrijving hebben gecontroleerd — meestal
            binnen één werkdag. Je krijgt bericht zodra dat rond is; je hoeft nu niets te doen.
          </p>
        </div>
      ) : (
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
            {/*
              "Stuur ze de uitnodiging" named an action that does not exist: there
              is no invite-a-freelancer path anywhere in the product. The invite
              flow on /zorginstelling/instellingen is for COLLEAGUES at the same
              facility, which is a different thing entirely.
            */}
            <p className="hint">
              Zij moeten al een MyQare-account hebben. Nog niet? Vraag ze zich aan te melden op
              myqare.nl — zodra dat is gebeurd kun je ze hier toevoegen.
            </p>
          </div>
          <SubmitButton className="btn btn-primary">
            Toevoegen
          </SubmitButton>
        </form>
      )}

      {/*
        What the three states actually DO, said on the screen that sets them.

        "Favoriet" and "Verbergen" were two buttons with no consequence attached
        to either. A coordinator could not tell whether hiding somebody was a
        note to themselves or something that person would notice — and it is
        neither: it silently removes them from every offer, including a
        region-wide one they would otherwise have received as a stranger. That is
        a real consequence for somebody's income and it was unlabelled.
      */}
      <div className="card p-4 mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
        <p>
          <strong style={{ color: "var(--text)" }}>Lid</strong> — krijgt elke dienst die je aan je
          pool aanbiedt.
        </p>
        <p className="mt-1">
          <strong style={{ color: "var(--text)" }}>Favoriet</strong> — krijgt daarnaast de diensten
          die je alleen aan favorieten aanbiedt.
        </p>
        <p className="mt-1">
          <strong style={{ color: "var(--text)" }}>Verborgen</strong> — krijgt niets meer van je te
          zien, ook geen regio-aanbod. De zorgprofessional krijgt hier geen bericht over en merkt
          alleen dat er geen diensten meer binnenkomen.
        </p>
      </div>

      {active.length === 0 ? (
        <EmptyState
          title="Je pool is nog leeg"
          body="Voeg de zorgprofessionals toe waar je nu al mee werkt. Zonder pool wordt een dienst aan niemand aangeboden."
        />
      ) : (
        <div className="card table-scroll mb-8" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
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
                      {row.freelancers?.profiles?.full_name ?? "—"}
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
                        <SubmitButton className="btn btn-secondary">
                          {row.status === "star" ? "Geen favoriet" : "Favoriet"}
                        </SubmitButton>
                      </form>
                      <form action={setPoolStatusAction}>
                        <input type="hidden" name="freelancer_id" value={row.freelancer_id} />
                        <input type="hidden" name="status" value="hidden" />
                        <SubmitButton className="btn btn-danger">
                          Verbergen
                        </SubmitButton>
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
          <div className="card table-scroll" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
            <table className="table">
              <tbody>
                {hidden.map((row) => (
                  <tr key={row.freelancer_id}>
                    <td className="font-medium">{row.freelancers?.profiles?.full_name ?? "—"}</td>
                    <td>{qualificationLabel(row.freelancers?.profession)}</td>
                    <td>
                      <form action={setPoolStatusAction}>
                        <input type="hidden" name="freelancer_id" value={row.freelancer_id} />
                        <input type="hidden" name="status" value="member" />
                        <SubmitButton className="btn btn-secondary">
                          Weer tonen
                        </SubmitButton>
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
