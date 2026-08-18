import Link from "next/link";
import { BrandLink } from "@/components/Brand";

/**
 * 404.
 *
 * Lives at the app root rather than inside (public), because a wrong URL under
 * /zorginstelling should land here too — and the (public) header would then offer
 * a signed-in coordinator a "account aanmaken" button, which reads as though
 * their session had expired.
 */
export default function NotFound() {
  return (
    <>
      <header className="border-b" style={{ borderColor: "var(--border)" }}>
        <div className="mx-auto max-w-6xl px-4 h-16 flex items-center">
          <BrandLink className="text-lg" />
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-2xl px-4 py-24">
        <p
          className="text-sm font-semibold uppercase tracking-wide mb-3"
          style={{ color: "var(--brand-text)" }}
        >
          404
        </p>
        <h1 className="text-3xl font-bold mb-4">Deze pagina bestaat niet.</h1>
        <p className="mb-8" style={{ color: "var(--text-muted)" }}>
          Mogelijk is de link verouderd, of is de dienst waarnaar je zocht ingetrokken. Als je
          hierheen kwam vanuit een e-mail van ons, laat het dan weten — dan klopt er iets niet aan
          onze kant.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link className="btn btn-primary" href="/">
            Naar de homepage
          </Link>
          <Link className="btn btn-secondary" href="/contact">
            Contact
          </Link>
        </div>
      </main>
    </>
  );
}
