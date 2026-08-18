/**
 * Typography for the long text pages — privacy, terms, the model agreement.
 *
 * These pages are read by people looking for one specific answer ("what happens
 * to my BIG number", "how do I cancel"), not read straight through, so they need
 * headings that stand out at a glance and a measure narrow enough to scan.
 *
 * Styled here with a wrapper rather than @tailwindcss/typography: the whole
 * project uses CSS variables for colour so it can switch theme without a class
 * sweep, and the plugin's palette would have to be re-mapped anyway.
 */
export function Prose({ children }: { children: React.ReactNode }) {
  return <div className="prose-myqare max-w-none">{children}</div>;
}

/**
 * Banner for a document that is not yet legally settled.
 *
 * Blunt on purpose. A privacy statement or a set of terms carries real weight the
 * moment it is published — someone will rely on it — and the honest thing is to
 * say plainly, on the page itself, that these were drafted from how the software
 * actually behaves and still have to be checked by a lawyer. A quiet footnote
 * would let the page be mistaken for a finished one.
 */
export function DraftNotice({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg border p-4 text-sm mb-8"
      style={{
        borderColor: "var(--warn)",
        background: "var(--warn-subtle)",
        color: "var(--text)",
      }}
    >
      <strong className="block mb-1">Concept — nog niet juridisch vastgesteld</strong>
      {children}
    </div>
  );
}

/** Last-changed line. Dates are what make a legal document citable. */
export function LastUpdated({ date }: { date: string }) {
  return (
    <p className="text-sm mb-8" style={{ color: "var(--text-muted)" }}>
      Laatst bijgewerkt: {date}
    </p>
  );
}
