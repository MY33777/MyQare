import Link from "next/link";
import { PLATFORM_FEE_BP, VAT_STANDARD_BP } from "@/lib/fees";

/**
 * The landing page.
 *
 * Header and footer now come from the (public) layout, so this file is only the
 * pitch. It leads with the dossier rather than with "vind snel personeel",
 * because finding staff is what every competitor already claims and the dossier
 * is the thing a coordinator cannot get anywhere else.
 */

// Written out rather than hardcoded as "5%" — the fee lives in one place and the
// homepage should not be able to drift away from what the ledger actually books.
const FEE_PERCENT = PLATFORM_FEE_BP / 100;
const FEE_INCL_VAT_PERCENT = ((PLATFORM_FEE_BP * (10000 + VAT_STANDARD_BP)) / 10000 / 100).toFixed(2).replace(".", ",");

const PILLARS = [
  {
    title: "Het dossier bouwt zichzelf",
    body: "Bij elke opdracht leggen we vast wie aanbood, aan hoeveel mensen tegelijk, wie accepteerde, welk tarief gold en dat weigeren zonder gevolgen kon. Exporteerbaar als pdf, per periode.",
  },
  {
    title: "Geen bemiddelingskosten",
    body: "De instelling en de zorgprofessional spreken zelf het tarief af. Wij onderhandelen niet mee, sturen niemand aan en rekenen de instelling niets.",
  },
  {
    title: "Facturen zonder werk",
    body: "Na goedkeuring van de uren maken we de factuur op naam van de zorgprofessional op, met de juiste btw-behandeling, en mailen die naar de administratie.",
  },
];

const STEPS = [
  {
    title: "De instelling plaatst een dienst",
    body: "Datum, functie, afdeling en uurtarief. Zichtbaar voor de eigen pool, voor favorieten, of voor iedereen in de regio met de juiste kwalificatie.",
  },
  {
    title: "Zorgprofessionals reageren",
    body: "Iedereen die past krijgt hem tegelijk. Aannemen of weigeren, zonder gevolgen voor toekomstige aanbiedingen. Wie het eerst accepteert, heeft de dienst.",
  },
  {
    title: "De uren worden ingevuld en goedgekeurd",
    body: "De zorgprofessional dient de gewerkte uren in, de instelling keurt goed of stuurt terug met een reden.",
  },
  {
    title: "De factuur en het dossier volgen automatisch",
    body: "Factuur op naam van de zorgprofessional, doorlopend genummerd, met btw of de vrijstelling uit artikel 11-1-g. Het dossierrecord staat er dan al.",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
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
          opdracht legt MyQare vast wat er feitelijk gebeurde — zodat je bij een vraag van de
          Belastingdienst iets kunt laten zien in plaats van iets moet uitleggen.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link className="btn btn-primary" href="/registreren">
            Account aanmaken
          </Link>
          <Link className="btn btn-secondary" href="/hoe-het-werkt">
            Bekijk hoe het werkt
          </Link>
        </div>
        <p className="mt-4 text-sm" style={{ color: "var(--text-muted)" }}>
          Gratis voor zorginstellingen. Zorgprofessionals betalen {FEE_PERCENT}% van de
          opdrachtwaarde plus btw — {FEE_INCL_VAT_PERCENT}% in totaal — per aangenomen dienst.{" "}
          <Link href="/tarieven">Bekijk een rekenvoorbeeld</Link>.
        </p>
      </section>

      <section
        className="border-t"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="mx-auto max-w-6xl px-4 py-14 grid gap-8 sm:grid-cols-3">
          {PILLARS.map((pillar) => (
            <div key={pillar.title}>
              <h2 className="font-bold mb-2">{pillar.title}</h2>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {pillar.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold mb-2">Hoe het werkt</h2>
        <p className="mb-8 max-w-2xl" style={{ color: "var(--text-muted)" }}>
          Vier stappen, van openstaande dienst tot verstuurde factuur.
        </p>
        <ol className="grid gap-6 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-4">
              <span
                className="flex-none w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                style={{ background: "var(--brand-subtle)", color: "var(--brand-text)" }}
              >
                {index + 1}
              </span>
              <span>
                <span className="block font-bold mb-1">{step.title}</span>
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {step.body}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/*
       * The two audiences want opposite things — a facility wants supply and a
       * defensible file, a freelancer wants work without a middleman taking a cut
       * of their rate. Splitting here rather than trying to write one paragraph
       * that half-serves both.
       */}
      <section
        className="border-t"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="mx-auto max-w-6xl px-4 py-16 grid gap-6 md:grid-cols-2">
          <div className="card p-6">
            <h2 className="text-lg font-bold mb-2">Voor zorginstellingen</h2>
            <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
              Bouw een eigen pool, plaats diensten in één handeling voor een hele reeks, en houd
              per opdracht bij wat je nodig hebt als er naar de arbeidsrelatie gevraagd wordt.
            </p>
            <Link className="btn btn-secondary" href="/voor-zorginstellingen">
              Lees verder
            </Link>
          </div>
          <div className="card p-6">
            <h2 className="text-lg font-bold mb-2">Voor zorgprofessionals</h2>
            <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
              Zie diensten die bij je kwalificatie en regio passen, bepaal zelf wat je aanneemt, en
              laat de facturatie en de btw-behandeling voor je afhandelen.
            </p>
            <Link className="btn btn-secondary" href="/voor-zorgprofessionals">
              Lees verder
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <div
          className="rounded-xl p-8 sm:p-10"
          style={{ background: "var(--brand-subtle)" }}
        >
          <h2 className="text-2xl font-bold mb-2">Nog niet in gebruik voor echte opdrachten</h2>
          <p className="max-w-2xl mb-6" style={{ color: "var(--text)" }}>
            MyQare is in aanbouw. De planning, urenregistratie, facturatie en dossieropbouw werken,
            maar er zijn nog geen instellingen live en de juridische documenten zijn concept. Laat
            weten of dit is wat je zoekt — dat stuurt wat er als volgende gebouwd wordt.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link className="btn btn-primary" href="/contact">
              Neem contact op
            </Link>
            <Link className="btn btn-secondary" href="/veelgestelde-vragen">
              Veelgestelde vragen
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
