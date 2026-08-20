import Link from "next/link";
import { BrandLink } from "@/components/Brand";
import { signOutAction } from "@/app/login/actions";
import { SubmitButton } from "@/components/SubmitButton";

export type NavItem = { href: string; label: string };

export function AppHeader({
  nav,
  right,
}: {
  nav: NavItem[];
  /** Balance, verification badge — whatever this role needs at a glance. */
  right?: React.ReactNode;
}) {
  return (
    <header
      className="border-b sticky top-0 z-10"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-6">
        <BrandLink className="text-lg font-bold" />

        {/* Horizontal scroll rather than a hamburger: there are only a handful of
            destinations, and a coordinator on a tablet gets to them in one tap. */}
        <nav className="flex-1 flex items-center gap-1 overflow-x-auto">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap no-underline"
              style={{ color: "var(--text)" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3 flex-none">
          {right}
          <form action={signOutAction}>
            <SubmitButton className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
              Uitloggen
            </SubmitButton>
          </form>
        </div>
      </div>
    </header>
  );
}

/** Page heading plus optional action button, used on every inner page. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/** Consistent "nothing here yet" block, so empty states explain rather than just being blank. */
export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="card p-8 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
        {body}
      </p>
    </div>
  );
}
