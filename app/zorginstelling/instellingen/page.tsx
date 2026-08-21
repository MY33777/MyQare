import type { Metadata } from "next";
import { PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { requireFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/hours";
import {
  inviteColleagueAction,
  revokeInviteAction,
  updateOrganisationAction,
} from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Instellingen" };

export default async function OrganisationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; invited?: string; revoked?: string }>;
}) {
  const { org } = await requireFacilityAdmin("/zorginstelling/instellingen");
  const params = await searchParams;
  const supabase = await createClient();

  /*
   * Who else works here, and who has been invited and not yet joined.
   *
   * A facility is one organisation, and until migration 024 the second
   * coordinator founded a duplicate instead of joining — separate pool,
   * separate shifts, two invoice series, half a dossier each. This is the screen
   * where that is prevented, so it has to show the current state of it.
   */
  const [{ data: colleagues }, { data: invites }, { data: full }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", org.id)
      .eq("role", "facility_admin")
      .order("created_at", { ascending: true })
      .returns<{ id: string; full_name: string }[]>(),
    supabase
      .from("organisation_invites")
      .select("id, email, invited_by_name, created_at")
      .eq("org_id", org.id)
      .is("accepted_at", null)
      .order("created_at", { ascending: false })
      .returns<{ id: string; email: string; invited_by_name: string | null; created_at: string }[]>(),
    supabase
    .from("organisations")
    .select("address_line, postcode, city")
    .eq("id", org.id)
    .maybeSingle<{ address_line: string | null; postcode: string | null; city: string | null }>(),
  ]);

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Instellingen"
        description="Deze gegevens staan op elke factuur die je van zorgprofessionals ontvangt."
      />

      {params.saved ? <FormMessage kind="ok">Opgeslagen.</FormMessage> : null}
      {params.invited === "1" ? (
        <FormMessage kind="ok">
          Uitnodiging verstuurd. Je collega komt bij deze instelling terecht zodra ze zich met dat
          e-mailadres aanmeldt.
        </FormMessage>
      ) : null}
      {params.invited === "nomail" ? (
        /*
          The invite exists either way — it is claimed on the address, not on a
          link — so a mail provider having a bad afternoon must not lose it. Said
          plainly, because the coordinator is the only one who can pass it on.
        */
        <FormMessage kind="warn">
          De uitnodiging staat klaar, maar de e-mail kon niet worden verstuurd. Vraag je collega
          zich aan te melden met dat adres, dan komt ze automatisch hier terecht.
        </FormMessage>
      ) : null}
      {params.revoked ? <FormMessage kind="ok">Uitnodiging ingetrokken.</FormMessage> : null}
      {params.error ? <FormMessage kind="error">{authErrorMessage(params.error)}</FormMessage> : null}

      {!org.billing_email ? (
        <div
          className="card p-4 mb-6"
          style={{ borderColor: "var(--warn)", background: "var(--warn-subtle)" }}
        >
          <p className="font-semibold" style={{ color: "var(--warn)" }}>
            Geen factuuradres ingesteld
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--warn)" }}>
            Zonder factuur-e-mailadres kunnen we facturen niet bij je administratie afleveren.
          </p>
        </div>
      ) : null}

      <form action={updateOrganisationAction} className="card p-6 space-y-5">
        <div>
          <label className="label" htmlFor="name">
            Naam zorginstelling
          </label>
          <input className="input" id="name" name="name" type="text" defaultValue={org.name} required />
        </div>

        <div>
          <label className="label" htmlFor="billing_email">
            Factuur-e-mailadres
          </label>
          <input
            className="input"
            id="billing_email"
            name="billing_email"
            type="email"
            defaultValue={org.billing_email ?? ""}
          />
          <p className="hint">
            Meestal een gedeelde crediteuren-mailbox, niet je eigen adres. Facturen die in een
            persoonlijke inbox belanden worden laat betaald.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="address_line">
            Adres
          </label>
          <input
            className="input"
            id="address_line"
            name="address_line"
            type="text"
            defaultValue={full?.address_line ?? ""}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="postcode">
              Postcode
            </label>
            <input
              className="input"
              id="postcode"
              name="postcode"
              type="text"
              defaultValue={full?.postcode ?? ""}
            />
          </div>
          <div>
            <label className="label" htmlFor="city">
              Plaats
            </label>
            <input className="input" id="city" name="city" type="text" defaultValue={full?.city ?? ""} />
          </div>
        </div>

        <SubmitButton className="btn btn-primary">
          Opslaan
        </SubmitButton>
      </form>

      <div className="card p-6 mt-6">
        <h2 className="font-bold mb-1">Collega&apos;s</h2>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          Nodig hier iedereen uit die diensten plaatst of uren goedkeurt. Meldt een collega zich op
          eigen houtje aan, dan maakt ze een tweede instelling aan die jullie pool, diensten,
          facturen en dossier niet deelt — en dat is achteraf niet meer samen te voegen.
        </p>

        <ul className="text-sm mb-4">
          {(colleagues ?? []).map((person) => (
            <li key={person.id} className="py-1">
              {person.full_name || "—"}
            </li>
          ))}
        </ul>

        {(invites ?? []).length > 0 ? (
          <div className="mb-4">
            <p className="text-sm font-semibold mb-2">Uitgenodigd, nog niet aangemeld</p>
            <ul className="text-sm">
              {(invites ?? []).map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
                  <span style={{ color: "var(--text-muted)" }}>{invite.email}</span>
                  <form action={revokeInviteAction}>
                    <input type="hidden" name="invite_id" value={invite.id} />
                    <SubmitButton className="btn btn-secondary">Intrekken</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <form action={inviteColleagueAction} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-64">
            <label className="label" htmlFor="invite_email">
              E-mailadres van je collega
            </label>
            <input
              className="input"
              id="invite_email"
              name="email"
              type="email"
              autoComplete="off"
              required
            />
          </div>
          <SubmitButton className="btn btn-primary">Uitnodigen</SubmitButton>
        </form>
      </div>

      <div className="card p-6 mt-6">
        <h2 className="font-bold mb-3">Verificatie</h2>
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <dt style={{ color: "var(--text-muted)" }}>KvK-nummer</dt>
            <dd className="font-semibold tnum">{org.kvk ?? "—"}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--text-muted)" }}>Status</dt>
            <dd>
              {org.verified_at ? (
                <span className="badge badge-ok">Geverifieerd {formatDate(org.verified_at)}</span>
              ) : (
                <span className="badge badge-warn">In behandeling</span>
              )}
            </dd>
          </div>
        </dl>
        {/*
          KvK is read-only on purpose. It is the number a human actually checked to
          grant verification, so making it editable would leave the facility
          verified against something nobody looked at.
        */}
        <p className="text-sm mt-4" style={{ color: "var(--text-muted)" }}>
          Klopt je KvK-nummer niet? Neem contact met ons op — we controleren het opnieuw. Je kunt het
          niet zelf wijzigen, omdat je verificatie eraan hangt.
        </p>
      </div>
    </div>
  );
}
