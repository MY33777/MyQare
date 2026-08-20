import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell, FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { getRecoveryUser } from "@/lib/auth";
import { setNewPasswordAction } from "./actions";

export const metadata: Metadata = { title: "Nieuw wachtwoord" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  /*
   * A recovery session specifically — not just any session. /auth/callback has
   * exchanged the emailed code by the time this renders, and the token it
   * produced says so. Somebody who is merely signed in gets the same "this link
   * is not valid" answer as a stranger, because for this form they are one.
   *
   * Checked here as well as in the action so nobody types a password twice to be
   * told afterwards that it was never going to be accepted.
   */
  const user = await getRecoveryUser();

  return (
    <AuthShell
      title="Nieuw wachtwoord"
      subtitle={user ? `Voor ${user.email}` : undefined}
      footer={<Link href="/login">Terug naar inloggen</Link>}
    >
      {params.error ? <FormMessage kind="error">{authErrorMessage(params.error)}</FormMessage> : null}

      {!user ? (
        <>
          <FormMessage kind="error">
            Deze link is verlopen of al gebruikt.
          </FormMessage>
          <Link className="btn btn-primary w-full" href="/wachtwoord-vergeten">
            Nieuwe link aanvragen
          </Link>
        </>
      ) : (
        <form action={setNewPasswordAction} className="space-y-4">
          <div>
            <label className="label" htmlFor="password">
              Nieuw wachtwoord
            </label>
            <input
              className="input"
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              autoFocus
            />
            <p className="hint">Minimaal 8 tekens.</p>
          </div>

          <div>
            <label className="label" htmlFor="password_confirm">
              Herhaal wachtwoord
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

          <button className="btn btn-primary w-full" type="submit">
            Wachtwoord opslaan
          </button>
        </form>
      )}
    </AuthShell>
  );
}
