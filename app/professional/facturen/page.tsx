import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { qualificationLabel } from "@/lib/qualifications";
import { requireFreelancer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatEuros } from "@/lib/money";
import { formatDate } from "@/lib/hours";
import { byQuarter, summariseEarnings, summariseReceivables } from "@/lib/earnings";
import { amsterdamDateKey } from "@/lib/timezone";
import { sendInvoiceAction, issueInvoiceAction } from "@/app/professional/facturatie/actions";

export const metadata: Metadata = { title: "Facturen" };

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
  tone?: "danger" | "muted";
}) {
  return (
    <div className="card p-4">
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p
        className="text-2xl font-bold tnum mt-1"
        style={tone === "danger" ? { color: "var(--danger)" } : undefined}
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
  unknown: "Er ging iets mis. Probeer het opnieuw.",
};

export default async function FreelancerInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; issued?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { userId } = await requireFreelancer("/professional/facturen");
  const supabase = await createClient();

  const now = new Date();

  const [{ data: invoices }, { data: upcoming }, { data: blocked }] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, number, issued_on, due_on, paid_at, sent_at, pdf_path, amount_ex_vat_cents, vat_amount_cents, total_cents, vat_treatment, organisations(name)",
      )
      .eq("freelancer_id", userId)
      .order("issued_on", { ascending: false })
      .limit(200)
      .returns<InvoiceRow[]>(),
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
     * Approved work with no invoice.
     *
     * createInvoiceForAssignment refuses while the legally required fields are
     * blank (art. 35a Wet OB). The fee has already settled and the hours are
     * approved by then, so without this the work simply vanished: it left the
     * facility's queue, no code path retried, and the only person who could fix
     * it was never told. Round 3 found the same shape in the invoice-number race.
     */
    supabase
      .from("assignments")
      .select("id, status, shifts(starts_at, profession), timesheets(approved_at), invoices(id)")
      .eq("freelancer_id", userId)
      .eq("status", "completed")
      .returns<
        {
          id: string;
          status: string;
          shifts: { starts_at: string; profession: string } | null;
          timesheets: { approved_at: string | null } | null;
          /*
           * An OBJECT, not an array. invoices.assignment_id is UNIQUE, so
           * PostgREST infers one-to-one. Typed as an array, `.length` was
           * undefined, `?? 0` made it 0, and every approved assignment — invoiced
           * or not — matched the "no invoice yet" filter forever.
           *
           * The exact mirror of migration 008, where DROPPING a unique constraint
           * flipped an embed the other way. Same trap, opposite direction.
           */
          invoices: { id: string } | null;
        }[]
      >(),
  ]);

  // Approved, and nothing issued for it.
  const uninvoiced = (blocked ?? []).filter(
    (row) => row.timesheets?.approved_at && !row.invoices,
  );

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

  const earnings = summariseEarnings(invoices ?? [], booked);
  const receivables = summariseReceivables(invoices ?? [], now);
  const quarters = byQuarter(invoices ?? []);

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
      {params.sent ? <FormMessage kind="ok">Factuur verstuurd.</FormMessage> : null}
      {params.issued === "sent" ? (
        <FormMessage kind="ok">Factuur opgemaakt en verstuurd.</FormMessage>
      ) : null}
      {params.issued === "held" ? (
        <FormMessage kind="ok">
          Factuur opgemaakt. Hij staat klaar met nummer en al — verstuur hem hieronder wanneer je
          hem hebt nagekeken.
        </FormMessage>
      ) : null}
      {params.error ? (
        <FormMessage kind="error">{MESSAGES[params.error] ?? MESSAGES.unknown}</FormMessage>
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
        <Stat
          label="Openstaand"
          value={formatEuros(receivables.outstandingCents)}
          hint={
            receivables.overdueCount > 0
              ? `waarvan ${formatEuros(receivables.overdueCents)} te laat`
              : "alles binnen termijn"
          }
          tone={receivables.overdueCount > 0 ? "danger" : undefined}
        />
        <Stat
          label="Ingepland"
          value={formatEuros(earnings.bookedCents)}
          hint="Aangenomen, nog niet gewerkt"
        />
      </div>

      {quarters.length > 0 ? (
        <div className="card p-4 mb-6">
          <h2 className="font-bold mb-3">Per kwartaal</h2>
          {/* Quarters rather than months: that is the btw-aangifte cycle, and a
              month view would make someone add it up themselves four times a year. */}
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Kwartaal</th>
                  <th>Omzet excl. btw</th>
                  <th>Btw</th>
                </tr>
              </thead>
              <tbody>
                {quarters.map((quarter) => (
                  <tr key={quarter.label}>
                    <td className="font-medium tnum">{quarter.label}</td>
                    <td className="tnum">{formatEuros(quarter.exVatCents)}</td>
                    <td className="tnum">{formatEuros(quarter.vatCents)}</td>
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
        <div className="card table-scroll">
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
                        ) : null}
                        {!invoice.sent_at ? (
                          <form action={sendInvoiceAction}>
                            <input type="hidden" name="invoice_id" value={invoice.id} />
                            <button className="btn btn-primary" type="submit">
                              Versturen
                            </button>
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
