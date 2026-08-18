import type { Metadata } from "next";
import Link from "next/link";
import { Prose } from "@/components/Prose";

export const metadata: Metadata = {
  title: "Over ons",
  description:
    "Waar MyQare vandaan komt, waarom het is zoals het is, en wat er nog niet af is.",
};

export default function OverOnsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl sm:text-4xl font-bold mb-3">Over MyQare</h1>
      <p className="text-lg mb-10" style={{ color: "var(--text-muted)" }}>
        Waar dit vandaan komt, waarom het zo werkt als het werkt, en wat er nog niet af is.
      </p>

      <Prose>
        <h2>Het begon in 2021</h2>
        <p>
          Het idee komt uit een plan uit 2021: een platform waarop zorginstellingen en zelfstandige
          zorgprofessionals elkaar rechtstreeks vinden, zonder uitzendbureau ertussen dat een marge
          op het uurtarief neemt. Dat plan is toen niet uitgevoerd.
        </p>
        <p>
          Wat er sindsdien is veranderd, maakt het idee eerder urgenter dan minder urgent. De
          personeelstekorten in de zorg zijn niet opgelost. En sinds januari 2025 handhaaft de
          Belastingdienst weer op schijnzelfstandigheid, waarbij uitdrukkelijk wordt gekeken naar
          driehoeksverhoudingen tussen opdrachtgever, zzp&apos;er en tussenpartij.
        </p>
        <p>
          Daarmee verschoof het echte probleem. Niet: hoe vind ik iemand. Maar: hoe laat ik straks
          zien hoe die samenwerking er werkelijk uitzag.
        </p>

        <h2>Waarom het dossier het product is</h2>
        <p>
          De vragen die bij een controle worden gesteld — kon deze persoon weigeren, wie bepaalde
          het tarief, werkte hij ook elders, was er gezag — gaan allemaal over wat er op een
          specifiek moment in het verleden gebeurde.
        </p>
        <p>
          Achteraf zijn ze bijna niet te beantwoorden. Op het moment zelf zijn ze triviaal vast te
          leggen. Dat verschil is het hele product.
        </p>
        <p>
          Daarom staat er ook geen planner tussen die iemand aanwijst, en nemen we geen marge op het
          uurtarief. Niet uit idealisme: zodra wij zouden toewijzen of onderhandelen, zou het
          dossier precies de conclusie ondersteunen die niemand wil.
        </p>

        <h2>Wat er bewust niet is</h2>
        <ul>
          <li>
            <strong>Geen eigen munt of token.</strong> Dat stond in het oorspronkelijke plan en is
            geschrapt. Het loste geen probleem op dat een gewone euro niet oplost, en zou onder MiCA
            een vergunningtraject van honderdduizenden euro&apos;s hebben betekend voor een functie
            die niemand vroeg.
          </li>
          <li>
            <strong>Geen kopieën van identiteitsbewijzen.</strong> Een opdrachtgever mag die van een
            zelfstandige niet bewaren, dus het platform vraagt er niet om. De veiligste manier om
            een paspoortscan te bewaren is hem niet te hebben.
          </li>
          <li>
            <strong>Geen beoordeling die je aanbod beperkt.</strong> Weigeren heeft geen gevolgen.
            Een systeem dat afzeggen bestraft, leert mensen om ziek te komen werken.
          </li>
          <li>
            <strong>Geen volgcookies.</strong> Er valt hier niets te volgen wat ons iets aangaat.
          </li>
        </ul>

        <h2>Waar het staat</h2>
        <p>
          Eerlijk: MyQare is nog niet in gebruik. De planning, urenregistratie, facturatie,
          documentcontrole en dossieropbouw werken en zijn getest, maar er zijn geen instellingen
          live, er is nog geen rechtspersoon ingericht, en de juridische documenten — voorwaarden,
          privacyverklaring en <Link href="/modelovereenkomst">modelovereenkomst</Link> — zijn
          concept.
        </p>
        <p>
          Dat staat er niet als slag om de arm. Het staat er omdat een platform dat met dossiers en
          bewijs adverteert, moeilijk kan beginnen met een onnauwkeurige voorstelling van zichzelf.
        </p>

        <h2>Meepraten</h2>
        <p>
          De vraag die nu het meest openstaat: de zorgprofessional betaalt de kosten en de
          instelling niets. Dat houdt het aanbod compleet, maar de zorgprofessional is
          prijsgevoeliger — en kosten bij de zorgprofessional neerleggen maakt het lastiger vol te
          houden dat de instelling geen tussenpartij inschakelt.
        </p>
        <p>
          Werk je in de zorg, plan je diensten in, of huur je zzp&apos;ers in?{" "}
          <Link href="/contact">Laat weten wat je ervan vindt.</Link>
        </p>
      </Prose>
    </div>
  );
}
