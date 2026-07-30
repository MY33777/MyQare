import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Reads and writes against the append-only credit ledger.
 *
 * There is no balance column. A balance is always the sum of the ledger, which is
 * why every read here goes through the same function — see the long comment on
 * credit_ledger in supabase/schema.sql for why a mutable balance was rejected.
 */

/** €5 minimum top-up: Stripe's fees make anything smaller pointless. */
export const MIN_TOPUP_CENTS = 500;

/** Fat-finger guard, not a product limit. */
export const MAX_TOPUP_CENTS = 500_000;

export function clampTopupCents(cents: number): number {
  if (!Number.isFinite(cents)) return MIN_TOPUP_CENTS;
  return Math.min(MAX_TOPUP_CENTS, Math.max(MIN_TOPUP_CENTS, Math.round(cents)));
}

/**
 * Current balance in cents.
 *
 * Takes an optional client so a page that already has a user-scoped client can
 * reuse it — the ledger's select policy already restricts a user to their own
 * rows, so this does not need the service role just to read.
 */
export async function creditBalanceCents(
  profileId: string,
  client?: SupabaseClient,
): Promise<number> {
  const supabase = client ?? getSupabaseAdmin();
  const { data, error } = await supabase
    .from("credit_ledger")
    .select("delta_cents")
    .eq("profile_id", profileId);

  if (error || !data) return 0;
  return data.reduce((sum, row) => sum + (row.delta_cents as number), 0);
}

export type LedgerReason = "topup" | "fee" | "fee_refund" | "fee_adjustment" | "manual";

/**
 * Appends one movement to the ledger.
 *
 * Always the service role: the ledger has no client insert policy by design, so
 * this is the only way money moves. Callers must have already established who the
 * user is and that the movement is legitimate.
 */
export async function recordLedgerEntry(entry: {
  profileId: string;
  deltaCents: number;
  reason: LedgerReason;
  assignmentId?: string | null;
  stripePaymentIntent?: string | null;
  note?: string | null;
}): Promise<void> {
  // A zero movement is not worth a row — it happens routinely when a shift runs
  // exactly as scheduled and the fee adjustment comes out at nothing.
  if (entry.deltaCents === 0) return;

  const admin = getSupabaseAdmin();
  const { error } = await admin.from("credit_ledger").insert({
    profile_id: entry.profileId,
    delta_cents: entry.deltaCents,
    reason: entry.reason,
    assignment_id: entry.assignmentId ?? null,
    stripe_payment_intent: entry.stripePaymentIntent ?? null,
    note: entry.note ?? null,
  });

  if (error) {
    /*
     * 23505 is a unique violation, which here can only be the stripe_payment_intent
     * index — i.e. a webhook Stripe delivered twice. That is the index doing its
     * job, so swallow it rather than crediting the same payment again.
     */
    if (error.code === "23505") return;
    throw new Error(`Kon creditmutatie niet vastleggen: ${error.message}`);
  }
}
