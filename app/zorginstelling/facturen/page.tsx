import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { requireFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatEuros } from "@/lib/money";
import { formatDate } from "@/lib/hours";
import { amsterdamDateKey } from "@/lib/timezone";
import { markInvoicePaidAction } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

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
  profiles: { full_name: string } | null;
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
 * Matched to the freelancer's page so the two sides of the same invoice agree
 * about which invoices exist. Reaching it is reported rather than silent.
 */
const INVOICE_CAP = 2000;

export default async function FacilityInvoicesPage() {
  const { org } = await requireFacilityAdmin("/zorginstelling/facturen");
  const supabase = await createClient();

  const { data: invoices } = await supabase
    .from("invoices")
    .select(
      "id, number, issued_on, due_on, amount_ex_vat_cents, vat_amount_cents, total_cents, vat_treatment, paid_at, pdf_path, profiles!invoices_freelancer_id_fkey(full_name)",
    )
    .eq("org_id", org.id)
    /*
     * A held invoice has not been issued to this facility yet — the freelancer is
     * reviewing it before it goes out. It was appearing in this list, counted into
     * the payables total and flagged overdue once its due date passed, for a
     * document the facility had never been sent.
     */
    .not("sent_at", "is", null)
    .order("issued_on", { ascending: false })
    .limit(INVOICE_CAP)
    .returns<InvoiceRow[]>();

  if ((invoices ?? []).length >= INVOICE_CAP) {
    console.error(
      `[facturen] org ${org.id} has at least ${INVOICE_CAP} sent invoices; the ` +
        "payables total on this page is understated. Paginate this screen.",
    );
  }

  // Compared as calendar dates in Amsterdam. new Date(due_on) parses the date as
  // UTC midnight, which is still "yesterday" locally and flagged invoices a day
  // early — and disagreed with the freelancer own page and the reminder cron.
  const todayKey = amsterdamDateKey();

  const outstanding = (invoices ?? [])
    .filter((invoice) => !invoice.paid_at)
    .reduce((sum, invoice) => sum + invoice.total_cents, 0);

  return (
    <>
      <PageHeader
        title="Facturen"
        description="Facturen van zorgprofessionals, automatisch opgemaakt na goedkeuring van de uren."
      />

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
                    <td>{invoice.profiles?.full_name ?? "—"}</td>
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
