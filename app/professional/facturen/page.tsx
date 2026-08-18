import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { requireFreelancer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatEuros } from "@/lib/money";
import { formatDate } from "@/lib/hours";

export const metadata: Metadata = { title: "Facturen" };

type InvoiceRow = {
  id: string;
  number: string;
  issued_on: string;
  due_on: string;
  total_cents: number;
  vat_treatment: string;
  paid_at: string | null;
  organisations: { name: string } | null;
};

const VAT_LABELS: Record<string, string> = {
  exempt_medical: "Vrijgesteld",
  standard_21: "21% btw",
  undetermined: "Onbepaald",
};

export default async function FreelancerInvoicesPage() {
  const { userId } = await requireFreelancer("/professional/facturen");
  const supabase = await createClient();

  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, number, issued_on, due_on, total_cents, vat_treatment, paid_at, organisations(name)")
    .eq("freelancer_id", userId)
    .order("issued_on", { ascending: false })
    .limit(100)
    .returns<InvoiceRow[]>();

  const outstanding = (invoices ?? [])
    .filter((invoice) => !invoice.paid_at)
    .reduce((sum, invoice) => sum + invoice.total_cents, 0);

  return (
    <>
      <PageHeader
        title="Facturen"
        description="Automatisch opgemaakt op jouw naam zodra de instelling je uren goedkeurt."
      />

      {invoices && invoices.length > 0 ? (
        <div className="card p-4 mb-6 inline-block">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Nog openstaand
          </p>
          <p className="text-2xl font-bold tnum mt-1">{formatEuros(outstanding)}</p>
        </div>
      ) : null}

      <form action="/professional/facturen/export" method="get" className="card p-4 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="from">Vanaf</label>
            <input className="input" id="from" name="from" type="date" />
          </div>
          <div>
            <label className="label" htmlFor="to">Tot en met</label>
            <input className="input" id="to" name="to" type="date" />
          </div>
          <button className="btn btn-secondary" type="submit">Exporteer naar CSV</button>
        </div>
        <p className="hint">
          Voor je boekhouder of je btw-aangifte. Btw is per regel apart vermeld, omdat
          vrijgestelde en belaste omzet los van elkaar worden aangegeven.
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
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                const overdue = !invoice.paid_at && new Date(invoice.due_on) < new Date();
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
                      ) : overdue ? (
                        <span className="badge badge-danger">Te laat</span>
                      ) : (
                        <span className="badge badge-neutral">Open</span>
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
