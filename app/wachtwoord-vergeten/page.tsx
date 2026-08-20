import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell, FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { requestPasswordResetAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Wachtwoord vergeten" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthShell
      title="Wachtwoord vergeten"
      subtitle="We sturen je een link om een nieuw wachtwoord in te stellen."
      footer={<Link href="/login">Terug naar inloggen</Link>}
    >
      {params.error ? <FormMessage kind="error">{authErrorMessage(params.error)}</FormMessage> : null}

      {params.sent ? (
        <FormMessage kind="ok">
          Als er een account bij dit e-mailadres hoort, is de link onderweg. Kijk ook in je
          spam-map.
        </FormMessage>
      ) : (
        <form action={requestPasswordResetAction} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">
              E-mailadres
            </label>
            <input
              className="input"
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
            />
          </div>

          <SubmitButton className="btn btn-primary w-full">
            Stuur de link
          </SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
