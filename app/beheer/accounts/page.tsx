import type { Metadata } from "next";
import { PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { SubmitButton } from "@/components/SubmitButton";
import { authErrorMessage } from "@/lib/authErrors";
import { requireStaff } from "@/lib/auth";
import { anonymiseAccountAction } from "./actions";

export const metadata: Metadata = { title: "Accounts" };

/**
 * Where a deletion request is honoured.
 *
 * Its own page rather than a card on /beheer, because the two verification
 * queues there are day-to-day work and this is not: it is irreversible, it
 * removes somebody's certificate of conduct from storage, and it should not sit
 * one mis-click away from "Gevonden in register".
 */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const params = await searchParams;

  // Redirects to /geen-toegang on its own without the capability.
  await requireStaff("/beheer/accounts", "anonymise_accounts");

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Account anonimiseren"
        description="Voor een verwijderverzoek. Onomkeerbaar, en alleen te doen op het e-mailadres waarmee het verzoek is gedaan."
      />

      {params.done ? (
        <FormMessage kind="ok">
          Account geanonimiseerd. Documenten en contactgegevens zijn verwijderd; facturen en
          dossierrecords blijven bewaard zoals de wet vraagt.
        </FormMessage>
      ) : null}
      {params.error ? (
        <FormMessage kind="error">{authErrorMessage(params.error)}</FormMessage>
      ) : null}

      <div className="card p-6">
        <h2 className="font-bold mb-2">Wat er gebeurt</h2>
        <ul className="text-sm space-y-1 mb-5" style={{ color: "var(--text-muted)" }}>
          <li>
            <strong style={{ color: "var(--text)" }}>Weg:</strong> alle documenten (ook uit de
            opslag), telefoonnummer, adres en IBAN, beschikbaarheid, poollidmaatschappen,
            factuurinstellingen, en aanbiedingen die nooit zijn aangenomen.
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>Blijft:</strong> facturen, opdrachten en
            dossierrecords, met de gegevens zoals ze destijds zijn vastgelegd. Een Nederlandse
            factuur moet zeven jaar bewaard blijven (art. 52 AWR) en het dossier is waar een
            instelling zich onder de Wkkgz op beroept.
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>De naam</strong> wordt overal vervangen door
            &quot;Verwijderd account&quot;. Het e-mailadres wordt losgekoppeld en komt weer vrij
            voor een nieuwe registratie; inloggen op het oude account kan daarna niet meer.
          </li>
        </ul>

        {/*
          Behind a disclosure, and typed rather than picked from a list.

          There is no way back from this, and a list of accounts to click would
          make the wrong one a mis-tap away. Typing the address the request came
          from is the same check the requester's mailbox already performed.
        */}
        <details>
          <summary className="cursor-pointer font-semibold" style={{ color: "var(--danger)" }}>
            Een account anonimiseren
          </summary>

          <form action={anonymiseAccountAction} className="mt-4 space-y-3">
            <div>
              <label className="label" htmlFor="email">
                E-mailadres waarmee het verzoek is gedaan
              </label>
              <input
                className="input"
                id="email"
                name="email"
                type="email"
                autoComplete="off"
                required
              />
              <p className="hint">
                Controleer eerst of het verzoek van dit adres kwam. Beheerdersaccounts worden
                geweigerd — verwijder die eerst als beheerder.
              </p>
            </div>

            <SubmitButton className="btn btn-danger" pending="Bezig…">
              Ja, dit account anonimiseren
            </SubmitButton>
          </form>
        </details>
      </div>
    </div>
  );
}
