import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell, FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { safeNextPath } from "@/lib/nextPath";
import { signInAction } from "./actions";

export const metadata: Metadata = { title: "Inloggen" };

export default async function LoginPage({
  searchParams,
}: {
  // Async in Next 16 — searchParams is a Promise and synchronous access was removed.
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const error = authErrorMessage(params.error);
  const next = safeNextPath(params.next) ?? "/";

  return (
    <AuthShell
      title="Inloggen"
      subtitle="Voor zorginstellingen en zelfstandige zorgprofessionals."
      footer={
        <>
          Nog geen account? <Link href="/registreren">Account aanmaken</Link>
        </>
      }
    >
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      <form action={signInAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />

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

        <div>
          <label className="label" htmlFor="password">
            Wachtwoord
          </label>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        <button className="btn btn-primary w-full" type="submit">
          Inloggen
        </button>
      </form>
    </AuthShell>
  );
}
