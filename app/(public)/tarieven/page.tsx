import type { Metadata } from "next";
import Link from "next/link";
import { FEE_INCL_VAT_PERCENT_LABEL, FEE_PERCENT_LABEL, VAT_PERCENT_LABEL, calculateFee } from "@/lib/fees";
import { formatEuros } from "@/lib/money";
import { formatMinutes } from "@/lib/hours";

export const metadata: Metadata = {
  title: "Tarieven",
  description:
    `Gratis voor zorginstellingen. Zorgprofessionals betalen ${FEE_PERCENT_LABEL}% van de opdrachtwaarde plus btw per aangenomen dienst. Met rekenvoorbeeld.`,
};


/*
 * Worked through the same function the ledger uses, not typed out by hand.
 *
 * A pricing page that quotes a different number than the one that gets charged is
 * one of the few bugs a customer will always notice and never forgive. Computing
 * the examples here means the page cannot drift from lib/fees.ts — if the rate
 * ever changes, this changes with it.
 */
const EXAMPLES = [
  { label: "Dagdienst", minutes: 8 * 60 - 30, rateCents: 4250 },
  { label: "Avonddienst", minutes: 8 * 60 - 30, rateCents: 4800 },
  { label: "Nachtdienst", minutes: 8 * 60, rateCents: 5200 },
].map((example) => ({ ...example, fee: calculateFee(example.minutes, example.rateCents) }));

export default function TarievenPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <h1 className="text-3xl sm:text-4xl font-bold mb-3">Tarieven</h1>
      <p className="text-lg max-w-2xl mb-10" style={{ color: "var(--text-muted)" }}>
        Eén tarief, alleen bij een aangenomen dienst. Geen abonnement, geen opstartkosten, geen
        marge op het uurtarief.
      </p>

      <div className="grid gap-6 md:grid-cols-2 mb-14">
        <div className="card p-6">
          <h2 className="text-lg font-bold mb-1">Zorginstellingen</h2>
          <p className="text-3xl font-bold mb-3" style={{ color: "var(--brand-text)" }}>
            Gratis
          </p>
          <ul className="text-sm space-y-2" style={{ color: "var(--text-muted)" }}>
            <li>Onbeperkt diensten plaatsen, ook als serie</li>
            <li>Eigen pool met favorieten</li>
            <li>Urenregistratie en goedkeuring</li>
            <li>Dossier zelfstandigheid, exporteerbaar als pdf</li>
            <li>Documentencontrole: VOG, diploma, verzekering, KvK</li>
          </ul>
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-bold mb-1">Zorgprofessionals</h2>
          <p className="text-3xl font-bold mb-1" style={{ color: "var(--brand-text)" }}>
            {FEE_PERCENT_LABEL}%
          </p>
          <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
            van de opdrachtwaarde, plus {VAT_PERCENT_LABEL}% btw over die {FEE_PERCENT_LABEL}% — samen{" "}
            {FEE_INCL_VAT_PERCENT_LABEL}% van de opdrachtwaarde. Alleen bij een dienst die je aanneemt.
          </p>
          <ul className="text-sm space-y-2" style={{ color: "var(--text-muted)" }}>
            <li>Geen kosten als je niets aanneemt</li>
            <li>Volledig terugbetaald als de dienst wordt geannuleerd</li>
            <li>Facturen worden voor je opgemaakt en verstuurd</li>
            <li>De btw op onze kosten is voor jou aftrekbaar als voorbelasting</li>
          </ul>
        </div>
      </div>

      <h2 className="text-2xl font-bold mb-2">Rekenvoorbeeld</h2>
      <p className="max-w-2xl mb-6" style={{ color: "var(--text-muted)" }}>
        De opdrachtwaarde is het uurtarief maal de gewerkte uren, zonder pauze. Onze kosten worden
        van je saldo afgeschreven op het moment dat je de dienst aanneemt, en na goedkeuring van je
        uren verrekend met wat je werkelijk gewerkt hebt.
      </p>

      {/*
        Cards on a phone, the full table from 768px up.

        Eight columns, and the two a reader is actually here for — "Totaal
        kosten" and "Je houdt over" — are the seventh and eighth. At 375px both
        sat off the right edge of a scroll container, so the pricing page
        answered every question except the one somebody came with. Reordering the
        table would have helped the phone and hurt the desktop reading, where the
        left-to-right arithmetic is the point.
      */}
      <div className="grid gap-3 mb-4 md:hidden">
        {EXAMPLES.map((example) => (
          <div key={example.label} className="card p-4">
            <p className="font-semibold">{example.label}</p>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {formatEuros(example.rateCents)} per uur · {formatMinutes(example.minutes)}
            </p>

            <div className="flex items-baseline justify-between gap-4 mt-3">
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                Je houdt over
              </span>
              <span className="text-2xl font-bold tnum">
                {formatEuros(example.fee.assignmentValueCents - example.fee.feeTotalCents)}
              </span>
            </div>

            <dl
              className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mt-3 pt-3"
              style={{ borderTop: "1px solid var(--border)", color: "var(--text-muted)" }}
            >
              <dt>Opdrachtwaarde</dt>
              <dd className="tnum text-right">{formatEuros(example.fee.assignmentValueCents)}</dd>
              <dt>MyQare</dt>
              <dd className="tnum text-right">{formatEuros(example.fee.feeExVatCents)}</dd>
              <dt>Btw</dt>
              <dd className="tnum text-right">{formatEuros(example.fee.feeVatCents)}</dd>
              <dt className="font-medium" style={{ color: "var(--text)" }}>
                Totaal kosten
              </dt>
              <dd className="tnum text-right font-medium" style={{ color: "var(--text)" }}>
                {formatEuros(example.fee.feeTotalCents)}
              </dd>
            </dl>
          </div>
        ))}
      </div>

      <div className="card table-scroll mb-4 hidden md:block" tabIndex={0} role="region" aria-label="Rekenvoorbeeld, horizontaal scrollbaar">
        <table className="table">
          <thead>
            <tr>
              <th>Dienst</th>
              <th>Uurtarief</th>
              <th>Gewerkt</th>
              <th>Opdrachtwaarde</th>
              <th>MyQare</th>
              <th>Btw</th>
              <th>Totaal kosten</th>
              <th>Je houdt over</th>
            </tr>
          </thead>
          <tbody>
            {EXAMPLES.map((example) => (
              <tr key={example.label}>
                <td className="font-medium">{example.label}</td>
                <td>{formatEuros(example.rateCents)}</td>
                <td>{formatMinutes(example.minutes)}</td>
                <td>{formatEuros(example.fee.assignmentValueCents)}</td>
                <td>{formatEuros(example.fee.feeExVatCents)}</td>
                <td>{formatEuros(example.fee.feeVatCents)}</td>
                <td className="font-medium">{formatEuros(example.fee.feeTotalCents)}</td>
                <td className="font-medium">
                  {formatEuros(example.fee.assignmentValueCents - example.fee.feeTotalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm max-w-2xl mb-14" style={{ color: "var(--text-muted)" }}>
        &ldquo;Je houdt over&rdquo; is voor btw op je eigen factuur aan de instelling. Verleen je
        btw-vrijgestelde zorg volgens artikel 11-1-g Wet OB, dan factureer je zonder btw en is de
        btw op onze kosten voor jou niet aftrekbaar; die {VAT_PERCENT_LABEL}% is dan een echte kostenpost.
        MyQare houdt bij welke van de twee op jou van toepassing is en past de factuur daarop aan.
      </p>

      <h2 className="text-2xl font-bold mb-4">Wat het niet is</h2>
      <div className="grid gap-6 sm:grid-cols-3 mb-14">
        <div>
          <h3 className="font-bold mb-1">Geen marge op je uurtarief</h3>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Het tarief dat de instelling plaatst is het tarief dat je factureert. We zitten er niet
            tussen en verdienen niets aan het verschil, want er is geen verschil.
          </p>
        </div>
        <div>
          <h3 className="font-bold mb-1">Geen bemiddeling</h3>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            We wijzen niemand toe, onderhandelen niet en sturen niemand aan. Dat is niet alleen een
            keuze in het verdienmodel — het is precies waarom het dossier iets waard is.
          </p>
        </div>
        <div>
          <h3 className="font-bold mb-1">Geen exclusiviteit</h3>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Je mag overal anders werken, ook rechtstreeks bij dezelfde instelling. Er zit geen
            concurrentiebeding of afnamebeding aan vast.
          </p>
        </div>
      </div>

      <div className="rounded-xl p-8" style={{ background: "var(--brand-subtle)" }}>
        <h2 className="text-xl font-bold mb-2">Waarom betaalt de instelling niets?</h2>
        <p className="max-w-3xl mb-4">
          Omdat een instelling die per plaatsing betaalt een reden krijgt om buiten het systeem om
          te werken, en dan verdwijnt precies de vastlegging waar het om gaat. Een dossier met
          gaten erin is minder waard dan geen dossier, want de gaten zitten altijd bij de
          opdrachten waar iemand liever niet aan herinnerd wordt.
        </p>
        <p className="max-w-3xl text-sm" style={{ color: "var(--text-muted)" }}>
          Of dit het juiste model is, staat nog open: de zorgprofessional is prijsgevoeliger dan de
          instelling, en kosten bij de zorgprofessional neerleggen maakt het lastiger vol te houden
          dat de instelling geen bemiddelaar inschakelt. <Link href="/contact">Laat weten</Link> wat
          je ervan vindt — dat weegt mee.
        </p>
      </div>
    </div>
  );
}
