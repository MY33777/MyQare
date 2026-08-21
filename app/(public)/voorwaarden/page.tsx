import type { Metadata } from "next";
import Link from "next/link";
import { Prose, DraftNotice, LastUpdated } from "@/components/Prose";
import {
  FEE_PERCENT_LABEL,
  FEE_INCL_VAT_PERCENT_LABEL,
  VAT_PERCENT_LABEL,
} from "@/lib/fees";

export const metadata: Metadata = {
  title: "Algemene voorwaarden",
  description:
    "De voorwaarden voor het gebruik van MyQare: wat het platform doet, wat het niet doet, wat het kost en wie waarvoor verantwoordelijk is.",
};


export default function VoorwaardenPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl sm:text-4xl font-bold mb-3">Algemene voorwaarden</h1>
      <LastUpdated date="19 augustus 2026" />

      <DraftNotice>
        Dit is een concept. Het beschrijft nauwkeurig hoe het platform werkt en wat het in rekening
        brengt, maar is nog niet door een jurist getoetst en nog niet van toepassing verklaard.
        MyQare is nog niet in gebruik voor echte opdrachten.
      </DraftNotice>

      <Prose>
        <h2 id="wat">1. Wat MyQare is</h2>
        <p>
          MyQare is software waarmee een zorginstelling diensten kan aanbieden aan zelfstandige
          zorgprofessionals, uren kan laten registreren en goedkeuren, en facturen kan laten
          opmaken. Wij zijn een hulpmiddel bij die afspraken.
        </p>

        <h2 id="wat-niet">2. Wat MyQare uitdrukkelijk niet is</h2>
        <p>
          Dit is geen bijzin. Het is de kern van waarom het platform zo werkt als het werkt, en het
          bepaalt wat het dossier waard is.
        </p>
        <ul>
          <li>
            <strong>Geen uitzendbureau en geen bemiddelaar.</strong> We wijzen niemand toe,
            onderhandelen niet over tarieven en bemiddelen niet tussen partijen. Een dienst gaat
            naar iedereen die eraan voldoet; wie accepteert, beslist zelf.
          </li>
          <li>
            <strong>Geen werkgever.</strong> Er komt geen arbeidsovereenkomst met MyQare tot stand,
            en ook niet met de instelling via ons. De zorgprofessional werkt als zelfstandige.
          </li>
          <li>
            <strong>Geen partij bij de opdracht.</strong> De overeenkomst over het werk is tussen de
            instelling en de zorgprofessional. Wij staan daarbuiten, ook als er onenigheid over
            ontstaat.
          </li>
          <li>
            <strong>Geen juridisch adviseur.</strong> Het dossier is bewijs van wat er is
            vastgelegd, geen oordeel over de arbeidsrelatie en geen garantie over de fiscale
            behandeling ervan.
          </li>
        </ul>

        <h2 id="account">3. Je account</h2>
        <ul>
          <li>Je geeft juiste gegevens op en houdt ze actueel.</li>
          <li>Een account is persoonlijk; je deelt je inloggegevens niet.</li>
          <li>
            Een zorgprofessional is ingeschreven bij de KvK en beschikt over de kwalificatie die hij
            opgeeft, en waar vereist over een geldige BIG-registratie.
          </li>
          <li>
            Documenten die je uploadt zijn echt en van jou. Een vervalst document is grond voor
            onmiddellijke beëindiging.
          </li>
          <li>Een organisatie wordt geverifieerd voordat zij diensten kan plaatsen.</li>
        </ul>

        <h2 id="diensten">4. Diensten, aannemen en afzeggen</h2>
        <ul>
          <li>
            Een geplaatste dienst is een aanbod. Er ontstaat pas een overeenkomst als een
            zorgprofessional accepteert.
          </li>
          <li>
            Weigeren mag altijd, zonder reden, en heeft geen gevolgen voor toekomstige
            aanbiedingen.
          </li>
          <li>
            Wie als eerste accepteert, heeft de dienst. Andere aanbiedingen vervallen op dat moment.
          </li>
          <li>
            Annuleren kan door beide partijen. De kosten van MyQare worden dan volledig
            terugbetaald, ongeacht wie annuleerde en wanneer. Wat partijen onderling afspreken over
            een gemiste dienst, staat daar los van.
          </li>
        </ul>

        <h2 id="uren">5. Uren en facturen</h2>
        <ul>
          <li>
            De zorgprofessional dient na de dienst de werkelijk gewerkte tijd in. De instelling
            keurt goed of stuurt terug met een reden.
          </li>
          <li>
            Na goedkeuring maakt MyQare de factuur op naam van de zorgprofessional op en stuurt die
            naar de instelling. De zorgprofessional blijft zelf de opsteller van die factuur en
            verantwoordelijk voor zijn eigen aangifte.
          </li>
          <li>
            De btw-behandeling volgt uit wat de zorgprofessional opgeeft over de vrijstelling van
            art. 11 lid 1 sub g Wet OB. Zolang dat niet is vastgesteld, wordt er niet gefactureerd.
          </li>
          <li>
            De instelling betaalt rechtstreeks aan de zorgprofessional. MyQare houdt geen geld van
            partijen onder zich.
          </li>
        </ul>

        <h2 id="kosten">6. Kosten</h2>
        <ul>
          <li>Voor zorginstellingen is MyQare gratis.</li>
          <li>
            Een zorgprofessional betaalt {FEE_PERCENT_LABEL}% van de opdrachtwaarde, plus {VAT_PERCENT_LABEL}%
            btw daarover, per aangenomen dienst. De opdrachtwaarde is het uurtarief maal de
            gewerkte tijd zonder pauze.
          </li>
          <li>
            Dat bedrag wordt bij het accepteren van je saldo afgeschreven en na goedkeuring van de
            uren verrekend met wat er werkelijk gewerkt is.
          </li>
          <li>Bij annulering wordt het volledig teruggeboekt.</li>
          <li>
            Wijzigt het tarief, dan geldt dat alleen voor diensten die daarna worden aangenomen.
          </li>
        </ul>
        <p>
          Zie <Link href="/tarieven">tarieven</Link> voor een rekenvoorbeeld.
        </p>

        <h2 id="dossier">7. Het dossier</h2>
        <p>
          Bij elke aangenomen dienst legt MyQare vast wat er op dat moment gold, en bewaart dat als
          vaste kopie. Beide partijen kunnen dat inzien en exporteren.
        </p>
        <p>
          Het dossier laat zien wat er is vastgelegd. Of een arbeidsrelatie als zelfstandigheid
          kwalificeert, beoordeelt uiteindelijk de Belastingdienst of de rechter aan de hand van de
          feiten. MyQare geeft daarover geen garantie en aanvaardt daarvoor geen aansprakelijkheid.
        </p>

        <h2 id="verantwoordelijk">8. Wie waarvoor verantwoordelijk is</h2>
        <ul>
          <li>
            <strong>De instelling</strong> voor de zorg die zij levert, voor haar verplichtingen
            onder de Wkkgz, en voor het controleren van VOG, diploma en verzekering vóór inzet. Het
            platform maakt die documenten zichtbaar; het kijken blijft aan de instelling.
          </li>
          <li>
            <strong>De zorgprofessional</strong> voor zijn bevoegdheid en bekwaamheid, zijn
            registraties, zijn verzekering en zijn eigen belastingaangifte.
          </li>
          <li>
            <strong>MyQare</strong> voor het correct werken van de software en voor de zorgvuldige
            verwerking van gegevens, zoals beschreven in de{" "}
            <Link href="/privacy">privacyverklaring</Link>.
          </li>
        </ul>

        <h2 id="aansprakelijkheid">9. Aansprakelijkheid</h2>
        <p>
          <strong>Nog vast te stellen.</strong> Een aansprakelijkheidsbeperking is het beding waar
          het bij een geschil op aankomt, en juist dat beding moet kloppen met de verzekering die
          eronder ligt. Hier staat daarom nog geen tekst: een beperking die niet standhoudt, is
          schadelijker dan geen, omdat beide partijen erop hebben gerekend.
        </p>

        <h2 id="beeindigen">10. Beëindigen</h2>
        <ul>
          {/*
            Says how, because there is no button.

            "Je kunt je account op elk moment opzeggen" described a self-service
            flow that does not exist anywhere in the product — and it cannot be a
            simple delete: a Dutch invoice is retained seven years, so
            invoices.freelancer_id now has ON DELETE RESTRICT (migration 025 — it was
            CASCADE, so this comment was false until then) and deleting an account
            that has ever been invoiced fails outright. The AVG answer is
            anonymise-and-retain, which is a process, not a button.

            Until that process is built, the honest statement is the one that
            tells somebody what actually happens when they ask.
          */}
          <li>
            Je kunt je account op elk moment opzeggen door ons een bericht te sturen. Lopende
            opdrachten maak je eerst af. We verwijderen dan je profielgegevens; facturen en
            dossierrecords blijven bewaard zolang de wet dat vraagt, met je naam vervangen door een
            aanduiding die niet naar jou herleidbaar is.
          </li>
          <li>
            Wij kunnen een account opschorten of beëindigen bij misbruik, bij vervalste documenten,
            of als iemand de veiligheid van anderen in gevaar brengt.
          </li>
          <li>
            Na beëindiging blijven facturen en dossierrecords bewaard zolang de wet dat vraagt. Zie
            de <Link href="/privacy">privacyverklaring</Link>.
          </li>
        </ul>

        <h2 id="recht">11. Toepasselijk recht</h2>
        <p>
          Op deze voorwaarden is Nederlands recht van toepassing. Geschillen worden voorgelegd aan
          de bevoegde rechter in Nederland.
        </p>
      </Prose>
    </div>
  );
}
