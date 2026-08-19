import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Voor zorginstellingen",
  description:
    "Bouw een eigen pool zzp'ers, plaats diensten in één handeling, keur uren goed en houd per opdracht bij wat je nodig hebt bij een vraag over de arbeidsrelatie. Gratis.",
};

const FEATURES = [
  {
    title: "Je eigen pool",
    body: "Nodig zorgprofessionals uit met wie je al werkt, of laat ze zich aanmelden. Markeer favorieten en bied diensten eerst alleen aan hen aan. Wie in je pool zit, hoef je niet elke keer opnieuw te controleren.",
  },
  {
    title: "Series in één handeling",
    body: "Elke dinsdag- en donderdagnacht, acht weken lang: dat plaats je één keer. MyQare maakt er losse diensten van met elk een eigen reactietermijn, zodat de zevende week niet al verlopen is voordat iemand hem ziet.",
  },
  {
    title: "Documenten die je moet zien",
    /*
     * This said documents are checked "voordat iemand in je pool komt". They are
     * not: addToPoolAction checks no documents at all, and adding somebody by
     * email puts them in the pool immediately. What is true is that MyQare reviews
     * every uploaded document, and that you can see the approved ones before you
     * hire — which is the check the Wkkgz actually puts on the facility.
     */
    body: "Elk geüpload document — VOG, diploma, beroepsaansprakelijkheidsverzekering, KvK-uittreksel — wordt door ons beoordeeld voordat het als goedgekeurd geldt. Je ziet de goedgekeurde documenten van je poolleden vóór je iemand inhuurt, want de Wkkgz-check hoort vooraf. Iemand in je pool zetten is geen goedkeuring: dat blijft jouw beoordeling.",
  },
  {
    title: "Verlopende documenten",
    body: "Een VOG die over dertig dagen verloopt levert een melding op bij de zorgprofessional en bij jou. Niemand komt erachter op de dag dat de inspectie belt.",
  },
  {
    title: "Uren goedkeuren of terugsturen",
    body: "De zorgprofessional dient de werkelijk gewerkte tijd in. Jij keurt goed of stuurt terug met een reden. Pas na goedkeuring gaat er een factuur uit.",
  },
  {
    title: "Facturen op één plek",
    body: "Elke factuur komt binnen op het adres van je crediteurenadministratie én staat in je overzicht, met status. Herinneringen gaan automatisch bij overschrijding van de termijn.",
  },
];

export default function VoorZorginstellingenPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <p
        className="text-sm font-semibold uppercase tracking-wide mb-3"
        style={{ color: "var(--brand-text)" }}
      >
        Voor zorginstellingen
      </p>
      <h1 className="text-3xl sm:text-4xl font-bold mb-4 max-w-3xl">
        Inhuren zonder dat je achteraf moet reconstrueren wat er gebeurde.
      </h1>
      <p className="text-lg max-w-2xl mb-8" style={{ color: "var(--text-muted)" }}>
        Plaats diensten, laat je eigen pool erop reageren, keur uren goed. Bij elke opdracht legt
        MyQare vast wie aanbood, aan hoeveel mensen tegelijk, wie accepteerde en dat weigeren kon.
        Gratis, zonder abonnement.
      </p>
      <div className="flex flex-wrap gap-3 mb-16">
        <Link className="btn btn-primary" href="/registreren">
          Account aanmaken
        </Link>
        <Link className="btn btn-secondary" href="/hoe-het-werkt">
          Hoe het werkt
        </Link>
      </div>

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
        <h2 className="text-2xl font-bold mb-3">Het dossier</h2>
        <p className="max-w-3xl mb-4" style={{ color: "var(--text-muted)" }}>
          De handhaving op schijnzelfstandigheid is sinds januari 2025 hervat, en de Belastingdienst
          kijkt daarbij uitdrukkelijk naar driehoeksverhoudingen tussen opdrachtgever, zzp&apos;er
          en tussenpartij. De vragen die dan komen gaan over feiten op een specifiek moment.
        </p>
        <div className="card p-6 max-w-3xl">
          <h3 className="font-bold mb-3">Wat er per opdracht in staat</h3>
          <ul className="text-sm space-y-2" style={{ color: "var(--text-muted)" }}>
            <li>Wie de dienst aanbood, wanneer, en aan hoeveel zorgprofessionals tegelijk</li>
            <li>Hoeveel van hen niet accepteerden</li>
            <li>Wie accepteerde, op welk moment, en dat weigeren zonder gevolgen mogelijk was</li>
            <li>Welk tarief gold en wie dat bepaalde</li>
            <li>Of vervanging was toegestaan</li>
            <li>Een kopie van de gegevens zoals ze er op dát moment uitzagen</li>
          </ul>
          <p className="text-sm mt-4" style={{ color: "var(--text-muted)" }}>
            Te exporteren als pdf over een zelfgekozen periode. De pdf zegt zelf wat hij is: een
            weergave van vastgelegde feiten, geen juridisch oordeel en geen vervanging van advies.
          </p>
        </div>
      </section>

      <section className="rounded-xl p-8" style={{ background: "var(--brand-subtle)" }}>
        <h2 className="text-xl font-bold mb-2">Waarloop je tegenaan</h2>
        <p className="max-w-3xl mb-3">
          Eerlijk: MyQare is in aanbouw en er zijn nog geen instellingen live. Het aanbod bestaat uit
          de mensen die jij zelf uitnodigt — een pool bouwt zich niet vanzelf, en wij hebben er nog
          geen om je aan te koppelen.
        </p>
        <p className="max-w-3xl">
          Dat is precies waarom de eerste instellingen interessant zijn om mee te praten.{" "}
          <Link href="/contact">Neem contact op</Link> en vertel wat je nu doet — dat bepaalt wat er
          als volgende gebouwd wordt.
        </p>
      </section>
    </div>
  );
}
