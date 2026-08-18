import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { requireFreelancer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatEuros } from "@/lib/money";
import { formatDate } from "@/lib/hours";
import { byQuarter, summariseEarnings, summariseReceivables } from "@/lib/earnings";
import { amsterdamDateKey } from "@/lib/timezone";

export const metadata: Metadata = { title: "Facturen" };

type InvoiceRow = {
  id: string;
  number: string;
  issued_on: string;
  due_on: string;
  paid_at: string | null;
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

export default async function FreelancerInvoicesPage() {
  const { userId } = await requireFreelancer("/professional/facturen");
  const supabase = await createClient();

  const now = new Date();

  const [{ data: invoices }, { data: upcoming }] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id, number, issued_on, due_on, paid_at, amount_ex_vat_cents, vat_amount_cents, total_cents, vat_treatment, organisations(name)",
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
  ]);

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
