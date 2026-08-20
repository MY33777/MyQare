import type { Metadata } from "next";
import { PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { requireFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/hours";
import { updateOrganisationAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Instellingen" };

export default async function OrganisationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { org } = await requireFacilityAdmin("/zorginstelling/instellingen");
  const params = await searchParams;
  const supabase = await createClient();

  const { data: full } = await supabase
    .from("organisations")
    .select("address_line, postcode, city")
    .eq("id", org.id)
    .maybeSingle<{ address_line: string | null; postcode: string | null; city: string | null }>();

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Instellingen"
        description="Deze gegevens staan op elke factuur die je van zorgprofessionals ontvangt."
      />

      {params.saved ? <FormMessage kind="ok">Opgeslagen.</FormMessage> : null}
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
