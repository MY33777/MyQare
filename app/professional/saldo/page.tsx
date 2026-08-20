import type { Metadata } from "next";
import { FEE_PERCENT_LABEL, VAT_PERCENT_LABEL } from "@/lib/fees";
import { EmptyState, PageHeader } from "@/components/AppHeader";
import { FormMessage } from "@/components/AuthShell";
import { authErrorMessage } from "@/lib/authErrors";
import { requireFreelancer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { creditBalanceCents, MAX_TOPUP_CENTS, MIN_TOPUP_CENTS } from "@/lib/credits";
import { formatEuros } from "@/lib/money";
import { formatDateTime } from "@/lib/hours";
import { stripeConfigured } from "@/lib/stripe";
import { startTopupAction } from "./actions";

export const metadata: Metadata = { title: "Saldo" };

type LedgerRow = {
  id: string;
  delta_cents: number;
  reason: string;
  note: string | null;
  created_at: string;
};

const REASON_LABELS: Record<string, string> = {
  topup: "Opgewaardeerd",
  fee: "Bemiddelingsvergoeding",
  fee_refund: "Terugbetaling",
  fee_adjustment: "Correctie",
  manual: "Handmatig",
  // A top-up pulled back after a refund or a disputed payment. Its own label, not
  // folded into "Correctie": somebody looking at a balance that dropped needs to
  // see what actually happened. See migration 011.
  chargeback: "Opwaardering teruggeboekt",
};

const PRESETS = [2500, 5000, 10000, 25000];

export default async function BalancePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; topup?: string }>;
}) {
  const { userId } = await requireFreelancer("/professional/saldo");
  const params = await searchParams;
  const supabase = await createClient();

  const [balance, { data: ledger }] = await Promise.all([
    creditBalanceCents(userId, supabase),
    supabase
      .from("credit_ledger")
      .select("id, delta_cents, reason, note, created_at")
      .eq("profile_id", userId)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<LedgerRow[]>(),
  ]);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Saldo"
        description={
          `Hiervan wordt de bemiddelingsvergoeding afgeschreven zodra je een dienst aanneemt: ` +
          `${FEE_PERCENT_LABEL} van de opdrachtwaarde plus ${VAT_PERCENT_LABEL} btw.`
        }
      />

      {params.error ? <FormMessage kind="error">{authErrorMessage(params.error)}</FormMessage> : null}
      {params.topup === "success" ? (
        <FormMessage kind="ok">
          Betaling ontvangen. Je saldo wordt binnen een paar seconden bijgewerkt.
        </FormMessage>
      ) : null}
      {params.topup === "cancelled" ? (
        <FormMessage kind="error">Betaling geannuleerd. Er is niets afgeschreven.</FormMessage>
      ) : null}

      <div className="card p-6 mb-6">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Huidig saldo
        </p>
        <p className="text-3xl font-bold tnum mt-1">{formatEuros(balance)}</p>

        {stripeConfigured() ? (
          <form action={startTopupAction} className="mt-5 flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="amount">
                Bedrag opwaarderen
              </label>
              <input
                className="input"
                id="amount"
                name="amount"
                type="text"
                inputMode="decimal"
                defaultValue="50,00"
                required
              />
              <p className="hint">
                Minimaal {formatEuros(MIN_TOPUP_CENTS)}, maximaal {formatEuros(MAX_TOPUP_CENTS)}.
                Betalen kan met iDEAL.
              </p>
            </div>
            <button className="btn btn-primary" type="submit">
              Opwaarderen
            </button>
          </form>
        ) : (
          <p className="mt-4 text-sm" style={{ color: "var(--text-muted)" }}>
            Opwaarderen is nog niet beschikbaar: Stripe is niet geconfigureerd.
          </p>
        )}

        {stripeConfigured() ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {PRESETS.map((cents) => (
              <form key={cents} action={startTopupAction}>
                <input type="hidden" name="amount" value={(cents / 100).toFixed(2)} />
                <button className="btn btn-secondary" type="submit">
                  {formatEuros(cents)}
                </button>
              </form>
            ))}
          </div>
        ) : null}
      </div>

      <h2 className="text-lg font-bold mb-3">Mutaties</h2>

      {!ledger || ledger.length === 0 ? (
        <EmptyState
          title="Nog geen mutaties"
          body="Elke opwaardering, vergoeding en terugbetaling verschijnt hier — niets wordt achteraf aangepast."
        />
      ) : (
        <div className="card table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Wanneer</th>
                <th>Wat</th>
                <th>Bedrag</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => (
                <tr key={row.id}>
                  <td className="tnum">{formatDateTime(row.created_at)}</td>
                  <td>
                    {REASON_LABELS[row.reason] ?? row.reason}
                    {row.note ? (
                      <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                        {row.note}
                      </span>
                    ) : null}
                  </td>
                  <td
                    className="tnum font-semibold"
                    style={{ color: row.delta_cents < 0 ? "var(--danger)" : "var(--ok)" }}
                  >
                    {row.delta_cents < 0 ? "−" : "+"} {formatEuros(Math.abs(row.delta_cents))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
