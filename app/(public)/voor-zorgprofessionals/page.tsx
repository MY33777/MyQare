import type { Metadata } from "next";
import Link from "next/link";
import {
  FEE_PERCENT_LABEL,
  FEE_INCL_VAT_PERCENT_LABEL,
  VAT_PERCENT_LABEL,
} from "@/lib/fees";
import { QUALIFICATIONS } from "@/lib/qualifications";

export const metadata: Metadata = {
  title: "Voor zorgprofessionals",
  description:
    "Diensten die bij je kwalificatie en regio passen. Zelf bepalen wat je aanneemt, geen marge op je uurtarief, facturen worden voor je opgemaakt.",
};


const FEATURES = [
  {
    title: "Alleen wat bij je past",
    /*
     * Was "gefilterd op je kwalificatie en je regio", which described only the
     * region-wide path — pool and stars offered everyone in the pool regardless of
     * qualification. Qualification now filters everywhere; region still applies
     * only where it should, because a facility's own pool member who moved house
     * should not silently stop hearing from a client they work with.
     */
    body: "Diensten worden altijd gefilterd op je kwalificatie: je krijgt geen aanbod voor werk dat je niet mag doen. Regio geldt bij diensten die breed worden uitgezet; van instellingen waar je zelf in de pool zit, hoor je ongeacht waar je woont.",
  },
  {
    title: "Weigeren kost je niets",
    body: "Geen score die daalt, geen voorrang die je kwijtraakt, en de instelling krijgt geen melding dat je nee zei. Een aanbod is een aanbod.",
  },
  {
    title: "Het tarief dat er staat, is het tarief",
    body: "Wij nemen geen marge op je uurtarief. Wat de instelling biedt, factureer je. Onze kosten staan er los van en zie je vooraf.",
  },
  {
    title: "Facturen worden opgemaakt",
    body: "Na goedkeuring van je uren maken we de factuur op jouw naam op, doorlopend genummerd, met alle verplichte gegevens, en mailen die naar de instelling.",
  },
  {
    title: "Btw goed geregeld",
    body: "Verleen je btw-vrijgestelde zorg volgens artikel 11-1-g Wet OB, dan factureren we zonder btw en met de vrijstelling erbij. Anders met 21%. Zolang dat niet is vastgesteld, gaat er niets uit.",
  },
  {
    title: "Beschikbaarheid als blokkade",
    body: "Je geeft aan wanneer je níet kunt. Dat filtert aanbiedingen weg zonder dat je je ergens aan vastlegt — je zegt nergens 'ja' door niets in te vullen.",
  },
];

export default function VoorZorgprofessionalsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <p
        className="text-sm font-semibold uppercase tracking-wide mb-3"
        style={{ color: "var(--brand-text)" }}
      >
        Voor zorgprofessionals
      </p>
      <h1 className="text-3xl sm:text-4xl font-bold mb-4 max-w-3xl">
        Werk aannemen zonder dat er iemand tussen zit.
      </h1>
      <p className="text-lg max-w-2xl mb-8" style={{ color: "var(--text-muted)" }}>
        Diensten die bij je kwalificatie en regio passen, met het volledige tarief erbij. Jij
        bepaalt wat je aanneemt. Wij maken de factuur op en houden je dossier bij.
      </p>
      <div className="flex flex-wrap gap-3 mb-4">
        <Link className="btn btn-primary" href="/registreren">
          Account aanmaken
        </Link>
        <Link className="btn btn-secondary" href="/tarieven">
          Wat het kost
        </Link>
      </div>
      <p className="text-sm mb-16" style={{ color: "var(--text-muted)" }}>
        {FEE_PERCENT_LABEL}% van de opdrachtwaarde plus btw — {FEE_INCL_VAT_PERCENT_LABEL}% in totaal — en
        alleen bij een dienst die je aanneemt. Wordt de dienst geannuleerd, dan krijg je alles
        terug.
      </p>

      <h2 className="text-2xl font-bold mb-6">Wat je krijgt</h2>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 mb-16">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="card p-5">
            <h3 className="font-bold mb-2">{feature.title}</h3>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {feature.body}
            </p>
          </div>
        ))}
      </div>

      <section className="mb-16">
        <h2 className="text-2xl font-bold mb-3">Je kwalificatie, zoals die heet</h2>
        <p className="max-w-3xl mb-4" style={{ color: "var(--text-muted)" }}>
          MyQare kent {QUALIFICATIONS.length} Nederlandse zorgkwalificaties — van Helpende Zorg en
          Welzijn niveau 2 tot en met de wettelijk erkende specialismen en de wo-opleidingen — met
          CREBO-code waar die er is. Je kiest wat er op je diploma staat, niet een vakje dat er
          ongeveer op lijkt.
        </p>
        <p className="max-w-3xl text-sm" style={{ color: "var(--text-muted)" }}>
          Dat is niet cosmetisch. Een instelling die een Verzorgende IG niveau 3 zoekt, moet geen
          Helpende niveau 2 aangeboden krijgen, en jij moet geen dienst zien die je niet mag
          draaien.
        </p>
      </section>

      <section className="mb-16">
        <h2 className="text-2xl font-bold mb-3">Wat je zelf moet regelen</h2>
        <div className="card p-6 max-w-3xl">
          <ul className="text-sm space-y-2" style={{ color: "var(--text-muted)" }}>
            <li>
              <strong>Een KvK-inschrijving.</strong> Je werkt als zelfstandige, niet via ons in
              dienst.
            </li>
            <li>
              <strong>Een VOG.</strong> Voor de zorg verplicht, en de instelling moet hem gezien
              hebben voordat je begint.
            </li>
            <li>
              <strong>Je diploma.</strong> En bij een BIG-beroep je BIG-registratie.
            </li>
            <li>
              <strong>Een beroepsaansprakelijkheidsverzekering.</strong> Vrijwel elke instelling
              vraagt hierom.
            </li>
            <li>
              <strong>Je eigen belastingaangifte.</strong> Wij maken de factuur op; de aangifte
              blijft van jou.
            </li>
          </ul>
          <p className="text-sm mt-4" style={{ color: "var(--text-muted)" }}>
            Je uploadt die documenten één keer. Ze worden gecontroleerd, en bij een verloopdatum
            krijg je dertig dagen van tevoren bericht.
          </p>
        </div>
      </section>

      <section className="rounded-xl p-8" style={{ background: "var(--brand-subtle)" }}>
        <h2 className="text-xl font-bold mb-2">Eerlijk over waar het staat</h2>
        <p className="max-w-3xl mb-3">
          Er zijn nog geen instellingen live, dus er is nog geen aanbod. Een account aanmaken heeft
          nu vooral zin als je wil meekijken of meepraten over hoe dit eruit moet komen te zien.
        </p>
        <p className="max-w-3xl">
          Werk je al bij een instelling die dit zou kunnen gebruiken?{" "}
          <Link href="/contact">Laat het weten</Link> — dat helpt meer dan een wachtlijst.
        </p>
      </section>
    </div>
  );
}
