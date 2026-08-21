import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell, FormMessage } from "@/components/AuthShell";
import { SubmitButton } from "@/components/SubmitButton";
import { authErrorMessage } from "@/lib/authErrors";
import { resendConfirmationAction } from "../actions";

export const metadata: Metadata = { title: "Bevestig je e-mailadres" };

/**
 * The screen somebody lands on after registering, and then sits on.
 *
 * It had no controls at all: no way to ask for another mail, no way back to
 * login, not even a link to the homepage. So the two things that actually happen
 * here — the mail lands in spam, or it never arrives — both ended with the
 * person closing the tab, and a registration is not worth much after that.
 *
 * It also no longer claims the link is valid for 24 hours. Supabase's default is
 * one hour, and telling somebody they have a day when they have sixty minutes is
 * the sort of small lie that turns into "MyQare's links do not work".
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; sent?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthShell
      title="Check je e-mail"
      subtitle={
        params.email
          ? `We hebben een link gestuurd naar ${params.email}.`
          : "We hebben je een link gestuurd om je e-mailadres te bevestigen."
      }
      footer={
        <>
          Al bevestigd? <Link href="/login">Inloggen</Link>
        </>
      }
    >
      {params.sent ? (
        <FormMessage kind="ok">
          Er is een nieuwe link onderweg. De vorige werkt daarmee niet meer.
        </FormMessage>
      ) : null}
      {params.error ? <FormMessage kind="error">{authErrorMessage(params.error)}</FormMessage> : null}

      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Klik op de link in die e-mail om je account te activeren. Daarna vragen we je nog een paar
        gegevens en kun je aan de slag.
      </p>

      <p className="text-sm mt-4" style={{ color: "var(--text-muted)" }}>
        Niets ontvangen? Kijk eerst in je spam-map — bij een zorginstelling houdt de mailfilter hem
        soms tegen. De link is een uur geldig.
      </p>

      {/*
        Open the link on the device you are reading this on, if you can.

        The callback accepts both link shapes, but a PKCE `code` needs the browser
        that ASKED for it — request on a laptop, open on a phone, and it fails
        while the link is perfectly good. Saying so here costs one sentence and
        saves the support mail. See app/auth/callback/route.ts and SETUP.md.
      */}
      <p className="text-sm mt-4" style={{ color: "var(--text-muted)" }}>
        Open de link het liefst in dezelfde browser als waarin je je hebt aangemeld.
      </p>

      <form action={resendConfirmationAction} className="mt-6 space-y-3">
        {/*
          The address is asked for again rather than trusted from the query
          string. Somebody can arrive here with any ?email= they like, and a
          resend endpoint that mails whatever the URL says is a way to send mail
          from our domain to a stranger.
        */}
        <div>
          <label className="label" htmlFor="email">
            Geen mail gekregen? Vul je e-mailadres in
          </label>
          <input
            className="input"
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            defaultValue={params.email ?? ""}
            required
          />
        </div>

        <SubmitButton className="btn btn-secondary w-full" pending="Versturen…">
          Stuur de link opnieuw
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
