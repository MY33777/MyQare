import type { Metadata } from "next";
import Link from "next/link";
import { Prose, DraftNotice } from "@/components/Prose";
import { MODEL_AGREEMENT_VERSION } from "@/lib/assignments";

export const metadata: Metadata = {
  title: "Modelovereenkomst",
  description:
    "Wat een modelovereenkomst is, welke rol die speelt bij het dossier zelfstandigheid, en waarom MyQare er nog geen heeft.",
};

/*
 * This page deliberately does NOT contain a model agreement.
 *
 * Writing one that looked finished would be the single most harmful thing on this
 * site: somebody would use it, and a model agreement that has not been checked
 * against the actual working relationship is exactly what the Belastingdienst
 * sets aside when it looks at the facts. It is also the document that determines
 * whether a facility is hiring a contractor or an employee.
 *
 * So the page explains what the document is for, what it must cover, and states
 * that there is none yet. MODEL_AGREEMENT_VERSION is read from the same constant
 * the dossier stamps, so this page cannot claim something the records contradict.
 */

const NO_AGREEMENT = MODEL_AGREEMENT_VERSION === "geen-modelovereenkomst";

export default function ModelovereenkomstPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl sm:text-4xl font-bold mb-3">Modelovereenkomst</h1>
      <p className="text-lg mb-8" style={{ color: "var(--text-muted)" }}>
        Wat het is, waarom het ertoe doet, en waar MyQare op dit punt staat.
      </p>

      {NO_AGREEMENT ? (
        <DraftNotice>
          <strong>Er is nog geen modelovereenkomst.</strong> Er staat hier bewust geen concepttekst.
          Een modelovereenkomst die niet is opgesteld en getoetst door een jurist geeft schijnzekerheid
          op precies het punt waar het misgaat, en zou door beide partijen worden gebruikt alsof hij
          wél iets betekende. Dossierrecords vermelden daarom letterlijk dat er geen
          modelovereenkomst gold — niet een versienummer dat suggereert van wel.
        </DraftNotice>
      ) : (
        <div
          className="rounded-lg border p-4 text-sm mb-8"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          Huidige versie: <strong>{MODEL_AGREEMENT_VERSION}</strong>. Deze versie wordt vastgelegd
          bij elke opdracht die vanaf de ingangsdatum wordt aangenomen.
        </div>
      )}

      <Prose>
        <h2 id="wat">Wat is een modelovereenkomst?</h2>
        <p>
          Een modelovereenkomst is een contract tussen een opdrachtgever en een zelfstandige waarin
          staat hoe zij samenwerken. Tot 2025 kon je zo&apos;n overeenkomst laten beoordelen door de
          Belastingdienst; werkte je vervolgens precies zoals erin stond, dan had je vooraf
          zekerheid dat er geen loonheffing hoefde te worden afgedragen.
        </p>
        <p>
          De Belastingdienst beoordeelt sinds 2025 geen nieuwe modelovereenkomsten meer. Bestaande
          goedgekeurde overeenkomsten lopen af, en daarmee verschuift het zwaartepunt volledig naar
          iets anders.
        </p>

        <h2 id="feiten">Het papier is niet waar het om draait</h2>
        <p>
          Dit is het punt dat het vaakst verkeerd begrepen wordt. Een modelovereenkomst geeft geen
          bescherming omdat hij bestaat. Hij geeft hooguit bescherming als de praktijk eraan
          voldoet.
        </p>
        <p>
          Staat er in de overeenkomst dat de zelfstandige zijn eigen werktijden bepaalt, terwijl hij
          in werkelijkheid op het rooster van de afdeling staat, dan telt het rooster. De
          Belastingdienst kijkt naar de feitelijke verhouding: was er gezag, moest het werk
          persoonlijk worden verricht, wie bepaalde het tarief, kon er geweigerd worden, werkte
          iemand ook elders?
        </p>
        <p>
          Precies daarom legt MyQare die feiten per opdracht vast op het moment dat ze zich
          voordoen. Zie <Link href="/hoe-het-werkt">hoe het werkt</Link>.
        </p>

        <h2 id="waarom-nodig">Waarom er toch een moet komen</h2>
        <p>
          Vastgelegde feiten en een overeenkomst doen verschillende dingen. Het dossier laat zien
          wat er gebeurde. De overeenkomst legt vast wat partijen met elkaar afspraken over de
          punten waar het dossier niets over kan zeggen:
        </p>
        <ul>
          <li>Of vervanging door een andere gekwalificeerde zelfstandige is toegestaan</li>
          <li>Wie aansprakelijk is waarvoor, en welke verzekering daaronder ligt</li>
          <li>Hoe wordt omgegaan met een dienst die door omstandigheden niet doorgaat</li>
          <li>Wat er geldt rond geheimhouding en de omgang met cliëntgegevens</li>
          <li>Dat er geen gezagsverhouding is en de zelfstandige zijn werk zelf inricht</li>
          <li>Betaaltermijn en wat er gebeurt bij te laat betalen</li>
        </ul>
        <p>
          Zonder die afspraken valt men bij onenigheid terug op wat de wet zegt, en dat is voor geen
          van beide partijen de uitkomst waar ze op rekenden.
        </p>

        <h2 id="status">Waar MyQare staat</h2>
        <p>
          De software is er klaar voor: bij elke opdracht wordt vastgelegd welke versie van de
          overeenkomst gold, zodat later te herleiden is welke afspraken van toepassing waren.
          {NO_AGREEMENT
            ? " Zolang er geen overeenkomst is vastgesteld, vermeldt dat veld dat er geen was."
            : " Op dit moment is dat versie " + MODEL_AGREEMENT_VERSION + "."}
        </p>
        <p>
          Wat er nog moet gebeuren: een overeenkomst laten opstellen door een jurist met kennis van
          de Wet DBA en de zorg, die past bij hoe dit platform werkt — dus zonder bepalingen over
          bemiddeling, exclusiviteit of aansturing, want die zijn hier feitelijk onjuist en zouden
          juist tegen partijen werken.
        </p>
        <p>
          Tot die er is, moeten instellingen en zorgprofessionals hun eigen afspraken maken. MyQare
          legt vast wat er gebeurde; het vervangt die afspraken niet.
        </p>

        <h2 id="advies">Dit is geen juridisch advies</h2>
        <p>
          Deze pagina legt uit hoe het stelsel in elkaar zit. Of jouw situatie als zelfstandigheid
          kwalificeert, hangt af van jouw feiten, en daarvoor heb je een adviseur nodig die die
          feiten kent. <Link href="/contact">Neem contact op</Link> als je wil meedenken over hoe
          deze overeenkomst eruit zou moeten zien.
        </p>
      </Prose>
    </div>
  );
}
