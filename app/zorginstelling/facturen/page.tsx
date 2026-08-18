import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { requireFacilityAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatEuros } from "@/lib/money";
import { formatDate } from "@/lib/hours";
import { amsterdamDateKey } from "@/lib/timezone";
import { markInvoicePaidAction } from "./actions";

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
  profiles: { full_name: string } | null;
};

export default async function FacilityInvoicesPage() {
  const { org } = await requireFacilityAdmin("/zorginstelling/facturen");
  const supabase = await createClient();

  const { data: invoices } = await supabase
    .from("invoices")
    .select(
      "id, number, issued_on, due_on, amount_ex_vat_cents, vat_amount_cents, total_cents, vat_treatment, paid_at, profiles!invoices_freelancer_id_fkey(full_name)",
    )
    .eq("org_id", org.id)
    .order("issued_on", { ascending: false })
    .limit(100)
    .returns<InvoiceRow[]>();

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
        <div className="card table-scroll">
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
                      {invoice.paid_at ? (
                        <span className="badge badge-ok">Betaald</span>
                      ) : (
                        <form action={markInvoicePaidAction}>
                          <input type="hidden" name="invoice_id" value={invoice.id} />
                          <button className="btn btn-secondary" type="submit">
                            Markeer betaald
                          </button>
                        </form>
                      )}
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
