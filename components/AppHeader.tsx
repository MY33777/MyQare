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
      {/*
        Two rows on a phone, one on a tablet and up.

        All of it used to share a single 64px row: the wordmark, up to nine
        destinations, a balance and a sign-out button. At 375px that left the nav
        about eighty pixels of horizontally-scrolling strip, so a freelancer could
        see "Overzicht" and a sliver of the next word, and the balance she needs
        before accepting a shift was off the edge entirely.

        Giving the nav its own full-width row below costs 44 pixels of height and
        makes every destination reachable. No hamburger: a menu behind a tap is
        worse for six links than six links.
      */}
      <a className="skip-link" href="#inhoud">
        Naar de inhoud
      </a>

      <div className="mx-auto max-w-6xl px-4">
        <div className="h-16 flex items-center gap-4 sm:gap-6">
          <BrandLink className="text-lg font-bold" />

          <nav className="hidden sm:flex flex-1 items-center gap-1 overflow-x-auto">
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

          <div className="flex items-center gap-3 flex-none ml-auto sm:ml-0">
            {right}
            {/*
              A real hit target. This was a bare 14px text button in a 64px row —
              well under the 44px anybody's guidance asks for, and sitting right
              beside the balance, so a mistap signs you out instead of opening it.
            */}
            <form action={signOutAction}>
              <SubmitButton
                className="text-sm font-medium px-3 py-2 rounded-lg"
                style={{ color: "var(--text-muted)" }}
              >
                Uitloggen
              </SubmitButton>
            </form>
          </div>
        </div>

        <nav className="sm:hidden flex items-center gap-1 overflow-x-auto pb-2 -mx-1 px-1">
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
