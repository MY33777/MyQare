import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell, FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { safeNextPath } from "@/lib/nextPath";
import { signInAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Inloggen" };

export default async function LoginPage({
  searchParams,
}: {
  // Async in Next 16 — searchParams is a Promise and synchronous access was removed.
  searchParams: Promise<{ next?: string; error?: string; reset?: string }>;
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
          {/*
            ?next survives the trip.

            Somebody following a shift link while signed out lands here with
            ?next=/professional/aanbod/<id>. Both outbound links dropped it, so
            registering or resetting a password returned them to a generic
            dashboard with no memory of the shift they were trying to reach — the
            one thing they came for.
          */}
          Nog geen account?{" "}
          <Link href={next ? `/registreren?next=${encodeURIComponent(next)}` : "/registreren"}>
            Account aanmaken
          </Link>
        </>
      }
    >
      {params.reset ? (
        <FormMessage kind="ok">Je wachtwoord is aangepast. Log in met je nieuwe wachtwoord.</FormMessage>
      ) : null}
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
          <p className="hint">
            <Link
              href={
                next ? `/wachtwoord-vergeten?next=${encodeURIComponent(next)}` : "/wachtwoord-vergeten"
              }
            >
              Wachtwoord vergeten?
            </Link>
          </p>
        </div>

        <SubmitButton className="btn btn-primary w-full">
          Inloggen
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
