import type { Metadata } from "next";
import Link from "next/link";
import { PLATFORM_FEE_BP, VAT_STANDARD_BP } from "@/lib/fees";

export const metadata: Metadata = {
  title: "Veelgestelde vragen",
  description:
    "Wat MyQare kost, hoe het dossier werkt, wat er met je documenten gebeurt en wat er nog niet af is.",
};

const FEE_PERCENT = PLATFORM_FEE_BP / 100;
const FEE_INCL_VAT_PERCENT = ((PLATFORM_FEE_BP * (10000 + VAT_STANDARD_BP)) / 10000 / 100).toFixed(2).replace(".", ",");

type Question = { q: string; a: React.ReactNode };

const SECTIONS: { heading: string; questions: Question[] }[] = [
  {
    heading: "Algemeen",
    questions: [
      {
        q: "Is MyQare een uitzendbureau?",
        a: (
          <>
            Nee. We wijzen niemand toe, onderhandelen niet over tarieven en nemen geen marge op het
            uurtarief. Een dienst gaat naar iedereen die eraan voldoet en wie accepteert beslist
            zelf. Dat is niet alleen een keuze in het verdienmodel: zodra wij zouden bemiddelen,
            zou het dossier precies de conclusie ondersteunen die niemand wil.
          </>
        ),
      },
      {
        q: "Kan ik MyQare nu gebruiken?",
        a: (
          <>
            Nog niet voor echte opdrachten. De software werkt, maar er zijn geen instellingen live,
            de rechtspersoon is nog niet ingericht en de juridische documenten zijn concept. Een
            account aanmaken heeft nu zin als je wil meekijken of meepraten.
          </>
        ),
      },
      {
        q: "Wat gebeurt er met mijn gegevens?",
        a: (
          <>
            Wat je invult wordt gebruikt om diensten te matchen, uren vast te leggen en facturen op
            te maken. We slaan geen kopieën van identiteitsbewijzen op, geen BSN en geen
            patiëntgegevens. Zie de <Link href="/privacy">privacyverklaring</Link>, die per tabel
            beschrijft wat er staat.
          </>
        ),
      },
    ],
  },
  {
    heading: "Kosten",
    questions: [
      {
        q: "Wat kost het?",
        a: (
          <>
            Voor zorginstellingen niets. Een zorgprofessional betaalt {FEE_PERCENT}% van de
            opdrachtwaarde plus btw daarover — samen {FEE_INCL_VAT_PERCENT}% — en alleen bij een
            dienst die hij aanneemt. Zie <Link href="/tarieven">tarieven</Link> voor een
            rekenvoorbeeld dat met dezelfde functie is doorgerekend als de administratie gebruikt.
          </>
        ),
      },
      {
        q: "Wanneer wordt er afgeschreven?",
        a: (
          <>
            Op het moment dat je een dienst aanneemt, van je saldo. Na goedkeuring van je uren wordt
            het verschil verrekend: langer gewerkt betekent bijbetalen, korter betekent terug. Er
            komt nooit een rekening achteraf.
          </>
        ),
      },
      {
        q: "En als de dienst niet doorgaat?",
        a: (
          <>
            Dan krijg je alles terug, ongeacht wie annuleerde en wanneer. Er is geen boete, geen
            strafpunt en geen effect op je beoordeling.
          </>
        ),
      },
      {
        q: "Waarom betaalt de instelling niets?",
        a: (
          <>
            Omdat een instelling die per plaatsing betaalt een reden krijgt om buiten het systeem om
            te werken — en dan ontbreekt juist de vastlegging bij de opdrachten waar iemand liever
            niet aan herinnerd wordt. Of dit het juiste model is, staat overigens nog open.
          </>
        ),
      },
    ],
  },
  {
    heading: "Werken via MyQare",
    questions: [
      {
        q: "Heeft weigeren gevolgen?",
        a: (
          <>
            Nee. Geen score die daalt, geen voorrang die je verliest, en de instelling krijgt geen
            melding dat je nee zei. Dat is niet alleen prettig — het is ook precies wat een dossier
            moet kunnen aantonen.
          </>
        ),
      },
      {
        q: "Hoe werkt beschikbaarheid?",
        a: (
          <>
            Als blokkade, niet als belofte. Je geeft aan wanneer je níet kunt en die momenten worden
            eruit gefilterd. Door niets in te vullen zeg je nergens ja tegen.
          </>
        ),
      },
      {
        q: "Wat moet ik zelf regelen?",
        a: (
          <>
            Een KvK-inschrijving, een VOG, je diploma (en bij een BIG-beroep je registratie), een
            beroepsaansprakelijkheidsverzekering en je eigen belastingaangifte. Zie{" "}
            <Link href="/voor-zorgprofessionals">voor zorgprofessionals</Link>.
          </>
        ),
      },
      {
        q: "Wie maakt mijn factuur?",
        a: (
          <>
            MyQare maakt hem op jouw naam op, doorlopend genummerd en met alle verplichte gegevens,
            en mailt hem naar de instelling. Jij blijft de opsteller en de instelling betaalt
            rechtstreeks aan jou — wij houden geen geld onder ons.
          </>
        ),
      },
      {
        q: "Hoe zit het met btw?",
        a: (
          <>
            Verleen je btw-vrijgestelde zorg volgens artikel 11-1-g Wet OB, dan factureren we zonder
            btw met de vrijstelling erbij vermeld. Anders met 21%. Zolang niet is vastgesteld welke
            van de twee geldt, gaat er geen factuur uit — een verkeerde btw-behandeling is achteraf
            lastiger te repareren dan een dag wachten.
          </>
        ),
      },
    ],
  },
  {
    heading: "Het dossier",
    questions: [
      {
        q: "Wat staat er precies in?",
        a: (
          <>
            Per opdracht: wie aanbood en wanneer, aan hoeveel mensen tegelijk, hoeveel van hen niet
            accepteerden, wie wel en op welk moment, welk tarief gold en wie dat bepaalde, of
            weigeren mogelijk was, en of vervanging was toegestaan. Plus een kopie van de gegevens
            zoals ze er toen uitzagen.
          </>
        ),
      },
      {
        q: "Verandert het dossier als ik mijn profiel aanpas?",
        a: (
          <>
            Nee. Elk record bewaart een eigen kopie. Pas je over twee jaar je tarief of je bio aan,
            dan blijft wat er over een opdracht uit 2026 staat precies hetzelfde. Anders zou het
            dossier zichzelf herschrijven op het moment dat iemand ernaar kijkt.
          </>
        ),
      },
      {
        q: "Betekent een dossier dat ik goed zit bij de Belastingdienst?",
        a: (
          <>
            Nee, en dat staat ook in de pdf zelf. Het dossier laat zien wat er feitelijk gebeurde.
            Wat dat waard is, beoordeelt uiteindelijk de inspecteur of de rechter. Een document dat
            meer over zichzelf beweert dan het waar kan maken, werkt tegen je.
          </>
        ),
      },
      {
        q: "Is er een modelovereenkomst?",
        a: (
          <>
            Nog niet, en er staat bewust geen concept online. Dossierrecords vermelden daarom
            letterlijk dat er geen modelovereenkomst gold. Zie{" "}
            <Link href="/modelovereenkomst">modelovereenkomst</Link> voor waarom.
          </>
        ),
      },
    ],
  },
  {
    heading: "Documenten",
    questions: [
      {
        q: "Welke documenten upload ik?",
        a: (
          <>
            VOG, diploma&apos;s en certificaten, je beroepsaansprakelijkheidsverzekering en je
            KvK-uittreksel. Eén keer, waarna ze worden gecontroleerd.
          </>
        ),
      },
      {
        q: "Waarom vraagt MyQare niet om mijn paspoort?",
        a: (
          <>
            Omdat het niet mag. Een werkgever moet een kopie bewaren voor de loonheffing; een
            opdrachtgever die een zelfstandige inhuurt heeft die plicht niet en dus ook geen
            grondslag. Het BSN erop mag alleen worden verwerkt waar de wet dat voorschrijft. Het
            KvK-uittreksel beantwoordt de vraag die dit platform wél moet beantwoorden.
          </>
        ),
      },
      {
        q: "Wie kan mijn documenten zien?",
        a: (
          <>
            Medewerkers van MyQare, om ze te beoordelen, en instellingen waarvan je in de pool zit —
            alleen de goedgekeurde. Dat laatste moet, want de instelling is onder de Wkkgz zelf
            verplicht om VOG en diploma te controleren vóórdat je wordt ingezet.
          </>
        ),
      },
      {
        q: "Wat als mijn VOG verloopt?",
        a: (
          <>
            Dertig dagen van tevoren krijg je bericht, en de instelling ook. Niemand komt erachter
            op de dag dat de inspectie belt.
          </>
        ),
      },
    ],
  },
];

export default function VeelgesteldeVragenPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl sm:text-4xl font-bold mb-3">Veelgestelde vragen</h1>
      <p className="text-lg mb-12" style={{ color: "var(--text-muted)" }}>
        Staat je vraag er niet bij? <Link href="/contact">Stel hem gerust.</Link>
      </p>

      {SECTIONS.map((section) => (
        <section key={section.heading} className="mb-12">
          <h2 className="text-xl font-bold mb-4">{section.heading}</h2>
          <div className="grid gap-3">
            {section.questions.map((item) => (
              /*
               * Native <details> rather than a state-driven accordion. It is
               * keyboard-accessible and findable with the browser's own search
               * without any JavaScript — which matters on a page whose whole
               * purpose is answering one specific question quickly.
               */
              <details key={item.q} className="card p-4">
                <summary className="font-medium cursor-pointer">{item.q}</summary>
                <div className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
                  {item.a}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
