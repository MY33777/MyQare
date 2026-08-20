"use client";

import Link from "next/link";
import { BrandLink } from "@/components/Brand";

/**
 * What a person sees when a page throws.
 *
 * There was no error boundary anywhere in the app, so any failure — a Supabase
 * outage, a malformed row, a bug — dropped the user on Next.js's own error page:
 * English, unbranded, and in production a bare "Application error: a client-side
 * exception has occurred". A nurse at 22:45 has no way to tell that from "MyQare
 * is gone and my shift with it".
 *
 * Deliberately says almost nothing about the cause. `error.message` in a
 * production build is a digest, not a sentence, and the ones that are readable
 * tend to be provider strings that leak internals. What the reader needs is
 * whether it was them, whether it will pass, and what to do now.
 *
 * A boundary is a Client Component by definition — it has to catch a render on
 * the client — which is why this one file has "use client" and its neighbours
 * do not.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      <header className="border-b" style={{ borderColor: "var(--border)" }}>
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center">
          <BrandLink className="text-lg" />
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-2xl px-4 py-24">
        <h1 className="text-3xl font-bold mb-4">Er ging iets mis aan onze kant.</h1>
        <p className="mb-6" style={{ color: "var(--text-muted)" }}>
          Dit ligt niet aan jou en er is niets kwijtgeraakt. Probeer het opnieuw — lukt dat niet,
          dan is er waarschijnlijk een storing en zijn we er al mee bezig.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button className="btn btn-primary" type="button" onClick={reset}>
            Opnieuw proberen
          </button>
          <Link className="btn btn-secondary" href="/">
            Naar de startpagina
          </Link>
        </div>

        {/*
          The digest, quietly. It is the only thing that ties what this person saw
          to a line in our logs, and asking somebody on the phone to read out a
          short hash is far better than asking them what the screen said.
        */}
        {error.digest ? (
          <p className="text-xs mt-8" style={{ color: "var(--text-muted)" }}>
            Foutcode <span className="tnum">{error.digest}</span> — noem deze als je contact opneemt.
          </p>
        ) : null}
      </main>
    </>
  );
}
