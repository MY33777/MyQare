import Link from "next/link";
import { BrandLink } from "@/components/Brand";
import { getSessionUser, sessionRole } from "@/lib/auth";

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

/*
 * Where each role's dashboard actually is. A single hardcoded "/professional"
 * sent a coordinator to the freelancer app, which then redirected them to
 * /geen-toegang — a signed-in facility clicking "naar mijn account" on our own
 * homepage was told they had no access.
 */
const HOME_FOR_ROLE: Record<string, string> = {
  facility_admin: "/zorginstelling",
  freelancer: "/professional",
  staff: "/beheer",
};

export async function PublicHeader() {
  const user = await getSessionUser();
  const role = await sessionRole(user?.id);
  const home = role ? (HOME_FOR_ROLE[role] ?? "/professional") : "/professional";

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
            <Link className="btn btn-primary" href={home}>
              Naar mijn account
            </Link>
          ) : (
            <>
              {/*
                Inloggen is NOT hidden on a phone any more.
                
                It was `hidden sm:inline-flex`, so below 640px the only button on
                the page was "Account aanmaken" — and somebody who already has an
                account, arriving on a phone from a link, was invited to make a
                second one. A duplicate account on this platform means a split
                dossier and an invoice series that starts again at 0001.

                Secondary styling keeps the hierarchy; both fit at 375px.
              */}
              <Link className="btn btn-secondary" href="/login">
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
