"use client";

/**
 * The boundary of last resort: a throw in the root layout itself.
 *
 * app/error.tsx renders INSIDE the root layout, so it cannot catch a failure in
 * that layout — the font loader, globals.css, anything above it. This one
 * replaces the whole document, which is why it has to render its own <html> and
 * <body> and cannot use any of the app's components or CSS variables: none of
 * them are guaranteed to have loaded.
 *
 * Hence the inline styles and the hardcoded royal blue. This file is the one
 * place in the product where duplicating a palette value is correct, because the
 * alternative is a white page with black Times New Roman on it.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="nl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
          color: "#111827",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          padding: "1.5rem",
        }}
      >
        <main style={{ maxWidth: "32rem" }}>
          <p style={{ color: "#2a4bd8", fontWeight: 700, letterSpacing: "0.05em" }}>MYQARE</p>
          <h1 style={{ fontSize: "1.875rem", margin: "0.5rem 0 1rem" }}>
            Er ging iets mis aan onze kant.
          </h1>
          <p style={{ color: "#4b5563", marginBottom: "1.5rem" }}>
            Dit ligt niet aan jou en er is niets kwijtgeraakt. Probeer het opnieuw.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#2a4bd8",
              color: "#ffffff",
              border: 0,
              borderRadius: "0.5rem",
              padding: "0.75rem 1.25rem",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Opnieuw proberen
          </button>
          {error.digest ? (
            <p style={{ color: "#6b7280", fontSize: "0.75rem", marginTop: "2rem" }}>
              Foutcode {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
