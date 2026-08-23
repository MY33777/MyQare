import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { requireFacilityAdmin } from "@/lib/auth";
import { forEachPage } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";
import { formatEuros } from "@/lib/money";
import { formatDate } from "@/lib/hours";
import { amsterdamDateKey } from "@/lib/timezone";
import { markInvoicePaidAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";

export const metadata: Metadata = { title: "Facturen" };

type InvoiceRow = {
  id: string;
  number: string;
  issued_on: string;
  due_on: string;
  amount_ex_vat_cents: number;
  vat_amount_cents: number;
  total_cents: number;
  vat_treatment: string;
  paid_at: string | null;
  pdf_path: string | null;
  freelancers: { profiles: { full_name: string } | null } | null;
};

/**
 * How many invoices this page loads.
 *
 * It was 100 — a display limit applied to a screen that is not only a display.
 * "Openstaand" is summed from these rows, so a facility past its hundredth
 * invoice was shown a payables figure missing everything older, with nothing
 * saying so; and because the list is also the only route to marking an invoice
 * paid, an older unpaid one could never be settled from the product at all. A
 * facility running two wards reaches a hundred invoices in a quarter.
 *
 */

export default async function FacilityInvoicesPage({
  searchParams,
}: {
  /*
   * This page took no searchParams at all.
   *
   * markInvoicePaidAction and the CSV export both redirect back here with a
   * result, and nothing rendered any of it — a failed "markeer betaald" looked
   * exactly like a successful one, and the button was still there inviting a
   * retry. Same shape as the freelancer's invoice page before round 6.
   */
  searchParams: Promise<{ error?: string; paid?: string }>;
}) {
  const params = await searchParams;
  const { org } = await requireFacilityAdmin("/zorginstelling/facturen");
  const supabase = await createClient();

  /*
   * PAGED, like the freelancer's side.
   *
   * This asked for 2000 rows and logged a console.error when the result reached
   * that number — a guard that could not fire, because PostgREST truncates at the
   * project max-rows (1000 by default) and returns no error, so the count never
   * reaches the cap. A facility past 1000 invoices saw an understated payables
   * total with nothing on screen and nothing in the log saying so, and older
   * unpaid invoices simply left the product.
   *
   * Deterministic order because .range() over an ambiguous one can return the
   * same invoice on two pages, which for a payables SUM means paying it twice.
   */
  const invoices: InvoiceRow[] = [];

  const complete = await forEachPage<InvoiceRow>(
    (rangeFrom, rangeTo) =>
      supabase
        .from("invoices")
        .select(
          "id, number, issued_on, due_on, amount_ex_vat_cents, vat_amount_cents, total_cents, vat_treatment, paid_at, pdf_path, freelancers(profiles(full_name))",
        )
        .eq("org_id", org.id)
        /*
         * A held invoice has not been issued to this facility yet — the freelancer
         * is reviewing it before it goes out. It was appearing in this list, counted
         * into the payables total and flagged overdue once its due date passed, for
         * a document the facility had never been sent.
         */
        .not("sent_at", "is", null)
        .order("issued_on", { ascending: false })
        .order("id", { ascending: false })
        .range(rangeFrom, rangeTo)
        .returns<InvoiceRow[]>(),
    (page) => invoices.push(...page),
    { label: "facturen-instelling" },
  );

  // Compared as calendar dates in Amsterdam. new Date(due_on) parses the date as
  // UTC midnight, which is still "yesterday" locally and flagged invoices a day
  // early — and disagreed with the freelancer own page and the reminder cron.
  const todayKey = amsterdamDateKey();

  const outstanding = invoices
    .filter((invoice) => !invoice.paid_at)
    .reduce((sum, invoice) => sum + invoice.total_cents, 0);

  return (
    <>
      <PageHeader
        title="Facturen"
        description="Facturen van zorgprofessionals, automatisch opgemaakt na goedkeuring van de uren."
      />

      {params.error ? (
        <FormMessage kind="error">{authErrorMessage(params.error)}</FormMessage>
      ) : null}
      {params.paid ? <FormMessage kind="ok">Factuur op betaald gezet.</FormMessage> : null}

      {/*
        On screen, not in a log. The previous guard wrote a console.error nobody
        reading their own payables would ever see — and could not fire anyway.
      */}
      {!complete ? (
        <FormMessage kind="error">
          Niet alle facturen konden worden geladen, dus het openstaande bedrag hieronder is niet
          compleet. Ververs de pagina voordat je hierop afgaat.
        </FormMessage>
      ) : null}

      <div className="card p-4 mb-6 inline-block">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Openstaand
        </p>
        <p className="text-2xl font-bold tnum mt-1">{formatEuros(outstanding)}</p>
      </div>

      <form action="/zorginstelling/facturen/export" method="get" className="card p-4 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="from">Vanaf</label>
            <input className="input" id="from" name="from" type="date" />
          </div>
          <div>
            <label className="label" htmlFor="to">Tot en met</label>
            <input className="input" id="to" name="to" type="date" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="unpaid" value="1" /> Alleen openstaand
          </label>
          <button className="btn btn-secondary" type="submit">Exporteer naar CSV</button>
        </div>
      </form>

      {!invoices || invoices.length === 0 ? (
        <EmptyState
          title="Nog geen facturen"
          body="Zodra je gewerkte uren goedkeurt, verschijnt hier de bijbehorende factuur."
        />
      ) : (
        <div className="card table-scroll" tabIndex={0} role="region" aria-label="Tabel, horizontaal scrollbaar">
          <table className="table">
            <thead>
              <tr>
                <th>Nummer</th>
                <th>Zorgprofessional</th>
                <th>Datum</th>
                <th>Vervalt</th>
                <th>Excl. btw</th>
                <th>Btw</th>
                <th>Totaal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                const overdue = !invoice.paid_at && invoice.due_on < todayKey;
                return (
                  <tr key={invoice.id}>
                    <td className="tnum font-medium">{invoice.number}</td>
                    <td>{invoice.freelancers?.profiles?.full_name ?? "—"}</td>
                    <td className="tnum">{formatDate(invoice.issued_on)}</td>
                    <td className="tnum">
                      {formatDate(invoice.due_on)}
                      {overdue ? <span className="badge badge-danger ml-2">te laat</span> : null}
                    </td>
                    <td className="tnum">{formatEuros(invoice.amount_ex_vat_cents)}</td>
                    <td className="tnum">
                      {invoice.vat_treatment === "exempt_medical"
                        ? "vrijgesteld"
                        : formatEuros(invoice.vat_amount_cents)}
                    </td>
                    <td className="tnum font-semibold">{formatEuros(invoice.total_cents)}</td>
                    <td>
                      <div className="flex gap-2 justify-end">
                        {/*
                          The document itself, at last reachable from this side.

                          app/zorginstelling/facturen/[id]/pdf/route.ts has existed
                          the whole time and no screen ever linked to it, so the
                          facility could see that an invoice existed and read its
                          total, and could not obtain the thing their
                          accounts-payable process actually needs. The freelancer's
                          own list had the same gap until round 6.
                        */}
                        {invoice.pdf_path ? (
                          <a
                            className="btn btn-secondary"
                            href={`/zorginstelling/facturen/${invoice.id}/pdf`}
                          >
                            Pdf
                          </a>
                        ) : null}
                        {invoice.paid_at ? (
                          <span className="badge badge-ok self-center">Betaald</span>
                        ) : (
                          <form action={markInvoicePaidAction}>
                            <input type="hidden" name="invoice_id" value={invoice.id} />
                            <SubmitButton className="btn btn-secondary">
                              Markeer betaald
                            </SubmitButton>
                          </form>
                        )}
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
