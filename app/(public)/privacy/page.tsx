import type { Metadata } from "next";
import Link from "next/link";
import { Prose, DraftNotice, LastUpdated } from "@/components/Prose";

export const metadata: Metadata = {
  title: "Privacyverklaring",
  description:
    "Welke persoonsgegevens MyQare verwerkt, waarom, op welke grondslag en hoe lang. Opgesteld aan de hand van wat de software feitelijk opslaat.",
};

/*
 * Written against the actual database, table by table, not from a template.
 *
 * A privacy statement's only real failure mode is describing a system that isn't
 * the one running. Everything below was checked against supabase/schema.sql —
 * where it says a field is stored, there is a column; where it says something is
 * not collected, there is no column for it.
 *
 * Marked as a draft because it is one. It describes the software correctly, and
 * still needs a lawyer to check the conclusions before anyone relies on it.
 */

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl sm:text-4xl font-bold mb-3">Privacyverklaring</h1>
      <LastUpdated date="19 augustus 2026" />

      <DraftNotice>
        Deze verklaring is opgesteld aan de hand van wat de software feitelijk opslaat en beschrijft
        het systeem correct. De juridische conclusies erin — met name de grondslagen en de
        bewaartermijnen — zijn nog niet door een jurist getoetst. MyQare is nog niet in gebruik voor
        echte opdrachten. Zodra dat verandert, wordt deze tekst eerst vastgesteld.
      </DraftNotice>

      <Prose>
        <p>
          MyQare is een platform waarop zorginstellingen diensten aanbieden aan zelfstandige
          zorgprofessionals. Daarvoor verwerken we persoonsgegevens. Hieronder staat welke, waarom,
          op welke grondslag en hoe lang we ze bewaren.
        </p>

        <h2 id="verwerkingsverantwoordelijke">1. Wie is verantwoordelijk</h2>
        <p>
          MyQare is verwerkingsverantwoordelijke voor de gegevens die op het platform worden
          verwerkt. De contactgegevens staan op de <Link href="/contact">contactpagina</Link>.
        </p>
        <p>
          <strong>Nog vast te stellen:</strong> de statutaire naam, het KvK-nummer en het
          vestigingsadres van de rechtspersoon achter MyQare, en of er een functionaris voor de
          gegevensbescherming wordt aangesteld. Er staat hier bewust geen plaatsvervangend gegeven —
          een onjuiste vermelding van de verantwoordelijke is erger dan een ontbrekende, omdat
          niemand dan weet bij wie hij zijn rechten moet uitoefenen.
        </p>

        <h2 id="gegevens">2. Welke gegevens we verwerken</h2>

        <h3>Van iedereen met een account</h3>
        <ul>
          <li>E-mailadres en wachtwoord (het wachtwoord versleuteld, wij kunnen het niet inzien)</li>
          <li>Naam</li>
          <li>Rol: zorgprofessional, beheerder van een zorginstelling, of medewerker van MyQare</li>
          <li>Telefoonnummer, als je dat invult</li>
        </ul>

        <h3>Van zorgprofessionals</h3>
        <ul>
          <li>KvK-nummer</li>
          <li>BIG-nummer, als je een BIG-geregistreerd beroep uitoefent</li>
          <li>Kwalificatie en eventuele specialisaties</li>
          <li>Regio waarin je werkt</li>
          <li>Minimumuurtarief en een eigen omschrijving</li>
          <li>Of je btw-vrijgestelde zorg verleent, en op welke grond</li>
          <li>Momenten waarop je niet beschikbaar bent</li>
          <li>
            Documenten: VOG, diploma&apos;s, certificaten, beroepsaansprakelijkheidsverzekering en
            KvK-uittreksel
          </li>
        </ul>

        <h3>Voor het opmaken van je facturen</h3>
        <p>
          Als zelfstandige ben jij de opsteller van de factuur; wij maken hem namens jou op. Daarvoor
          moeten je eigen gegevens erop staan (artikel 35a Wet OB). Je vult ze zelf in bij Facturatie:
        </p>
        <ul>
          <li>Bedrijfsnaam, adres, postcode en plaats</li>
          <li>Btw-identificatienummer, als je btw in rekening brengt</li>
          <li>IBAN en de naam van de rekeninghouder</li>
          <li>Je nummerreeks, betaaltermijn en een eventuele vaste tekst op de factuur</li>
        </ul>
        <p>
          Deze gegevens zijn alleen zichtbaar voor jou en voor medewerkers van MyQare. Ze komen op de
          facturen die namens jou naar een zorginstelling gaan — dat is het doel ervan — maar een
          instelling kan ze niet los opvragen.
        </p>

        <h3>Van zorginstellingen</h3>
        <ul>
          <li>Naam, KvK-nummer, adres en facturatie-e-mailadres van de organisatie</li>
          <li>Naam en contactgegevens van de beheerders</li>
        </ul>

        <h3>Uit het gebruik van het platform</h3>
        <ul>
          <li>Geplaatste diensten en aan wie ze zijn aangeboden</li>
          <li>Welke aanbiedingen zijn geaccepteerd of geweigerd, en wanneer</li>
          <li>Ingediende en goedgekeurde uren</li>
          <li>Facturen, betaalstatus en het saldo-overzicht</li>
          <li>Onderlinge beoordelingen na afloop van een opdracht</li>
          <li>
            Het dossierrecord per opdracht: een kopie van de bovenstaande gegevens zoals ze eruit
            zagen op het moment van accepteren
          </li>
          <li>
            Technische gegevens om misbruik tegen te gaan: een teller per e-mailadres van het aantal
            inlogpogingen, wachtwoordherstel-verzoeken en contactformulieren binnen een kort
            tijdvenster. Bij inloggen, wachtwoordherstel en het contactformulier tellen we ook per IP-adres,
            zodat één machine die adressen afgaat niet iedereen achter hetzelfde adres kan
            buitensluiten. Zowel het e-mailadres als het IP-adres worden daarbij eerst door een
            eenrichtingsfunctie gehaald: in de tabel staat een onleesbare code, geen adres. Die
            tellers worden na twee dagen verwijderd.
          </li>
        </ul>

        <h3 id="niet">Wat we uitdrukkelijk niet verwerken</h3>
        <ul>
          <li>
            <strong>Geen kopieën van identiteitsbewijzen.</strong> Een opdrachtgever mag van een
            zelfstandige geen kopie van een paspoort of ID-kaart bewaren, en het BSN daarop mag
            alleen worden verwerkt waar de wet dat voorschrijft. Het platform vraagt er niet om en
            kan ze niet opslaan.
          </li>
          <li>
            <strong>Geen burgerservicenummers.</strong> Er is geen veld voor.
          </li>
          <li>
            <strong>Geen patiëntgegevens.</strong> MyQare gaat over de inzet van personeel, niet
            over zorg aan cliënten. Er is nergens ruimte om iets over een cliënt vast te leggen.
          </li>
          <li>
            <strong>Geen volgcookies en geen advertentienetwerken.</strong> Zie hieronder bij
            cookies.
          </li>
        </ul>

        <h2 id="grondslagen">3. Waarom, en op welke grondslag</h2>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Doel</th>
                <th>Grondslag</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Een account aanmaken en toegang geven</td>
                <td>Uitvoering van de overeenkomst (art. 6 lid 1 sub b AVG)</td>
              </tr>
              <tr>
                <td>Diensten tonen die bij je kwalificatie en regio passen</td>
                <td>Uitvoering van de overeenkomst</td>
              </tr>
              <tr>
                <td>Uren vastleggen, facturen opmaken en versturen</td>
                <td>Uitvoering van de overeenkomst</td>
              </tr>
              <tr>
                <td>Facturen bewaren voor de fiscale bewaarplicht</td>
                <td>Wettelijke verplichting (art. 6 lid 1 sub c AVG, art. 52 AWR)</td>
              </tr>
              <tr>
                <td>De instelling een VOG en diploma laten controleren vóór inzet</td>
                <td>Wettelijke verplichting van de instelling (Wkkgz)</td>
              </tr>
              <tr>
                <td>Het dossier zelfstandigheid opbouwen</td>
                <td>
                  Gerechtvaardigd belang (art. 6 lid 1 sub f AVG): beide partijen moeten kunnen
                  aantonen hoe de opdracht tot stand kwam
                </td>
              </tr>
              <tr>
                <td>Misbruik en fraude tegengaan</td>
                <td>Gerechtvaardigd belang</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Een BIG-nummer is een openbaar registratiegegeven en geen gezondheidsgegeven over jou als
          persoon. Een VOG zegt niets over strafrechtelijke gegevens zelf — het is een verklaring
          dat er geen bezwaar is — en wordt daarom verwerkt als gewoon persoonsgegeven.
        </p>

        <h2 id="delen">4. Met wie we gegevens delen</h2>
        <p>Wat een ander te zien krijgt, hangt af van de relatie:</p>
        <ul>
          <li>
            <strong>Een zorginstelling</strong> ziet van haar eigen poolleden de naam, kwalificatie,
            regio, het minimumtarief en de goedgekeurde documenten. Het telefoonnummer pas zodra er
            een lopende opdracht is.
          </li>
          <li>
            <strong>Een zorgprofessional</strong> ziet van een instelling de naam, locatie en de
            gegevens van de dienst.
          </li>
          <li>
            <strong>Andere zorgprofessionals</strong> zien elkaar niet. Wie nog meer een aanbieding
            kreeg, is niet zichtbaar.
          </li>
          <li>
            <strong>Medewerkers van MyQare</strong> kunnen documenten inzien om ze te beoordelen en
            organisaties te verifiëren.
          </li>
        </ul>
        <p>
          Verder schakelen we verwerkers in: Supabase voor database en bestandsopslag, Vercel voor
          hosting, Resend voor e-mail en Stripe voor betalingen. Met elk van hen hoort een
          verwerkersovereenkomst te liggen. <strong>Nog te regelen:</strong> die overeenkomsten zijn
          nog niet gesloten, en per verwerker moet worden vastgelegd waar de gegevens staan.
        </p>

        <h2 id="bewaren">5. Hoe lang we bewaren</h2>
        <ul>
          <li>
            <strong>Facturen en de bijbehorende opdrachtgegevens: zeven jaar.</strong> Dat is een
            fiscale bewaarplicht. Een verzoek om verwijdering gaat daar niet voor.
          </li>
          <li>
            <strong>Het dossier zelfstandigheid: zeven jaar</strong>, om dezelfde reden — het hoort
            bij de opdracht waarop de factuur ziet.
          </li>
          <li>
            <strong>Documenten zoals VOG en verzekering:</strong> tot ze verlopen of tot je ze
            verwijdert, en niet langer dan nodig voor de opdrachten waarvoor ze golden.
          </li>
          <li>
            <strong>Profiel- en factuurgegevens:</strong> zolang je account bestaat. Je
            factuurinstellingen worden bewaard omdat elke volgende factuur ze nodig heeft; de
            gegevens zoals ze op een reeds verstuurde factuur staan, vallen onder de bewaarplicht
            hierboven en veranderen niet meer mee als je ze later aanpast.
          </li>
          <li>
            <strong>Technische gegevens tegen misbruik:</strong> kort, hooguit enkele dagen.
          </li>
        </ul>
        <p>
          Omdat facturen zeven jaar bewaard moeten blijven, kan een account met opdrachten niet
          zomaar worden gewist. In plaats daarvan anonimiseren we je profiel. Weg gaan: je
          documenten (uit de opslag én uit onze administratie), je telefoonnummer, je adres, je
          IBAN, je beschikbaarheid en je poollidmaatschappen. Je e-mailadres wordt vervangen door
          een adres dat nergens heen gaat, je wachtwoord wordt onbruikbaar gemaakt en het account
          wordt geblokkeerd, zodat inloggen niet meer kan en je oude adres weer vrij is voor een
          nieuwe registratie. In je profiel komt &quot;Verwijderd account&quot; te staan.
        </p>
        <p>
          {/*
            Said plainly, because the two documents used to promise the opposite.
            The terms said the retained records carry "een aanduiding die niet
            naar jou herleidbaar is" and this page said the name is replaced
            "overal" — while the dossier export deliberately prefers the name
            captured at acceptance, precisely so anonymising does not blank it.
            The code is right and the promise was wrong: evidence about a named
            person that no longer names them is not evidence.
          */}
          <strong>Wat wél blijft staan, met je naam erin:</strong> de facturen die op jouw naam zijn
          uitgegeven, en de dossierrecords van de opdrachten die je hebt gedaan — met de gegevens
          zoals ze destijds zijn vastgelegd. Dat is bewust. Een factuur zonder leverancier voldoet
          niet aan de wet (art. 35a Wet OB), en een zorginstelling moet onder de Wkkgz kunnen laten
          zien wíe er gewerkt heeft en dat zijn papieren waren gecontroleerd. Die records zijn
          daarmee ook het bewijs van de instelling over zichzelf, en niet alleen gegevens over jou.
          Ze zijn niet zichtbaar voor andere zorgprofessionals en niet voor instellingen waar je
          niet hebt gewerkt.
        </p>
        <p>
          Er is geen knop voor: je vraagt het aan via <Link href="/contact">contact</Link>, en wij
          voeren het uit. Staan er nog opdrachten open die niet gefactureerd zijn, dan gaan die
          facturen eerst uit — anders zou je onbetaald blijven voor werk dat je hebt gedaan.
        </p>

        <h2 id="rechten">6. Je rechten</h2>
        <p>
          Je hebt recht op inzage, correctie, verwijdering, beperking, overdraagbaarheid en bezwaar.
          Je kunt die uitoefenen via de <Link href="/contact">contactpagina</Link>. We reageren
          binnen een maand.
        </p>
        <p>
          Waar een bewaarplicht geldt, kunnen we niet verwijderen — dan beperken we het gebruik tot
          wat de wet vraagt en laten we weten wat er is blijven staan en waarom.
        </p>
        <p>
          Ben je het oneens met hoe we ermee omgaan, dan kun je klagen bij de Autoriteit
          Persoonsgegevens.
        </p>

        <h2 id="cookies">7. Cookies</h2>
        <p>
          MyQare gebruikt alleen cookies die nodig zijn om de site te laten werken: een cookie dat
          je ingelogd houdt en een voorkeur voor het lichte of donkere thema. Daar is geen
          toestemming voor nodig, en daarom is er geen cookiebanner.
        </p>
        <p>
          Er staan geen analyse-, advertentie- of volgcookies op de site, en er worden geen
          gegevens naar advertentienetwerken gestuurd. Mocht daar ooit iets bijkomen, dan komt er
          eerst een toestemmingsvraag en wordt deze verklaring aangepast.
        </p>

        <h2 id="beveiliging">8. Beveiliging</h2>
        <p>
          Verkeer loopt over TLS. Documenten staan in een afgeschermde opslag die niet publiek
          bereikbaar is; een bestand kan alleen worden geopend via een tijdelijke link die per keer
          wordt aangemaakt voor iemand die het mag zien. Toegang tot gegevens wordt in de database
          zelf afgedwongen, per rol en per relatie, en niet alleen in de schermen.
        </p>

        <h2 id="wijzigingen">9. Wijzigingen</h2>
        <p>
          Verandert er iets wezenlijks, dan passen we deze verklaring aan en vermelden we de datum
          bovenaan. Bij ingrijpende wijzigingen krijg je bericht.
        </p>
      </Prose>
    </div>
  );
}
