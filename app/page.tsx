import Link from "next/link";
import { Brand } from "@/components/Brand";
import { getSessionUser } from "@/lib/auth";

export default async function HomePage() {
  // Signed-in visitors get a link straight back into the app instead of the pitch.
  const user = await getSessionUser();

  return (
    <>
      <header className="border-b" style={{ borderColor: "var(--border)" }}>
        <div className="mx-auto max-w-5xl px-4 h-16 flex items-center justify-between">
          <Brand className="text-lg" />
          <nav className="flex items-center gap-3">
            {user ? (
              <Link className="btn btn-primary" href="/professional">
                Naar mijn account
              </Link>
            ) : (
              <>
                <Link className="btn btn-secondary" href="/login">
                  Inloggen
                </Link>
                <Link className="btn btn-primary" href="/registreren">
                  Account aanmaken
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-4 py-16 sm:py-24">
          <p
            className="text-sm font-semibold uppercase tracking-wide mb-3"
            style={{ color: "var(--brand-text)" }}
          >
            Voor de zorg in Nederland
          </p>
          <h1 className="text-3xl sm:text-5xl font-bold leading-tight max-w-3xl">
            Zzp&apos;ers inhuren met een dossier dat klopt.
          </h1>
          <p className="mt-5 text-lg max-w-2xl" style={{ color: "var(--text-muted)" }}>
            Plan diensten, keur uren goed en laat facturen automatisch de deur uit gaan. Bij elke
            opdracht bouwt MyQare het dossier op waarmee je aantoont dat er écht sprake was van
            zelfstandigheid.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="btn btn-primary" href="/registreren">
              Account aanmaken
            </Link>
            <Link className="btn btn-secondary" href="/login">
              Inloggen
            </Link>
          </div>
          <p className="mt-4 text-sm" style={{ color: "var(--text-muted)" }}>
            Gratis voor zorginstellingen. Zorgprofessionals betalen 5% per aangenomen dienst.
          </p>
        </section>

        <section
          className="border-t"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <div className="mx-auto max-w-5xl px-4 py-14 grid gap-8 sm:grid-cols-3">
            <div>
              <h2 className="font-bold mb-2">Het dossier, automatisch</h2>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Wie bood aan, wie accepteerde, welk tarief is afgesproken, en dat weigeren mogelijk
                was. Per opdracht vastgelegd en als pdf te exporteren.
              </p>
            </div>
            <div>
              <h2 className="font-bold mb-2">Geen bemiddelingskosten</h2>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                De instelling en de zorgprofessional spreken zelf het tarief af. Wij zitten er niet
                tussen en rekenen de instelling niets.
              </p>
            </div>
            <div>
              <h2 className="font-bold mb-2">Facturen zonder werk</h2>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Na goedkeuring van de uren maakt MyQare de factuur op naam van de zorgprofessional
                op, met de juiste btw-behandeling, en mailt die naar je administratie.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-14">
          <h2 className="text-xl font-bold mb-6">Hoe het werkt</h2>
          <ol className="space-y-4">
            {[
              "De instelling plaatst een dienst met datum, functie en tarief.",
              "Zorgprofessionals uit de eigen pool krijgen een melding en kunnen aannemen — of weigeren, zonder gevolgen.",
              "Na de dienst vult de zorgprofessional de gewerkte uren in en keurt de instelling die goed.",
              "MyQare maakt de factuur op en legt het dossier vast.",
            ].map((step, index) => (
              <li key={step} className="flex gap-4">
                <span
                  className="flex-none w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ background: "var(--brand-subtle)", color: "var(--brand-text)" }}
                >
                  {index + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer
        className="border-t"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div
          className="mx-auto max-w-5xl px-4 py-8 text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          <Brand /> — zelfstandige zorg, sluitend geregeld.
        </div>
      </footer>
    </>
  );
}
