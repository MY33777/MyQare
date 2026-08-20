import type { Metadata } from "next";
import { lookupMessage } from "@/lib/authErrors";
import Link from "next/link";
import { PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { requireFreelancer } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getInvoiceSettings,
  missingInvoiceFields,
  MISSING_FIELD_LABELS,
} from "@/lib/invoiceSettings";
import { formatInvoiceNumber } from "@/lib/invoiceNumber";
import { amsterdamYear } from "@/lib/timezone";
import { saveInvoiceSettingsAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Facturatie" };

const ERRORS: Record<string, string> = {
  bad_prefix: "Een voorvoegsel mag alleen letters, cijfers en streepjes bevatten, maximaal 8 tekens.",
  bad_start: "Het startnummer moet een heel getal van 1 of hoger zijn.",
  bad_term: "De betaaltermijn moet tussen 0 en 120 dagen liggen.",
  bad_iban: "Dit IBAN klopt niet. Controleer of je het volledig hebt overgenomen.",
  bad_vat_number: "Een Nederlands btw-id ziet eruit als NL123456789B01.",
  unknown: "Opslaan is niet gelukt. Probeer het opnieuw.",
};

export default async function FacturatiePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const freelancer = await requireFreelancer("/professional/facturatie");

  const settings = await getInvoiceSettings(freelancer.userId);

  const { data: row } = await getSupabaseAdmin()
    .from("freelancers")
    .select("vat_exempt")
    .eq("profile_id", freelancer.userId)
    .maybeSingle<{ vat_exempt: boolean | null }>();

  const missing = missingInvoiceFields(settings, row?.vat_exempt ?? null);

  // Shown live so the numbering choice is concrete rather than abstract.
  const example = formatInvoiceNumber(
    amsterdamYear(),
    settings.numberStart,
    settings.numberPrefix,
  );

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Facturatie"
        description="MyQare maakt je facturen op en verstuurt ze. Dit zijn de gegevens die erop komen te staan en de instellingen die bepalen hoe dat gebeurt."
      />

      {params.saved ? <FormMessage kind="ok">Opgeslagen.</FormMessage> : null}
      {params.error ? (
        <FormMessage kind="error">{lookupMessage(ERRORS, params.error, ERRORS.unknown)}</FormMessage>
      ) : null}

      {/*
        The blocking notice. Invoicing refuses while a legally required field is
        blank — an invoice without the supplier's address is not a valid invoice
        under art. 35a Wet OB, and once it has gone out under someone's own name
        that cannot be undone by filling in a form afterwards.
      */}
      {missing.length > 0 ? (
        <div
          className="rounded-lg border p-4 mb-6"
          style={{ borderColor: "var(--warn)", background: "var(--warn-subtle)" }}
        >
          <strong className="block mb-1">Er kunnen nog geen facturen worden verstuurd</strong>
          <p className="text-sm mb-2">
            Een factuur moet je naam, adres en — als je btw rekent — je btw-id vermelden. Zolang
            deze velden leeg zijn, worden je uren wel goedgekeurd en je vergoeding wel verrekend,
            maar gaat er geen factuur uit.
          </p>
          <ul className="text-sm list-disc pl-5">
            {missing.map((field) => (
              <li key={field}>{MISSING_FIELD_LABELS[field]}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <form action={saveInvoiceSettingsAction} className="grid gap-6">
        <section className="card p-6">
          <h2 className="font-bold mb-1">Automatisch versturen</h2>
          <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
            Zodra de instelling je uren goedkeurt, maken we de factuur op. Of hij meteen de deur
            uit gaat, bepaal jij.
          </p>

          <label className="flex gap-3 items-start mb-4">
            <input
              type="checkbox"
              name="auto_send"
              defaultChecked={settings.autoSend}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">Verstuur facturen automatisch</span>
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                Uit betekent dat de factuur klaarstaat met nummer en al, en dat jij hem vrijgeeft
                vanuit <Link href="/professional/facturen">Facturen</Link>. Het nummer wordt hoe
                dan ook direct toegekend — een reeks met gaten erin is lastiger uit te leggen dan
                een factuur die een dag later verstuurd wordt.
              </span>
            </span>
          </label>

          <label className="flex gap-3 items-start">
            <input
              type="checkbox"
              name="copy_to_self"
              defaultChecked={settings.copyToSelf}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">Stuur mij een kopie</span>
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                Je krijgt elke verstuurde factuur ook zelf per e-mail.
              </span>
            </span>
          </label>
        </section>

        <section className="card p-6">
          <h2 className="font-bold mb-1">Nummering</h2>
          <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
            De Belastingdienst verwacht per ondernemer één doorlopende reeks. Werk je al met een
            eigen nummering, zet die hier voort in plaats van er een tweede naast te laten lopen.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="number_prefix">
                Voorvoegsel <span style={{ color: "var(--text-muted)" }}>(optioneel)</span>
              </label>
              <input
                className="input"
                id="number_prefix"
                name="number_prefix"
                type="text"
                maxLength={8}
                defaultValue={settings.numberPrefix ?? ""}
                placeholder="bijv. F"
              />
            </div>
            <div>
              <label className="label" htmlFor="number_start">
                Beginnen bij nummer
              </label>
              <input
                className="input tnum"
                id="number_start"
                name="number_start"
                type="number"
                min={1}
                max={999999}
                defaultValue={settings.numberStart}
              />
            </div>
          </div>

          <p className="text-sm mt-3" style={{ color: "var(--text-muted)" }}>
            Je eerstvolgende factuur van dit jaar krijgt dan <strong>{example}</strong>. Het
            startnummer geldt alleen zolang je dit jaar nog niets hebt gefactureerd — een bestaand
            nummer wordt nooit opnieuw gebruikt.
          </p>
        </section>

        <section className="card p-6">
          <h2 className="font-bold mb-1">Je gegevens op de factuur</h2>
          <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
            Jij bent de opsteller van de factuur, niet MyQare. Deze gegevens moeten er dus op staan.
          </p>

          <div className="grid gap-4">
            <div>
              <label className="label" htmlFor="business_name">
                Bedrijfsnaam
              </label>
              <input
                className="input"
                id="business_name"
                name="business_name"
                type="text"
                maxLength={160}
                defaultValue={settings.businessName ?? ""}
                placeholder="bijv. Zorg door Aylin"
              />
              <p className="hint">Laat je dit leeg, dan gebruiken we je eigen naam.</p>
            </div>

            <div>
              <label className="label" htmlFor="address_line">
                Adres
              </label>
              <input
                className="input"
                id="address_line"
                name="address_line"
                type="text"
                maxLength={160}
                defaultValue={settings.addressLine ?? ""}
                placeholder="Straat en huisnummer"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="postcode">
                  Postcode
                </label>
                <input
                  className="input"
                  id="postcode"
                  name="postcode"
                  type="text"
                  maxLength={12}
                  defaultValue={settings.postcode ?? ""}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="city">
                  Plaats
                </label>
                <input
                  className="input"
                  id="city"
                  name="city"
                  type="text"
                  maxLength={80}
                  defaultValue={settings.city ?? ""}
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="vat_number">
                Btw-identificatienummer
              </label>
              <input
                className="input"
                id="vat_number"
                name="vat_number"
                type="text"
                maxLength={20}
                defaultValue={settings.vatNumber ?? ""}
                placeholder="NL123456789B01"
              />
              <p className="hint">
                {row?.vat_exempt
                  ? "Je factureert btw-vrijgesteld volgens artikel 11-1-g, dus dit is niet verplicht."
                  : "Verplicht op een factuur waarop btw wordt gerekend. Niet je omzetbelastingnummer, maar het btw-id dat je mag delen."}
              </p>
            </div>
          </div>
        </section>

        <section className="card p-6">
          <h2 className="font-bold mb-1">Betaling</h2>

          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="payment_term_days">
                  Betaaltermijn in dagen
                </label>
                <input
                  className="input tnum"
                  id="payment_term_days"
                  name="payment_term_days"
                  type="number"
                  min={0}
                  max={120}
                  defaultValue={settings.paymentTermDays}
                />
                <p className="hint">
                  30 dagen is in Nederland gebruikelijk tussen bedrijven. Korter mag, als je het met
                  de instelling afspreekt.
                </p>
              </div>
              <div>
                <label className="label" htmlFor="account_holder">
                  Naam rekeninghouder
                </label>
                <input
                  className="input"
                  id="account_holder"
                  name="account_holder"
                  type="text"
                  maxLength={120}
                  defaultValue={settings.accountHolder ?? ""}
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="iban">
                IBAN
              </label>
              <input
                className="input tnum"
                id="iban"
                name="iban"
                type="text"
                maxLength={42}
                defaultValue={settings.iban ?? ""}
                placeholder="NL00 BANK 0123 4567 89"
              />
            </div>

            <div>
              <label className="label" htmlFor="payment_note">
                Extra tekst op de factuur{" "}
                <span style={{ color: "var(--text-muted)" }}>(optioneel)</span>
              </label>
              <textarea
                className="input"
                id="payment_note"
                name="payment_note"
                rows={3}
                maxLength={500}
                defaultValue={settings.paymentNote ?? ""}
                placeholder="bijv. Graag onder vermelding van uw inkoopordernummer."
              />
            </div>
          </div>
        </section>

        <div>
          <SubmitButton className="btn btn-primary">
            Opslaan
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
