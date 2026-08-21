import type { Metadata } from "next";
import { lookupMessage } from "@/lib/authErrors";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { requireStaff } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { formatDateTime } from "@/lib/hours";
import {
  CAPABILITIES,
  CAPABILITY_DESCRIPTIONS,
  CAPABILITY_LABELS,
  DANGEROUS,
  isCapability,
  type Capability,
} from "@/lib/permissions";
import { appointAdminAction, removeAdminAction, setCapabilityAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Beheerders" };

const ERRORS: Record<string, string> = {
  missing_fields: "Vul een e-mailadres in.",
  account_not_found:
    "Geen account gevonden met dit e-mailadres. Diegene moet zich eerst normaal registreren.",
  already_admin: "Dit account is al beheerder.",
  is_facility_admin:
    "Dit account hoort bij een zorginstelling. Een instellingsbeheerder kan geen platformbeheerder worden — die twee rollen sluiten elkaar uit.",
  cannot_demote_self:
    "Je kunt je eigen recht om beheerders te benoemen niet intrekken. Laat een andere beheerder dat doen.",
  cannot_remove_self: "Je kunt jezelf niet verwijderen als beheerder.",
  nothing_changed:
    "Er is niets gewijzigd — een andere beheerder was je net voor. Ververs de pagina.",
  last_manager:
    "Dit is de laatste beheerder die andere beheerders kan benoemen. Zou je dit doorzetten, dan kan niemand nog rechten uitdelen — ook jij niet.",
  unknown: "Er ging iets mis. Probeer het opnieuw.",
};

type AdminRow = {
  id: string;
  full_name: string;
  created_at: string;
};

type AuditRow = {
  id: string;
  actor_name: string | null;
  subject_name: string | null;
  action: string;
  capability: string | null;
  note: string | null;
  created_at: string;
};

const ACTION_LABELS: Record<string, string> = {
  admin_appointed: "benoemd tot beheerder",
  admin_removed: "verwijderd als beheerder",
  capability_granted: "recht gekregen",
  capability_revoked: "recht ingetrokken",
  /*
   * Added by migration 020 and not here, so every staff cancellation rendered as
   * the raw string "assignment_cancelled" in a log meant to be read by a person
   * — on the one entry that records an admin moving money between two other
   * people's accounts.
   */
  assignment_cancelled: "dienst geannuleerd namens beide partijen",
};

export default async function AdminsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; appointed?: string; removed?: string; error?: string }>;
}) {
  const params = await searchParams;

  /*
   * Checked in the page, not only in the layout. A layout does not re-run when
   * Next renders this segment on its own, and everything below is read with the
   * service role — the same omission that made both other /beheer pages readable
   * by any signed-in account.
   */
  const me = await requireStaff("/beheer/beheerders", DANGEROUS);

  const admin = getSupabaseAdmin();

  const [{ data: admins }, { data: permissions }, { data: audit }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, created_at")
      .eq("role", "staff")
      .order("created_at", { ascending: true })
      .returns<AdminRow[]>(),
    admin
      .from("staff_permissions")
      .select("profile_id, capability")
      .returns<{ profile_id: string; capability: string }[]>(),
    admin
      .from("admin_audit_log")
      .select("id, actor_name, subject_name, action, capability, note, created_at")
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<AuditRow[]>(),
  ]);

  const held = new Map<string, Set<Capability>>();
  for (const row of permissions ?? []) {
    if (!isCapability(row.capability)) continue;
    if (!held.has(row.profile_id)) held.set(row.profile_id, new Set());
    held.get(row.profile_id)!.add(row.capability);
  }

  return (
    <>
      <PageHeader
        title="Beheerders"
        description="Wie beheerder is, en wat elk van hen mag. Elke wijziging wordt vastgelegd."
      />

      {params.saved ? <FormMessage kind="ok">Rechten bijgewerkt.</FormMessage> : null}
      {params.appointed ? (
        <FormMessage kind="ok">
          Benoemd tot beheerder. Diegene heeft nog geen rechten — geef hieronder aan wat hij of zij
          mag doen.
        </FormMessage>
      ) : null}
      {params.removed ? <FormMessage kind="ok">Beheerder verwijderd.</FormMessage> : null}
      {params.error ? (
        <FormMessage kind="error">{lookupMessage(ERRORS, params.error, ERRORS.unknown)}</FormMessage>
      ) : null}

      <div className="card p-6 mb-8">
        <h2 className="font-bold mb-1">Beheerder toevoegen</h2>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          Het account moet al bestaan — laat diegene zich eerst gewoon registreren. Een nieuwe
          beheerder begint zonder rechten; die geef je hieronder één voor één.
        </p>
        <form action={appointAdminAction} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-64">
            <label className="label" htmlFor="email">
              E-mailadres
            </label>
            <input className="input" id="email" name="email" type="email" required />
          </div>
          <SubmitButton className="btn btn-primary">
            Benoemen
          </SubmitButton>
        </form>
      </div>

      <h2 className="text-lg font-bold mb-3">Huidige beheerders</h2>

      {!admins || admins.length === 0 ? (
        <EmptyState
          title="Geen beheerders"
          body="Dat zou niet moeten kunnen — je kijkt er zelf naar. Zie SETUP.md voor het aanmaken van de eerste beheerder."
        />
      ) : (
        <div className="grid gap-4 mb-8">
          {admins.map((person) => {
            const theirs = held.get(person.id) ?? new Set<Capability>();
            const isMe = person.id === me.userId;

            return (
              <div key={person.id} className="card p-5">
                <div className="flex flex-wrap justify-between gap-3 mb-4">
                  <div>
                    <p className="font-bold">
                      {person.full_name || "—"}
                      {isMe ? (
                        <span className="badge badge-neutral ml-2">jij</span>
                      ) : null}
                    </p>
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                      Account sinds {formatDateTime(person.created_at)} ·{" "}
                      {theirs.size === 0
                        ? "geen rechten"
                        : `${theirs.size} van ${CAPABILITIES.length} rechten`}
                    </p>
                  </div>

                  {!isMe ? (
                    /*
                      A second click, and a sentence saying what it does.

                      Removing an admin was one tap on a red button next to their
                      name — no confirmation, no statement of consequence, and no
                      undo anywhere in the product: putting somebody back means
                      appointing them again and re-granting every capability by
                      hand. The <details> pattern is already used for cancelling
                      an assignment, which is a smaller act than this one.

                      Deliberately not a confirmation on every action. A dialog in
                      front of something harmless is what teaches people to click
                      through the one that matters.
                    */
                    <details>
                      <summary className="cursor-pointer text-sm font-semibold" style={{ color: "var(--danger)" }}>
                        Verwijderen als beheerder
                      </summary>
                      <p className="text-sm mt-2 mb-3" style={{ color: "var(--text-muted)" }}>
                        {person.full_name} verliest direct alle toegang tot /beheer en al hun
                        rechten worden ingetrokken. Terugdraaien betekent opnieuw benoemen en elk
                        recht opnieuw toekennen. Het account zelf blijft bestaan.
                      </p>
                      <form action={removeAdminAction}>
                        <input type="hidden" name="profile_id" value={person.id} />
                        <SubmitButton className="btn btn-danger">
                          Ja, verwijderen als beheerder
                        </SubmitButton>
                      </form>
                    </details>
                  ) : null}
                </div>

                <div className="grid gap-3">
                  {CAPABILITIES.map((capability) => {
                    const has = theirs.has(capability);
                    const dangerous = capability === DANGEROUS;

                    return (
                      <div
                        key={capability}
                        className="flex flex-wrap gap-3 items-start justify-between rounded-lg p-3"
                        style={{
                          background: dangerous ? "var(--warn-subtle)" : "var(--bg)",
                          border: `1px solid ${dangerous ? "var(--warn)" : "var(--border)"}`,
                        }}
                      >
                        <div className="flex-1 min-w-64">
                          <p className="font-medium">
                            {CAPABILITY_LABELS[capability]}
                            {dangerous ? (
                              <span className="badge badge-warn ml-2">ingrijpend</span>
                            ) : null}
                          </p>
                          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                            {CAPABILITY_DESCRIPTIONS[capability]}
                          </p>
                        </div>

                        {/*
                          Granting the dangerous one costs a second click.

                          manage_admins is not a bigger version of the others — it
                          is the one that grants every other capability, including
                          itself, to anybody. Handing it out is therefore a larger
                          decision than handing out all four of the rest, and it
                          was the same single tap as "mag documenten bekijken".

                          Only on GRANTING, and only for that one. Revoking is
                          already guarded against leaving nobody able to appoint,
                          and a confirmation in front of the harmless toggles is
                          what teaches people to click through this one.
                        */}
                        {dangerous && !has ? (
                          <details>
                            <summary className="cursor-pointer text-sm font-semibold">
                              Geven
                            </summary>
                            <p
                              className="text-sm mt-2 mb-3 max-w-md"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {person.full_name} kan hiermee zichzelf en anderen elk recht geven,
                              beheerders verwijderen, en dit recht doorgeven. Je kunt het daarna
                              alleen nog intrekken zolang er iemand anders is die het óók heeft.
                            </p>
                            <form action={setCapabilityAction}>
                              <input type="hidden" name="profile_id" value={person.id} />
                              <input type="hidden" name="capability" value={capability} />
                              <input type="hidden" name="grant" value="true" />
                              <SubmitButton className="btn btn-primary">
                                Ja, dit recht geven
                              </SubmitButton>
                            </form>
                          </details>
                        ) : (
                          <form action={setCapabilityAction}>
                            <input type="hidden" name="profile_id" value={person.id} />
                            <input type="hidden" name="capability" value={capability} />
                            <input type="hidden" name="grant" value={has ? "false" : "true"} />
                            <SubmitButton className={has ? "btn btn-secondary" : "btn btn-primary"}>
                              {has ? "Intrekken" : "Geven"}
                            </SubmitButton>
                          </form>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="text-lg font-bold mb-1">Wijzigingen</h2>
      <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
        Beheerdersrechten zijn het enige waarmee iemand elk ander record kan wijzigen, dus elke
        wijziging staat hier. Namen worden vastgelegd op het moment zelf, zodat de regel leesbaar
        blijft als een account later wordt verwijderd.
      </p>

      {!audit || audit.length === 0 ? (
        <EmptyState title="Nog niets" body="Wijzigingen aan beheerders verschijnen hier." />
      ) : (
        <div className="card table-scroll" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
          <table className="table">
            <thead>
              <tr>
                <th>Wanneer</th>
                <th>Wie</th>
                <th>Wat</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((row) => (
                <tr key={row.id}>
                  <td className="tnum">{formatDateTime(row.created_at)}</td>
                  <td>{row.actor_name ?? "systeem"}</td>
                  <td>
                    <strong>{row.subject_name ?? "—"}</strong>{" "}
                    {ACTION_LABELS[row.action] ?? row.action}
                    {row.capability && isCapability(row.capability)
                      ? `: ${CAPABILITY_LABELS[row.capability]}`
                      : ""}
                    {row.note ? (
                      <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                        {row.note}
                      </span>
                    ) : null}
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
