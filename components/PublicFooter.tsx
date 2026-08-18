import Link from "next/link";
import { Brand } from "@/components/Brand";

/**
 * Footer for the public pages.
 *
 * Carries the legal links because that is where people look for them, and because
 * a privacy statement that exists but cannot be found from every page is not
 * really published. The AVG expects the information to be reachable at the moment
 * data is collected — which is the signup form, which links here.
 */

const COLUMNS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { href: "/hoe-het-werkt", label: "Hoe het werkt" },
      { href: "/voor-zorginstellingen", label: "Voor zorginstellingen" },
      { href: "/voor-zorgprofessionals", label: "Voor zorgprofessionals" },
      { href: "/tarieven", label: "Tarieven" },
      { href: "/veelgestelde-vragen", label: "Veelgestelde vragen" },
    ],
  },
  {
    heading: "MyQare",
    links: [
      { href: "/over-ons", label: "Over ons" },
      { href: "/contact", label: "Contact" },
      { href: "/registreren", label: "Account aanmaken" },
      { href: "/login", label: "Inloggen" },
    ],
  },
  {
    heading: "Juridisch",
    links: [
      { href: "/privacy", label: "Privacyverklaring" },
      { href: "/voorwaarden", label: "Algemene voorwaarden" },
      { href: "/modelovereenkomst", label: "Modelovereenkomst" },
    ],
  },
];

export function PublicFooter() {
  return (
    <footer
      className="border-t mt-auto"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
          <div>
            <Brand className="text-lg" />
            <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
              Zelfstandige zorgprofessionals inhuren, met een dossier dat de vraag beantwoordt
              voordat die gesteld wordt.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <h2 className="text-sm font-bold mb-3">{column.heading}</h2>
              <ul className="space-y-2 text-sm">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="no-underline hover:underline"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          className="mt-10 pt-6 border-t text-sm flex flex-wrap gap-x-6 gap-y-2 justify-between"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          {/*
           * No KvK number, VAT number or address here yet, and deliberately not a
           * plausible-looking placeholder. Those are legally required identifiers
           * on a commercial site (art. 3:15d BW) and inventing them would be worse
           * than leaving them out — see /contact, which says the same thing.
           */}
          <span>MyQare — nog niet in gebruik voor echte opdrachten.</span>
          <span>Gemaakt voor de Nederlandse zorg.</span>
        </div>
      </div>
    </footer>
  );
}
