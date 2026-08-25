import type { Metadata } from "next";
import { lookupMessage } from "@/lib/authErrors";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { qualificationLabel } from "@/lib/qualifications";
import { requireFreelancer } from "@/lib/auth";
import { forEachPage } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";
import { formatEuros } from "@/lib/money";
import { formatDate } from "@/lib/hours";
import { byQuarter, summariseEarnings, summariseReceivables } from "@/lib/earnings";
import { amsterdamDateKey } from "@/lib/timezone";
import { SubmitButton } from "@/components/SubmitButton";
import {
  issueInvoiceAction,
  regenerateInvoicePdfAction,
  sendInvoiceAction,
} from "@/app/professional/facturatie/actions";

export const metadata: Metadata = { title: "Facturen" };

/**
 * A completed assignment, for the "approved but never invoiced" check.
 *
 * `invoices` is an OBJECT, not an array. invoices.assignment_id is UNIQUE, so
 * PostgREST infers one-to-one. Typed as an array, `.length` was undefined, `?? 0`
 * made it 0, and every approved assignment — invoiced or not — matched the "no
 * invoice yet" filter forever. The exact mirror of migration 008, where DROPPING
 * a unique constraint flipped an embed the other way.
 */
type BlockedRow = {
  id: string;
  status: string;
  shifts: { starts_at: string; profession: string } | null;
  timesheets: { approved_at: string | null } | null;
  invoices: { id: string } | null;
};

type InvoiceRow = {
  id: string;
  number: string;
  issued_on: string;
  due_on: string;
  paid_at: string | null;
  sent_at: string | null;
  pdf_path: string | null;
  amount_ex_vat_cents: number;
  vat_amount_cents: number;
  total_cents: number;
  vat_treatment: string;
  organisations: { name: string } | null;
};

const VAT_LABELS: Record<string, string> = {
  exempt_medical: "Vrijgesteld",
  standard_21: "21% btw",
  undetermined: "Onbepaald",
};

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  // "warn" is for something that needs the reader to act but is not a failure:
   // an invoice waiting to be sent is theirs to send, not a client paying late.
   tone?: "danger" | "warn" | "muted";
}) {
  return (
    <div className="card p-4">
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p
        className="text-2xl font-bold tnum mt-1"
        style={
          tone === "danger"
            ? { color: "var(--danger)" }
            : tone === "warn"
              ? { color: "var(--warn)" }
              : undefined
        }
      >
        {value}
      </p>
      {hint ? (
        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}


const MESSAGES: Record<string, string> = {
  already_sent: "Deze factuur was al verstuurd.",
  no_billing_email: "De instelling heeft geen factuuradres ingesteld. Neem contact met hen op.",
  send_failed: "Versturen is niet gelukt. Probeer het zo opnieuw.",
  invoice_details_missing:
    "Je factuurgegevens zijn nog niet compleet. Vul ze aan bij Facturatie, dan kan de factuur alsnog de deur uit.",
  vat_undetermined:
    "Je btw-behandeling is nog niet vastgesteld. Geef bij Profiel aan of je btw-vrijgestelde zorg verleent.",
  pdf_failed:
    "De pdf kon niet worden gemaakt. De factuur zelf is gewoon geldig — probeer het " +
    "zo opnieuw, of neem contact op als het blijft misgaan.",
  unknown: "Er ging iets mis. Probeer het opnieuw.",
};

export default async function FreelancerInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; issued?: string; error?: string; pdf?: string }>;
}) {
  const params = await searchParams;
  const { userId } = await requireFreelancer("/professional/facturen");
  const supabase = await createClient();

  const now = new Date();

  /*
   * PAGED, not capped.
   *
   * Turnover, the per-quarter VAT table and the receivables are all summed from
   * this list, so a short read silently understates every one of them — and this
   * is the page somebody files an aangifte from.
   *
   * It asked for INVOICE_CAP rows in one go and reported truncation when the
   * result reached that number. The comment above that guard explained, correctly,
   * that PostgREST returns fewer rows than requested when the project max-rows is
   * lower, with no error — and then implemented the guard it had just described as
   * unable to fire. With Supabase's default max-rows of 1000 against a cap of 2000
   * it could not: a freelancer with 1200 invoices got 1000 rows, no banner, and a
   * confident understated total. lib/pagination.ts exists for exactly this and was
   * two imports away.
   */
  const invoices: InvoiceRow[] = [];
  const blocked: BlockedRow[] = [];

  const [invoicesComplete, { data: upcoming, error: upcomingError }, blockedComplete] =
    await Promise.all([
      forEachPage<InvoiceRow>(
        (from, to) =>
          supabase
            .from("invoices")
            .select(
              "id, number, issued_on, due_on, paid_at, sent_at, pdf_path, amount_ex_vat_cents, vat_amount_cents, total_cents, vat_treatment, organisations(name)",
            )
            .eq("freelancer_id", userId)
            // A deterministic order, because .range() over an ambiguous one can
            // return the same row on two pages — which for a SUM means counting
            // an invoice twice. id breaks ties on a shared issue date.
            .order("issued_on", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to)
            .returns<InvoiceRow[]>(),
        (rows) => invoices.push(...rows),
        { label: "facturen" },
      ),
      // Accepted but not yet invoiced — an expectation, not a receivable.
      supabase
      .from("assignments")
      .select("agreed_rate_cents, agreed_break_minutes, status, shifts(starts_at, ends_at)")
      .eq("freelancer_id", userId)
      .eq("status", "confirmed")
      .gte("shifts.starts_at", now.toISOString())
      .returns<
        {
          agreed_rate_cents: number;
          agreed_break_minutes: number;
          status: string;
          shifts: { starts_at: string; ends_at: string } | null;
        }[]
      >(),
    /*
     * Approved work with no invoice — paged, for the same reason the invoices
     * above are.
     *
     * createInvoiceForAssignment refuses while the legally required fields are
     * blank (art. 35a Wet OB). The fee has already settled and the hours are
     * approved by then, so without this the work simply vanished: it left the
     * facility's queue, no code path retried, and the only person who could fix
     * it was never told. Round 3 found the same shape in the invoice-number race.
     *
     * This was an unbounded select, and the sweep that paged the invoices then
     * wrote a comment justifying leaving it alone: "what is left here is the two
     * smaller lists beside them". Completed assignments are not a smaller list.
     * Approval is what creates both an assignment's completion and its invoice,
     * so the two grow at exactly the same rate — a freelancer with 1,200 invoices
     * has 1,200 completed assignments, and PostgREST truncates at max-rows with
     * no error and in whatever order the planner picks.
     *
     * The one that falls off the end is the one that matters: an assignment whose
     * invoice was blocked never appears in `uninvoiced`, so the orange banner
     * never lists it and the "Factuur opmaken" button — the only route to issuing
     * it — is never rendered. The 1,5% fee was taken at acceptance and the work is
     * billed to nobody, permanently, with no banner because there was no error.
     */
    forEachPage<BlockedRow>(
      (from, to) =>
        supabase
          .from("assignments")
          .select("id, status, shifts(starts_at, profession), timesheets(approved_at), invoices(id)")
          .eq("freelancer_id", userId)
          .eq("status", "completed")
          // Deterministic, so .range() cannot hand back the same row twice.
          .order("id", { ascending: false })
          .range(from, to)
          .returns<BlockedRow[]>(),
      (rows) => blocked.push(...rows),
      { label: "goedgekeurd werk zonder factuur" },
    ),
  ]);

  // Approved, and nothing issued for it.
  const uninvoiced = blocked.filter((row) => row.timesheets?.approved_at && !row.invoices);

  const booked = (upcoming ?? [])
    .filter((row) => row.shifts)
    .map((row) => ({
      minutes: Math.max(
        0,
        Math.round(
          (new Date(row.shifts!.ends_at).getTime() - new Date(row.shifts!.starts_at).getTime()) /
            60_000,
        ) - row.agreed_break_minutes,
      ),
      rateCents: row.agreed_rate_cents,
    }));

  /*
   * A failed read is not a year with no turnover.
   *
   * All three selects discarded their error, so every figure on this page —
   * turnover ex VAT, VAT charged, receivables, and the per-quarter taxed/exempt
   * split somebody files their aangifte from — was summed from `?? []`. A
   * database blip produced a complete, confident, all-zero screen with nothing
   * saying the data could not be loaded. /zorginstelling/uren guards the
   * identical shape explicitly; this page did not.
   *
   * The invoices and the completed assignments are both paged now, and their
   * completeness is carried separately below — this flag is for the one query
   * that is genuinely bounded: work accepted but not yet worked.
   */
  const loadFailed = Boolean(upcomingError);

  /*
   * forEachPage returns false when a page errored or the runaway ceiling was
   * hit, having already handed over the pages before it. Either way the totals
   * below are summed from a prefix, which on this page must never be presented
   * as a year.
   */
  const incomplete = !invoicesComplete || !blockedComplete;

  const earnings = summariseEarnings(invoices, booked);
  const receivables = summariseReceivables(invoices, now);
  const quarters = byQuarter(invoices);

  return (
    <>
      <PageHeader
        title="Facturen"
        description="Automatisch opgemaakt op jouw naam zodra de instelling je uren goedkeurt."
      />

      {/*
        This page took no searchParams at all, so sendInvoiceAction's redirect
        carried a result nothing rendered: a failed send looked identical to a
        successful one, and the Versturen button was still there, inviting a
        retry that would send it twice.
      */}
      {incomplete ? (
        <FormMessage kind="error">
          Niet alle facturen konden worden geladen, dus de bedragen hieronder zijn niet compleet.
          Ververs de pagina — gebruik ze niet voor je aangifte zolang deze melding er staat.
        </FormMessage>
      ) : null}
      {/*
        The upcoming and blocked lists, which are their own queries. The invoices
        themselves are covered by the banner above; this one used to have a third
        branch for truncation, keyed on a count that could not reach its own cap.
      */}
      {loadFailed ? (
        <FormMessage kind="warn">
          Het overzicht van nog te factureren opdrachten kon niet worden geladen. Je facturen
          hieronder kloppen wel.
        </FormMessage>
      ) : null}

      {params.sent ? <FormMessage kind="ok">Factuur verstuurd.</FormMessage> : null}
      {params.pdf ? (
        <FormMessage kind="ok">Pdf gemaakt. Je kunt de factuur nu downloaden.</FormMessage>
      ) : null}
      {params.issued === "sent" ? (
        <FormMessage kind="ok">Factuur opgemaakt en verstuurd.</FormMessage>
      ) : null}
      {params.issued === "held" ? (
        <FormMessage kind="ok">
          Factuur opgemaakt. Hij staat klaar met nummer en al — verstuur hem hieronder wanneer je
          hem hebt nagekeken.
        </FormMessage>
      ) : null}
      {/*
        Opgemaakt, maar niet aangekomen — een derde uitkomst, en de enige waarbij
        de zorgprofessional iets moet doen dat ze zonder deze melding niet weet.
        Dit viel eerder onder "opgemaakt en verstuurd": ze wachtte op een betaling
        die niemand was gevraagd te doen, en de herinneringscron slaat een factuur
        zonder sent_at over.
      */}
      {params.issued === "undelivered" ? (
        <FormMessage kind="warn">
          Factuur opgemaakt, maar niet aangekomen bij de zorginstelling. Controleer of zij een
          factuuradres hebben ingevuld en verstuur hem hieronder opnieuw.
        </FormMessage>
      ) : null}
      {params.error ? (
        <FormMessage kind="error">{lookupMessage(MESSAGES, params.error, MESSAGES.unknown)}</FormMessage>
      ) : null}

      {/*
        Approved work with no invoice, and a way out of it.

        The issuing gate refuses while the legally required fields are blank, and
        the approval and the fee settle regardless — so this used to be a silent
        dead end for the only person who could resolve it.
      */}
      {uninvoiced.length > 0 ? (
        <div
          className="rounded-lg border p-4 mb-6"
          style={{ borderColor: "var(--warn)", background: "var(--warn-subtle)" }}
        >
          <strong className="block mb-1">
            {uninvoiced.length === 1
              ? "Voor één goedgekeurde dienst is nog geen factuur opgemaakt"
              : `Voor ${uninvoiced.length} goedgekeurde diensten is nog geen factuur opgemaakt`}
          </strong>
          <p className="text-sm mb-3">
            Dat komt bijna altijd doordat je factuurgegevens nog niet compleet zijn. Vul ze aan bij{" "}
            <Link href="/professional/facturatie">Facturatie</Link> en maak de factuur daarna
            alsnog op — je uren en je vergoeding staan al vast.
          </p>
          <div className="grid gap-2">
            {uninvoiced.map((row) => (
              <form key={row.id} action={issueInvoiceAction} className="flex gap-3 items-center">
                <input type="hidden" name="assignment_id" value={row.id} />
                <span className="text-sm flex-1">
                  {qualificationLabel(row.shifts?.profession)} —{" "}
                  {row.shifts ? formatDate(row.shifts.starts_at) : "—"}
                </span>
                <button className="btn btn-primary" type="submit">
                  Factuur opmaken
                </button>
              </form>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        {/* Net of VAT: the btw is never the freelancer's money, and calling gross
            "verdiend" invites someone to spend what they owe onward. */}
        <Stat
          label="Omzet excl. btw"
          value={formatEuros(earnings.turnoverExVatCents)}
          hint={`${earnings.invoiceCount} ${earnings.invoiceCount === 1 ? "factuur" : "facturen"}`}
        />
        <Stat
          label="Btw in rekening gebracht"
          value={formatEuros(earnings.vatChargedCents)}
          hint="Draag je af, niet van jou"
        />
        {/*
          "Openstaand" now means sent and unpaid, which is what the word means to
          the person reading it. Invoices still held for review used to be in this
          figure and went red as "te laat" once their due date passed — for a
          document the facility had never been sent. See summariseReceivables.
        */}
        <Stat
          label="Openstaand"
          value={formatEuros(receivables.outstandingCents)}
          hint={
            receivables.overdueCount > 0
              ? `incl. btw · waarvan ${formatEuros(receivables.overdueCents)} te laat`
              : "incl. btw · alles binnen termijn"
          }
          tone={receivables.overdueCount > 0 ? "danger" : undefined}
        />
        {receivables.unsentCount > 0 ? (
          <Stat
            label="Nog te versturen"
            value={formatEuros(receivables.unsentCents)}
            hint={
              receivables.unsentCount === 1
                ? "1 factuur wacht op jou"
                : `${receivables.unsentCount} facturen wachten op jou`
            }
            tone="warn"
          />
        ) : null}
        {/*
          The basis, said on each figure.

          "Openstaand" is what a facility owes — the invoice total, VAT included.
          "Ingepland" is work not yet done, so there is no invoice and no VAT yet;
          it is the freelancer's own turnover. Two amounts side by side on
          different bases, both bare, invited exactly the wrong comparison.
        */}
        <Stat
          label="Ingepland"
          value={formatEuros(earnings.bookedCents)}
          hint="Aangenomen, nog niet gewerkt · excl. btw"
        />
      </div>

      {quarters.length > 0 ? (
        <div className="card p-4 mb-6">
          <h2 className="font-bold mb-1">Per kwartaal</h2>
          {/*
            Quarters rather than months: that is the btw-aangifte cycle, and a
            month view would make someone add it up themselves four times a year.

            Belast and vrijgesteld are separate columns because the aangifte has
            separate boxes for them. One combined turnover figure — which is what
            this showed — belongs in neither, so anybody filing from this table had
            to go back through the invoices by hand.
          */}
          <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
            Belaste omzet gaat in rubriek 1a van je aangifte. Vrijgestelde zorg (art. 11-1-g)
            hoort daar niet bij.
          </p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
            <table className="table">
              <thead>
                <tr>
                  <th>Kwartaal</th>
                  <th>Belast excl. btw</th>
                  <th>Btw</th>
                  <th>Vrijgesteld</th>
                  <th>Totaal excl. btw</th>
                </tr>
              </thead>
              <tbody>
                {quarters.map((quarter) => (
                  <tr key={quarter.label}>
                    <td className="font-medium tnum">{quarter.label}</td>
                    <td className="tnum">{formatEuros(quarter.taxedExVatCents)}</td>
                    <td className="tnum">{formatEuros(quarter.vatCents)}</td>
                    <td className="tnum">{formatEuros(quarter.exemptExVatCents)}</td>
                    <td className="tnum font-semibold">{formatEuros(quarter.exVatCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <form action="/professional/facturen/export" method="get" className="card p-4 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="from">
              Vanaf
            </label>
            <input className="input" id="from" name="from" type="date" />
          </div>
          <div>
            <label className="label" htmlFor="to">
              Tot en met
            </label>
            <input className="input" id="to" name="to" type="date" />
          </div>
          <button className="btn btn-secondary" type="submit">
            Exporteer naar CSV
          </button>
        </div>
        <p className="hint">
          Voor je boekhouder of je btw-aangifte. Btw staat per regel apart, omdat vrijgestelde en
          belaste omzet los van elkaar worden aangegeven.
        </p>
      </form>

      {!invoices || invoices.length === 0 ? (
        <EmptyState
          title="Nog geen facturen"
          body="Zodra een instelling je gewerkte uren goedkeurt, maken we de factuur op en sturen we die naar hun administratie."
        />
      ) : (
        <div className="card table-scroll" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
          <table className="table">
            <thead>
              <tr>
                <th>Nummer</th>
                <th>Instelling</th>
                <th>Datum</th>
                <th>Vervalt</th>
                <th>Btw</th>
                <th>Bedrag</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                const overdue =
                  !invoice.paid_at && invoice.due_on < amsterdamDateKey(now);
                return (
                  <tr key={invoice.id}>
                    <td className="tnum font-medium">{invoice.number}</td>
                    <td>{invoice.organisations?.name ?? "—"}</td>
                    <td className="tnum">{formatDate(invoice.issued_on)}</td>
                    <td className="tnum">{formatDate(invoice.due_on)}</td>
                    <td style={{ color: "var(--text-muted)" }}>
                      {VAT_LABELS[invoice.vat_treatment] ?? invoice.vat_treatment}
                    </td>
                    <td className="tnum font-semibold">{formatEuros(invoice.total_cents)}</td>
                    <td>
                      {invoice.paid_at ? (
                        <span className="badge badge-ok">Betaald</span>
                      ) : !invoice.sent_at ? (
                        /*
                         * Created and numbered but not yet delivered, because this
                         * freelancer reviews her invoices before they go out
                         * (invoice_settings.auto_send). Distinct from "Open",
                         * which means the facility has it and has not paid.
                         */
                        <span className="badge badge-brand">Klaar om te versturen</span>
                      ) : overdue ? (
                        <span className="badge badge-danger">Te laat</span>
                      ) : (
                        <span className="badge badge-neutral">Open</span>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-2 justify-end">
                        {/*
                          The PDF, at last reachable. It was rendered, uploaded and
                          its path stored on every invoice since the beginning, and
                          nothing in the product ever read pdf_path — so neither
                          party could obtain the document itself.
                        */}
                        {invoice.pdf_path ? (
                          <a
                            className="btn btn-secondary"
                            href={`/professional/facturen/${invoice.id}/pdf`}
                          >
                            Pdf
                          </a>
                        ) : (
                          /*
                            No document, because the upload failed when the invoice
                            was created. The invoice is legally issued either way —
                            it is numbered and recorded — so this offers the one
                            thing that was missing rather than pretending the row
                            is broken. lib/invoices.ts claimed this button existed
                            for months before it did.
                          */
                          <form action={regenerateInvoicePdfAction}>
                            <input type="hidden" name="invoice_id" value={invoice.id} />
                            <SubmitButton className="btn btn-secondary">
                              Pdf maken
                            </SubmitButton>
                          </form>
                        )}
                        {!invoice.sent_at ? (
                          <form action={sendInvoiceAction}>
                            <input type="hidden" name="invoice_id" value={invoice.id} />
                            <SubmitButton className="btn btn-primary">
                              Versturen
                            </SubmitButton>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
