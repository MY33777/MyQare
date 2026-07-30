import { Brand } from "@/components/Brand";

/** Centred card used by login, registration and onboarding. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <Brand className="text-2xl" />
        </div>
        <div className="card p-6 sm:p-8">
          <h1 className="text-xl font-bold mb-1">{title}</h1>
          {subtitle ? (
            <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
              {subtitle}
            </p>
          ) : (
            <div className="mb-6" />
          )}
          {children}
        </div>
        {footer ? (
          <div className="text-center mt-5 text-sm" style={{ color: "var(--text-muted)" }}>
            {footer}
          </div>
        ) : null}
      </div>
    </main>
  );
}

/**
 * Error and notice banners.
 *
 * Messages are looked up from a code in the query string rather than passed as
 * free text, so a crafted `?error=` cannot render arbitrary content into the
 * page — an unknown code falls back to a generic message.
 */
export function FormMessage({ kind, children }: { kind: "error" | "ok"; children: React.ReactNode }) {
  const isError = kind === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      className="mb-4 rounded-lg px-3 py-2 text-sm"
      style={{
        background: isError ? "var(--danger-subtle)" : "var(--ok-subtle)",
        color: isError ? "var(--danger)" : "var(--ok)",
      }}
    >
      {children}
    </div>
  );
}
