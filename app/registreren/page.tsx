import Link from "next/link";
import type { Metadata } from "next";
import { FEE_PERCENT_LABEL } from "@/lib/fees";
import { AuthShell, FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { RoleFields } from "./RoleFields";
import { signUpAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { draftValue, draftValues, readFormDraft } from "@/lib/formDraft";

export const metadata: Metadata = { title: "Account aanmaken" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = authErrorMessage(params.error);

  /*
   * What was typed, but only while an error is showing — otherwise somebody
   * opening the page fresh on a shared ward workstation would find a stranger's
   * name and email address already in it.
   */
  const draft = await readFormDraft("signup", Boolean(params.error));

  return (
    <AuthShell
      title="Account aanmaken"
      subtitle="Kies waar je account voor is. Dit bepaalt wat je in MyQare ziet."
      footer={
        <>
          {/*
            /registreren is a sibling of app/(public), so PublicHeader and
            PublicFooter never wrap it — and AuthShell renders the brand as a
            span, not a link. So the funnel that collects a name, an email
            address and shortly a phone number and a KvK number presented no
            terms, no privacy statement, no price and no way back to the site.
            PublicFooter's own comment claims otherwise ("which is the signup
            form, which links here"), which is how it stayed unnoticed.
          */}
          <p className="mb-3">
            Aanmelden is gratis. Zorgprofessionals betalen {FEE_PERCENT_LABEL}% van de
            opdrachtwaarde plus btw wanneer ze een dienst aannemen — verder niets, en
            zorginstellingen betalen niets. <Link href="/tarieven">Bekijk de tarieven</Link>.
          </p>
          <p className="mb-3">
            Door een account aan te maken ga je akkoord met onze{" "}
            <Link href="/voorwaarden">voorwaarden</Link> en de{" "}
            <Link href="/privacy">privacyverklaring</Link>.
          </p>
          Heb je al een account? <Link href="/login">Inloggen</Link> · Terug naar{" "}
          <Link href="/">myqare.nl</Link>
        </>
      }
    >
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      <form action={signUpAction} className="space-y-4">
        {/* Role choice reveals the organisation field, so it needs client state. */}
        <RoleFields defaultRole={draftValue(draft, "role")} defaultOrgName={draftValue(draft, "org_name")} />

        <div>
          <label className="label" htmlFor="full_name">
            Volledige naam
          </label>
          <input
            className="input"
            id="full_name"
            name="full_name"
            defaultValue={draftValue(draft, "full_name") ?? ""}
            type="text"
            autoComplete="name"
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="email">
            E-mailadres
          </label>
          <input
            className="input"
            id="email"
            name="email"
            defaultValue={draftValue(draft, "email") ?? ""}
            type="email"
            autoComplete="email"
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            Wachtwoord
          </label>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <p className="hint">Minimaal 8 tekens.</p>
        </div>

        <div>
          <label className="label" htmlFor="password_confirm">
            Wachtwoord herhalen
          </label>
          <input
            className="input"
            id="password_confirm"
            name="password_confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>

        <SubmitButton className="btn btn-primary w-full">
          Account aanmaken
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
