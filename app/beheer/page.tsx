import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { formatDate } from "@/lib/hours";
import { qualificationLabel } from "@/lib/qualifications";
import { verifyBigAction, verifyOrganisationAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { authErrorMessage } from "@/lib/authErrors";

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

  /*
   * Checked HERE, not only in the layout. See app/beheer/documenten/page.tsx —
   * same omission, same reason. This page returns every organisation's KvK number
   * and billing address and every unverified BIG number, with RLS bypassed.
   */
  /*
   * Named capabilities, not merely "is staff".
   *
   * Everything below is read with the service role: every organisation's KvK
   * number and billing address, and every unverified BIG number. An admin hired
   * only to review documents could reach all of it — which is precisely what
   * migration 014 exists to stop, and this page had not been updated to use it.
   *
   * Either capability is enough to open the page, and each of the two queues is
   * rendered only for the capability that can act on it — see the note at each
   * section. Somebody with neither is sent away above.
   */
  const me = await requireStaff("/beheer");
  const canVerifyOrgs = me.capabilities.includes("verify_organisations");
  const canVerifyBig = me.capabilities.includes("verify_big");

  if (!canVerifyOrgs && !canVerifyBig) redirect("/geen-toegang");

  // Service role: this page's entire purpose is to see across every tenant, which
  // is exactly what RLS is built to prevent.
  const admin = getSupabaseAdmin();

  const [{ data: pending }, { data: verified }, { data: freelancers }] = await Promise.all([
    admin
      .from("organisations")
      .select("id, name, kvk, billing_email, verified_at, created_at")
      /*
       * Filtered in the QUERY, not afterwards.
       *
       * This took the hundred newest organisations and only then kept the
       * unverified ones in TypeScript — so past a hundred registrations the
       * queue silently stopped showing facilities that were waiting, and a
       * facility that signed up early would never be verified. The BIG queue
       * directly below has always done it the other way round.
       */
      .is("verified_at", null)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<OrgRow[]>(),
    admin
      .from("organisations")
      .select("id, name, kvk, billing_email, verified_at, created_at")
      .not("verified_at", "is", null)
      .order("verified_at", { ascending: false })
      .limit(100)
      .returns<OrgRow[]>(),
    admin
      .from("freelancers")
      .select("profile_id, big_number, big_verified_at, profession, profiles(full_name)")
      .not("big_number", "is", null)
      .is("big_verified_at", null)
      /*
       * And not already looked at. Without this a number checked and NOT found
       * sat in the queue forever, because "not found" writes null to
       * big_verified_at — the value it already had. It returns only when the
       * freelancer edits the number, which clears big_checked_at: a new number is
       * a new claim.
       */
      .is("big_checked_at", null)
      .limit(100)
      .returns<FreelancerRow[]>(),
  ]);

  const pendingOrgs = pending ?? [];
  const verifiedOrgs = verified ?? [];

  return (
    <>
      <PageHeader
        title="Te verifiëren"
        description="Zorginstellingen kunnen pas diensten plaatsen nadat hier een mens naar hun KvK-inschrijving heeft gekeken."
      />

      {params.saved ? <FormMessage kind="ok">Opgeslagen.</FormMessage> : null}
      {params.error ? (
        <FormMessage kind="error">{authErrorMessage(params.error)}</FormMessage>
      ) : null}

      {/*
        Hidden when this admin cannot act on it.

        The two flags above were computed and never used, while the comment beside
        them claimed "the sections below hide the one you cannot act on". They did
        not. So an admin hired only to check BIG numbers read every organisation's
        KvK number and billing address, and one hired only to verify organisations
        read every unverified BIG number on the platform — which is the exact
        separation migration 014 exists to create.

        Not merely cosmetic: the button below each row posts to an action that
        checks the capability and refuses, so showing the queue offered work that
        would be rejected after the click.
      */}
      {canVerifyOrgs ? (
        <>
      <h2 className="text-lg font-bold mb-3">Wachtende zorginstellingen</h2>
      {pendingOrgs.length === 0 ? (
        <EmptyState title="Niets te verifiëren" body="Alle zorginstellingen zijn beoordeeld." />
      ) : (
        <div className="card table-scroll mb-8" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
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
                  <td className="tnum">
                      {/*
                        The number, and the register it has to be checked against.

                        The page instructs the reviewer to look the KvK number up
                        and then made them copy it into another tab by hand, every
                        single time. A reviewer doing that fifty times a week is a
                        reviewer who eventually stops doing it.
                      */}
                      {org.kvk ? (
                        <a
                          href={`https://www.kvk.nl/zoeken/?q=${encodeURIComponent(org.kvk)}`}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {org.kvk}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  <td style={{ color: "var(--text-muted)" }}>{org.billing_email ?? "—"}</td>
                  <td className="tnum">{formatDate(org.created_at)}</td>
                  <td>
                    <form action={verifyOrganisationAction}>
                      <input type="hidden" name="org_id" value={org.id} />
                      <input type="hidden" name="approve" value="true" />
                      <SubmitButton className="btn btn-primary">
                        Verifiëren
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}


      {/*
        Withdrawing verification belongs to verify_organisations.

        This block — the only place a verification can be withdrawn — was nested
        inside the canVerifyBig branch, which inverted the separation the comment
        further up claims to have just established: the capability that owns
        verification could not reach the revoke control, and the one that only
        checks BIG numbers saw every organisation's name, KvK and verification
        date. Moved by the ninth audit.
      */}
      {verifiedOrgs.length > 0 ? (
        <details>
          <summary className="cursor-pointer font-bold mb-3">
            Geverifieerde zorginstellingen ({verifiedOrgs.length})
          </summary>
          <div className="card table-scroll mt-3" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
            <table className="table">
              <tbody>
                {verifiedOrgs.map((org) => (
                  <tr key={org.id}>
                    <td className="font-medium">{org.name}</td>
                    <td className="tnum">{org.kvk ?? "—"}</td>
                    <td className="tnum">{org.verified_at ? formatDate(org.verified_at) : "—"}</td>
                    <td>
                      {/*
                        A second click, and what it actually does.

                        "Intrekken" was one tap on a red button in a table row.
                        Withdrawing verification stops a facility posting work
                        immediately — mid-week, with a roster half filled — and
                        closes the document access their pool gave them. That is
                        the right power to have and the wrong one to have by
                        mis-tapping a row.
                      */}
                      <details>
                        <summary
                          className="cursor-pointer text-sm font-semibold"
                          style={{ color: "var(--danger)" }}
                        >
                          Intrekken
                        </summary>
                        <p className="text-sm mt-2 mb-3" style={{ color: "var(--text-muted)" }}>
                          {org.name} kan daarna geen diensten meer plaatsen en krijgt geen
                          documentgegevens van zorgprofessionals meer te zien. Al geplaatste
                          diensten en lopende opdrachten blijven staan.
                        </p>
                        <form action={verifyOrganisationAction}>
                          <input type="hidden" name="org_id" value={org.id} />
                          <input type="hidden" name="approve" value="false" />
                          <SubmitButton className="btn btn-danger">
                            Ja, verificatie intrekken
                          </SubmitButton>
                        </form>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
        </>
      ) : null}

      {canVerifyBig ? (
        <>
      <h2 className="text-lg font-bold mb-3">BIG-nummers om te controleren</h2>
      <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
        Zoek het nummer op in het BIG-register voordat je het goedkeurt. Instellingen leunen hierop
        voor hun eigen Wkkgz-plicht, dus een vinkje zonder controle is erger dan geen vinkje.
      </p>
      {!freelancers || freelancers.length === 0 ? (
        <EmptyState title="Niets te controleren" body="Er staan geen ongecontroleerde BIG-nummers open." />
      ) : (
        <div className="card table-scroll mb-8" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
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
                  <td className="tnum">
                    {/*
                      Same reasoning as the KvK cell above: this page tells the
                      reviewer to look the number up in the BIG-register before
                      approving it, and then made them retype it into another tab.
                      The register takes the number directly.
                    */}
                    <a
                      href={`https://zoeken.bigregister.nl/zoeken?nummer=${encodeURIComponent(row.big_number ?? "")}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {row.big_number}
                    </a>
                  </td>
                  <td>
                    {/*
                      Two outcomes, because a lookup has two.

                      There was one button: "Gecontroleerd". A reviewer who
                      searched bigregister.nl and did NOT find the number could
                      only approve it or leave the row — so the answer this check
                      exists to produce had nowhere to go, the row came back
                      tomorrow, and the next person looked it up again. Meanwhile
                      the freelancer was never told, so a typo — eleven digits
                      from memory, by far the likeliest cause — stayed a typo.
                    */}
                    <div className="flex flex-col gap-2 items-end">
                      <form action={verifyBigAction}>
                        <input type="hidden" name="freelancer_id" value={row.profile_id} />
                        {/*
                          The number the reviewer just looked up, carried along.
                          Without it the write is bound to nothing: it stamped
                          "checked in the register" against whatever the column
                          held at the moment of the click, so a freelancer
                          correcting a typo while this page sat open got the NEW
                          number verified by a review of the OLD one.
                        */}
                        <input type="hidden" name="big_number" value={row.big_number ?? ""} />
                        <input type="hidden" name="approve" value="true" />
                        <SubmitButton className="btn btn-primary">
                          Gevonden in register
                        </SubmitButton>
                      </form>

                      <details>
                        <summary className="cursor-pointer text-sm font-semibold">
                          Niet gevonden
                        </summary>
                        <form action={verifyBigAction} className="mt-2 flex flex-col gap-2">
                          <input type="hidden" name="freelancer_id" value={row.profile_id} />
                          <input type="hidden" name="big_number" value={row.big_number ?? ""} />
                          <input type="hidden" name="approve" value="false" />
                          <label className="label" htmlFor={`big-note-${row.profile_id}`}>
                            Wat klopt er niet?
                          </label>
                          <input
                            className="input"
                            id={`big-note-${row.profile_id}`}
                            name="note"
                            type="text"
                            placeholder="bijv. nummer bestaat niet, of staat op een andere naam"
                          />
                          <p className="hint">
                            De zorgprofessional ziet dit en kan het nummer aanpassen. Daarna komt
                            het hier opnieuw langs.
                          </p>
                          <SubmitButton className="btn btn-secondary">
                            Vastleggen als niet gevonden
                          </SubmitButton>
                        </form>
                      </details>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

        </>
      ) : null}
    </>
  );
}
