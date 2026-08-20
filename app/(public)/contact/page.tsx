import type { Metadata } from "next";
import { lookupMessage } from "@/lib/authErrors";
import Link from "next/link";
import { submitContactAction } from "./actions";
import { contactInbox } from "@/lib/email";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = {
  title: "Contact",
  description: "Vragen, meedenken of meekijken met MyQare? Stuur een bericht.",
};

const ERRORS: Record<string, string> = {
  missing_fields: "Vul je naam, e-mailadres en bericht in.",
  bad_email: "Dat e-mailadres klopt niet.",
  too_long: "Je bericht is te lang. Houd het onder de 5.000 tekens.",
  rate_limited: "Je hebt net al een paar berichten gestuurd. Probeer het over een uur opnieuw.",
  not_configured:
    "Het contactformulier is nog niet aangesloten op een postbus, dus je bericht is niet verstuurd. Dat is een gebrek aan onze kant, niet aan die van jou.",
  send_failed: "Versturen is niet gelukt. Probeer het later nog eens.",
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error ? lookupMessage(ERRORS, params.error, ERRORS.send_failed) : null;
  const configured = Boolean(contactInbox());

  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl sm:text-4xl font-bold mb-3">Contact</h1>
      <p className="text-lg mb-10" style={{ color: "var(--text-muted)" }}>
        MyQare is in aanbouw. Vragen, kritiek of interesse om mee te kijken zijn allemaal welkom —
        het bepaalt wat er als volgende gebouwd wordt.
      </p>

      {params.sent ? (
        <div
          className="rounded-lg border p-4 mb-8"
          style={{ borderColor: "var(--ok)", background: "var(--ok-subtle)" }}
        >
          <strong className="block mb-1">Bericht verstuurd</strong>
          Bedankt. Je krijgt antwoord op het adres dat je opgaf.
        </div>
      ) : null}

      {error ? (
        <div
          className="rounded-lg border p-4 mb-8"
          style={{ borderColor: "var(--danger)", background: "var(--danger-subtle)" }}
        >
          {error}
        </div>
      ) : null}

      {/*
       * Says so up front when the form cannot deliver, instead of letting someone
       * write a long message and find out afterwards.
       */}
      {!configured ? (
        <div
          className="rounded-lg border p-4 mb-8 text-sm"
          style={{ borderColor: "var(--warn)", background: "var(--warn-subtle)" }}
        >
          <strong className="block mb-1">Het formulier is nog niet aangesloten</strong>
          Er is nog geen postbus ingesteld, dus een bericht komt op dit moment nergens aan. Dat
          staat hier omdat je het moet weten vóórdat je iets typt, niet erna.
        </div>
      ) : null}

      <form action={submitContactAction} className="card p-6 grid gap-4 mb-12">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Naam</span>
            <input className="input" name="name" required maxLength={120} autoComplete="name" />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">E-mailadres</span>
            <input
              className="input"
              name="email"
              type="email"
              required
              maxLength={200}
              autoComplete="email"
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">
              Organisatie <span style={{ color: "var(--text-muted)" }}>(optioneel)</span>
            </span>
            <input className="input" name="organisation" maxLength={160} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Ik ben</span>
            <select className="input" name="role" defaultValue="zorginstelling">
              <option value="zorginstelling">een zorginstelling</option>
              <option value="zorgprofessional">een zorgprofessional</option>
              <option value="anders">iets anders</option>
            </select>
          </label>
        </div>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Bericht</span>
          <textarea className="input" name="message" required rows={7} maxLength={5000} />
        </label>

        {/* Honeypot. Hidden from people, irresistible to bots. */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="hidden"
        />

        <div className="flex items-center gap-4 flex-wrap">
          <SubmitButton className="btn btn-primary">
            Versturen
          </SubmitButton>
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            We gebruiken je gegevens alleen om te antwoorden. Zie de{" "}
            <Link href="/privacy">privacyverklaring</Link>.
          </span>
        </div>
      </form>

      <section>
        <h2 className="text-xl font-bold mb-3">Bedrijfsgegevens</h2>
        <p className="max-w-2xl mb-3" style={{ color: "var(--text-muted)" }}>
          Er staan hier nog geen KvK-nummer, btw-nummer of vestigingsadres. Die zijn wettelijk
          verplicht op een commerciële site zodra er daadwerkelijk diensten worden aangeboden — en
          ze staan er nog niet omdat de rechtspersoon achter MyQare nog niet is ingericht.
        </p>
        <p className="max-w-2xl text-sm" style={{ color: "var(--text-muted)" }}>
          Een plaatsvervangend nummer neerzetten zou het probleem verbergen in plaats van oplossen.
          Zodra de inschrijving rond is, staat het hier.
        </p>
      </section>
    </div>
  );
}
