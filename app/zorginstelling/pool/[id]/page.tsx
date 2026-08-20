import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/AppHeader";
import { requireFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatEuros } from "@/lib/money";
import { formatDate, formatShiftWindow } from "@/lib/hours";
import { qualificationLabel } from "@/lib/qualifications";
import { summaryFromRpc } from "@/lib/ratings";
import {
  DOCUMENT_KIND_LABELS,
  documentUrl,
  expiryState,
  type DocumentKind,
  documentAccessStatuses,
} from "@/lib/documents";
import { setPoolStatusAction } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Zorgprofessional" };

type FreelancerDetail = {
  profile_id: string;
  profession: string;
  specialisations: string[] | null;
  region: string | null;
  bio: string | null;
  kvk: string | null;
  big_number: string | null;
  big_verified_at: string | null;
  hourly_rate_min_cents: number | null;
  profiles: { full_name: string; profile_contact: { phone: string | null } | null } | null;
};

export default async function PoolMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org } = await requireFacilityAdmin(`/zorginstelling/pool/${id}`);
  const supabase = await createClient();

  // Scoped through pools, so RLS answers "is this person in my pool?" as part of
  // the query rather than being checked afterwards.
  const { data: membership } = await supabase
    .from("pools")
    .select("status, note")
    .eq("org_id", org.id)
    .eq("freelancer_id", id)
    .maybeSingle<{ status: string; note: string | null }>();

  if (!membership) notFound();

  const [{ data: freelancer }, { data: assignments }, { data: ratingRows }, { data: documents }] =
    await Promise.all([
      supabase
        .from("freelancers")
        .select(
          "profile_id, profession, specialisations, region, bio, kvk, big_number, big_verified_at, hourly_rate_min_cents, profiles(full_name, profile_contact(phone))",
        )
        .eq("profile_id", id)
        .maybeSingle<FreelancerDetail>(),
      supabase
        .from("assignments")
        .select("id, status, agreed_rate_cents, shifts(profession, starts_at, ends_at)")
        .eq("org_id", org.id)
        .eq("freelancer_id", id)
        .order("accepted_at", { ascending: false })
        .limit(20)
        .returns<
          {
            id: string;
            status: string;
            agreed_rate_cents: number;
            shifts: { profession: string; starts_at: string; ends_at: string } | null;
          }[]
        >(),
      supabase
        /*
         * Through the function. Reading the rows gave this facility an average of
         * only ITS OWN assignments — all RLS ever let it see — while presenting
         * the number as the freelancer's standing. This is the figure everyone
         * sees. See migration 019.
         */
        .rpc("rating_summary", { p_freelancer_id: id })
        .single<{ rating_count: number; shrunk_score: number | string | null }>(),
      supabase
        .from("documents")
        .select("id, kind, file_path, expires_on, status")
        .eq("freelancer_id", id)
        .eq("status", "approved")
        .returns<{ id: string; kind: string; file_path: string; expires_on: string | null; status: string }[]>(),
    ]);

  if (!freelancer) notFound();

  const rating = summaryFromRpc(ratingRows);
  /*
   * A CANCELLED assignment is not a working relationship.
   *
   * Migration 017 added exactly that filter to documents_select, and its own
   * comment says "server code only mints those where a real working relationship
   * exists". This was that server code, and it counted every assignment row
   * including cancelled ones — so a facility that booked somebody and cancelled
   * before the shift ran still got signed links to their VOG and diplomas. The
   * links come from documentUrl, which uses the service role and bypasses storage
   * RLS entirely, so the policy could not catch it on the way past.
   *
   * That made 017 inert for the thing that actually matters: reading the row only
   * yields a file_path, and a file_path in a private bucket is inert without one
   * of these links.
   *
   * Same predicate as the policy, deliberately — see documentAccessStatuses.
   */
  const hasWorkedHere = (assignments ?? []).some((row) =>
    documentAccessStatuses.has(row.status),
  );

  /*
   * Signed links only once there has been an actual working relationship.
   *
   * A facility adds someone to its pool unilaterally, by typing an email address —
   * that is not the freelancer's consent to hand over a scan of their passport.
   * Pool membership answers "is their VOG valid"; opening the file itself needs a
   * real engagement behind it.
   */
  const withLinks = await Promise.all(
    (documents ?? []).map(async (document) => ({
      ...document,
      url: hasWorkedHere ? await documentUrl(document.file_path) : null,
    })),
  );

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={freelancer.profiles?.full_name ?? "Zorgprofessional"}
        description={qualificationLabel(freelancer.profession)}
        action={
          <Link className="btn btn-secondary" href="/zorginstelling/pool">
            Terug naar pool
          </Link>
        }
      />

      <div className="card p-6 mb-6">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              BIG-registratie
            </dt>
            <dd className="font-semibold">
              {freelancer.big_verified_at ? (
                <>
                  <span className="badge badge-ok">Geverifieerd</span>
                  <span className="block text-sm font-normal tnum mt-1">
                    {freelancer.big_number}
                  </span>
                </>
              ) : freelancer.big_number ? (
                <span className="badge badge-warn">Nog niet gecontroleerd</span>
              ) : (
                <span className="badge badge-neutral">Geen</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              KvK
            </dt>
            <dd className="font-semibold tnum">{freelancer.kvk ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Regio
            </dt>
            <dd className="font-semibold">{freelancer.region ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Richttarief
            </dt>
            <dd className="font-semibold tnum">
              {freelancer.hourly_rate_min_cents
                ? `${formatEuros(freelancer.hourly_rate_min_cents)} / uur`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Beoordeling
            </dt>
            <dd className="font-semibold tnum">
              {rating.score.toFixed(1)}
              {/* The count sits next to the score, always. A 9.0 from one shift
                  and a 9.0 from twenty are not the same claim. */}
              <span className="text-sm font-normal ml-1" style={{ color: "var(--text-muted)" }}>
                ({rating.count})
              </span>
              {rating.provisional ? (
                <span className="block text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                  voorlopig
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-sm" style={{ color: "var(--text-muted)" }}>
              Telefoon
            </dt>
            <dd className="font-semibold tnum">
              {/* Only once they have actually worked here — a pool entry is not a
                  reason to hand out someone's mobile number. */}
              {/* RLS on profile_contact already requires a real assignment, so this
                  returns null for a pool-only member rather than relying on the
                  template to hide it. */}
              {freelancer.profiles?.profile_contact?.phone ? (
                <a href={`tel:${freelancer.profiles.profile_contact.phone}`}>
                  {freelancer.profiles.profile_contact.phone}
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>

        {freelancer.bio ? (
          <p className="text-sm mt-4" style={{ color: "var(--text-muted)" }}>
            {freelancer.bio}
          </p>
        ) : null}
      </div>

      <h2 className="text-lg font-bold mb-3">Documenten</h2>
      {withLinks.length === 0 ? (
        <div className="card p-5 mb-6">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Er zijn nog geen goedgekeurde documenten. Vraag de zorgprofessional om in elk geval een
            VOG en een diploma te uploaden voordat je een dienst aanbiedt.
          </p>
        </div>
      ) : (
        <div className="card table-scroll mb-6" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
          <table className="table">
            <thead>
              <tr>
                <th>Soort</th>
                <th>Geldig tot</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {withLinks.map((document) => {
                const state = expiryState(document.expires_on);
                return (
                  <tr key={document.id}>
                    <td className="font-medium">
                      {DOCUMENT_KIND_LABELS[document.kind as DocumentKind] ?? document.kind}
                    </td>
                    <td className="tnum">
                      {document.expires_on ? formatDate(document.expires_on) : "—"}
                      {state === "verlopen" ? (
                        <span className="badge badge-danger ml-2">verlopen</span>
                      ) : state === "verloopt_binnenkort" ? (
                        <span className="badge badge-warn ml-2">verloopt binnenkort</span>
                      ) : state === "geldig" ? (
                        <span className="badge badge-ok ml-2">geldig</span>
                      ) : null}
                    </td>
                    <td>
                      {document.url ? (
                        <a
                          className="btn btn-secondary"
                          href={document.url}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          Openen
                        </a>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                          Inzien kan zodra deze zorgprofessional een dienst bij je heeft gedaan
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="text-lg font-bold mb-3">Diensten bij {org.name}</h2>
      {!assignments || assignments.length === 0 ? (
        <div className="card p-5 mb-6">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Nog geen diensten bij jullie gedaan.
          </p>
        </div>
      ) : (
        <div className="card table-scroll mb-6" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
          <table className="table">
            <tbody>
              {assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <td className="tnum">
                    {assignment.shifts
                      ? formatShiftWindow(assignment.shifts.starts_at, assignment.shifts.ends_at)
                      : "—"}
                  </td>
                  <td>{qualificationLabel(assignment.shifts?.profession)}</td>
                  <td className="tnum">{formatEuros(assignment.agreed_rate_cents)} / uur</td>
                  <td>
                    {assignment.status === "completed" ? (
                      <span className="badge badge-ok">Afgerond</span>
                    ) : assignment.status === "cancelled" ? (
                      <span className="badge badge-danger">Geannuleerd</span>
                    ) : (
                      <span className="badge badge-brand">Gepland</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card p-5">
        <h2 className="font-bold mb-3">In jouw pool</h2>
        <div className="flex flex-wrap gap-2">
          <form action={setPoolStatusAction}>
            <input type="hidden" name="freelancer_id" value={id} />
            <input type="hidden" name="status" value={membership.status === "star" ? "member" : "star"} />
            <SubmitButton className="btn btn-secondary">
              {membership.status === "star" ? "Geen favoriet meer" : "Als favoriet markeren"}
            </SubmitButton>
          </form>
          {membership.status === "hidden" ? (
            <form action={setPoolStatusAction}>
              <input type="hidden" name="freelancer_id" value={id} />
              <input type="hidden" name="status" value="member" />
              <SubmitButton className="btn btn-secondary">
                Weer tonen
              </SubmitButton>
            </form>
          ) : (
            <form action={setPoolStatusAction}>
              <input type="hidden" name="freelancer_id" value={id} />
              <input type="hidden" name="status" value="hidden" />
              <SubmitButton className="btn btn-danger">
                Verbergen
              </SubmitButton>
            </form>
          )}
        </div>
        <p className="text-sm mt-3" style={{ color: "var(--text-muted)" }}>
          Verbergen geldt alleen voor {org.name}. Andere instellingen merken er niets van en het
          werk van deze zorgprofessional elders verandert niet.
        </p>
      </div>
    </div>
  );
}
