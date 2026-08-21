import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Hoe het werkt",
  description:
    "Van openstaande dienst tot verstuurde factuur en vastgelegd dossier — stap voor stap, met wat er per stap wordt vastgelegd.",
};

/*
 * The long version of the four steps on the homepage.
 *
 * Each step also says what gets recorded, because that is the part a coordinator
 * is actually evaluating. The feature list is table stakes; the recording is the
 * product.
 */

const STEPS = [
  {
    number: 1,
    title: "De instelling plaatst een dienst",
    body: [
      "Datum, begin- en eindtijd, pauze, afdeling, locatie, benodigde kwalificatie en het uurtarief. Een terugkerende dienst — elke dinsdagnacht, zes weken lang — plaats je in één handeling; MyQare maakt er losse diensten van, elk met een eigen reactietermijn.",
      "Je kiest wie hem ziet: alleen je favorieten, je hele pool, of iedereen in de regio met de juiste kwalificatie die nog geen account bij je heeft.",
    ],
    records: "Wie de dienst plaatste, wanneer, welk tarief werd geboden en tot wanneer erop gereageerd kon worden.",
  },
  {
    number: 2,
    title: "Iedereen die past krijgt hem tegelijk",
    body: [
      "Geen planner die iemand aanwijst. De dienst gaat in één keer naar alle zorgprofessionals die aan de kwalificatie voldoen, in de regio werken en op dat moment beschikbaar zijn. Wie het eerst accepteert, heeft hem.",
      "Weigeren kan zonder reden en zonder gevolgen. Er is geen score die daalt, geen voorrang die je verliest en geen melding aan de instelling dat je nee zei.",
    ],
    records: "Aan hoeveel mensen de dienst tegelijk is aangeboden, en hoeveel van hen niet accepteerden. Dat getal is wat één acceptatie verandert in bewijs van een markt in plaats van een aanwijzing.",
  },
  {
    number: 3,
    title: "Aannemen is een eigen beslissing",
    body: [
      "De zorgprofessional ziet het volledige tarief, de tijden en de afdeling voordat hij accepteert. Onze kosten worden op dat moment van het saldo afgeschreven, dus er is nooit een rekening achteraf.",
      "Beschikbaarheid werkt als een blokkade, niet als een belofte: je geeft aan wanneer je níet kunt, en die momenten filteren we eruit. Je zegt daarmee nergens toe.",
    ],
    records: "Wie accepteerde, op welk moment, tegen welk tarief, en dat weigeren mogelijk was. Ook of het tarief door de instelling werd geboden of door de zorgprofessional opgegeven.",
  },
  {
    number: 4,
    title: "Uren invullen en goedkeuren",
    body: [
      "Na de dienst dient de zorgprofessional de werkelijk gewerkte tijd in, met pauze. Uitgelopen of eerder klaar: het gaat om wat er gebeurde, niet om wat er gepland stond.",
      "De instelling keurt goed of stuurt terug met een reden. Zolang er niets is goedgekeurd, staat er ook niets vast.",
    ],
    records: "Geplande tijd, geclaimde tijd, wie goedkeurde en wanneer. Het verschil tussen die twee wordt met het saldo verrekend — meer gewerkt betekent bijbetalen, minder betekent terug.",
  },
  {
    number: 5,
    title: "De factuur gaat eruit",
    body: [
      "MyQare maakt de factuur op naam van de zorgprofessional op — doorlopend genummerd, met alle gegevens die de Belastingdienst eist — en mailt hem naar de administratie van de instelling.",
      "Btw of vrijstelling wordt per zorgprofessional bepaald. Wie btw-vrijgestelde zorg verleent volgens artikel 11-1-g Wet OB factureert zonder btw, met de vrijstelling erbij vermeld. Zolang dat niet is vastgesteld, factureren we niet — een verkeerde btw-behandeling is achteraf lastiger te repareren dan een dag wachten.",
    ],
    records: "Factuurnummer, datum, bedragen en btw-behandeling. Facturen worden bewaard, ook als het account later wordt opgeheven — de bewaarplicht van zeven jaar gaat voor.",
  },
  {
    number: 6,
    title: "Het dossier staat er al",
    body: [
      "Er is geen knop 'dossier aanmaken'. Elk van de stappen hierboven schreef zijn eigen deel weg op het moment dat het gebeurde, met een kopie van de gegevens zoals die er toen uitzagen.",
      "Dat laatste is het punt: als een zorgprofessional twee jaar later zijn profiel aanpast, verandert er niets aan wat er in het dossier staat over een opdracht uit 2026.",
    ],
    records: "Te exporteren als pdf, per periode of per zorgprofessional, vanaf het dossieroverzicht van de instelling. Een vraag gaat meestal over één samenwerking, dus dat is ook de vorm waarin je hem kunt opvragen.",
  },
];

export default function HoeHetWerktPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <h1 className="text-3xl sm:text-4xl font-bold mb-3">Hoe het werkt</h1>
      <p className="text-lg max-w-2xl mb-12" style={{ color: "var(--text-muted)" }}>
        Van openstaande dienst tot verstuurde factuur. Bij elke stap staat wat er wordt vastgelegd,
        want dat is waar het dossier uit ontstaat.
      </p>

      <ol className="space-y-10 mb-16">
        {STEPS.map((step) => (
          <li key={step.number} className="grid gap-4 sm:grid-cols-[3rem_1fr]">
            <span
              className="flex-none w-10 h-10 rounded-full flex items-center justify-center font-bold"
              style={{ background: "var(--brand-subtle)", color: "var(--brand-text)" }}
            >
              {step.number}
            </span>
            <div>
              <h2 className="text-xl font-bold mb-2">{step.title}</h2>
              {step.body.map((paragraph) => (
                <p key={paragraph} className="mb-3 max-w-3xl" style={{ color: "var(--text-muted)" }}>
                  {paragraph}
                </p>
              ))}
              <p
                className="text-sm rounded-lg p-3 max-w-3xl"
                style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
              >
                <strong>Vastgelegd: </strong>
                {step.records}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <section className="rounded-xl p-8" style={{ background: "var(--brand-subtle)" }}>
        <h2 className="text-xl font-bold mb-2">Waarom dit werkt als dossier</h2>
        <p className="max-w-3xl mb-3">
          Sinds januari 2025 handhaaft de Belastingdienst weer op schijnzelfstandigheid. De vraag
          die dan gesteld wordt gaat niet over papier, maar over feiten: kon deze persoon weigeren,
          werkte hij ook elders, wie bepaalde het tarief, was er een gezagsverhouding?
        </p>
        <p className="max-w-3xl mb-3">
          Dat zijn allemaal vragen over wat er op een specifiek moment in het verleden gebeurde. Ze
          zijn achteraf bijna niet te beantwoorden en op het moment zelf triviaal vast te leggen.
          MyQare legt ze op het moment zelf vast.
        </p>
        <p className="max-w-3xl text-sm" style={{ color: "var(--text-muted)" }}>
          Een dossier is geen garantie en geen juridisch oordeel over de arbeidsrelatie. Het is
          bewijs van wat er feitelijk gebeurde. Wat dat waard is, bepaalt de inspecteur — en dat
          staat ook zo in de pdf zelf.{" "}
          <Link href="/voor-zorginstellingen">Meer voor zorginstellingen</Link>.
        </p>
      </section>
    </div>
  );
}
