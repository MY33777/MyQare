import Link from "next/link";
import { BrandLink } from "@/components/Brand";
import { getSessionUser } from "@/lib/auth";

/**
 * Header for the pages anyone can see without signing in.
 *
 * Separate from AppHeader on purpose. That one is a working toolbar for someone
 * already inside the product; this one has a different job — to let a stranger
 * find out what this is, what it costs, and who is behind it, which are the three
 * things a facility's coordinator checks before creating an account.
 *
 * Renders a route back into the app for signed-in visitors rather than a signup
 * button they have already used.
 */

const LINKS = [
  { href: "/hoe-het-werkt", label: "Hoe het werkt" },
  { href: "/voor-zorginstellingen", label: "Zorginstellingen" },
  { href: "/voor-zorgprofessionals", label: "Zorgprofessionals" },
  { href: "/tarieven", label: "Tarieven" },
];

export async function PublicHeader() {
  const user = await getSessionUser();

  return (
    <header
      className="border-b sticky top-0 z-20"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between gap-4">
        <BrandLink className="text-lg flex-none" />

        {/*
         * Hidden below `md` rather than folded into a burger menu. A menu is a
         * component with state, a focus trap and a close-on-navigate bug waiting
         * to happen; the same links sit in the footer, one scroll away, and cost
         * nothing to maintain.
         */}
        <nav className="hidden md:flex items-center gap-6 text-sm">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="no-underline hover:underline"
              style={{ color: "var(--text-muted)" }}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 flex-none">
          {user ? (
            <Link className="btn btn-primary" href="/professional">
              Naar mijn account
            </Link>
          ) : (
            <>
              <Link className="btn btn-secondary hidden sm:inline-flex" href="/login">
                Inloggen
              </Link>
              <Link className="btn btn-primary" href="/registreren">
                Account aanmaken
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
