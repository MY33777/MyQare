import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { forEachPage } from "@/lib/pagination";

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
/**
 * How many ledger rows are fetched per round trip while summing a balance.
 *
 * Exported so the test can prove the paging actually loops rather than trusting
 * that it would if the numbers were bigger.
 */
export const LEDGER_PAGE_SIZE = 1000;

export async function creditBalanceCents(
  profileId: string,
  client?: SupabaseClient,
): Promise<number> {
  const supabase = client ?? getSupabaseAdmin();

  /*
   * Paged, because this select had no bound on it.
   *
   * PostgREST applies whatever `max-rows` the project is configured with, and
   * hardening a Supabase project by setting it is a recommended, ordinary thing
   * to do. The moment somebody does, this select starts returning the first N
   * rows and the sum silently becomes a smaller number — with no error, on the
   * balance that decides whether a freelancer can accept tonight's shift and how
   * much of their own money we think they have.
   *
   * A balance that quietly goes wrong when an unrelated setting changes is not a
   * balance. Ordered so the pages partition the rows deterministically; without
   * an ORDER BY, OFFSET is free to return the same row twice across two pages,
   * which on a SUM means counting a top-up twice.
   */
  let total = 0;

  const complete = await forEachPage<{ delta_cents: number }>(
    (from, to) =>
      supabase
        .from("credit_ledger")
        .select("delta_cents")
        .eq("profile_id", profileId)
        .order("id", { ascending: true })
        .range(from, to),
    (rows) => {
      for (const row of rows) total += row.delta_cents;
    },
    { pageSize: LEDGER_PAGE_SIZE, label: "credit_ledger" },
  );

  /*
   * Zero on failure, as before. It is the safe direction for the two things this
   * gates — accepting a shift and offering a top-up — because it refuses rather
   * than over-credits. But a PARTIAL sum is not safe in that direction, so an
   * incomplete read discards what it got rather than returning a balance that
   * looks plausible and is short.
   */
  return complete ? total : 0;
}

export type LedgerReason =
  | "topup"
  | "fee"
  | "fee_refund"
  | "fee_adjustment"
  | "manual"
  /** A top-up pulled back: a Stripe refund or a disputed charge. See migration 011. */
  | "chargeback";

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
     * Swallow the duplicate ONLY when it is the one we expect.
     *
     * 23505 is any unique violation. This used to swallow all of them on the
     * reasoning that stripe_payment_intent is the only unique index on the table —
     * true today, and the kind of assumption that stops being true the moment
     * somebody adds a constraint. Every other 23505 would then have been silently
     * dropped: a ledger entry that never landed, on an append-only table, with the
     * caller told it succeeded.
     *
     * Matched on the constraint name so a new index cannot quietly join the club.
     */
    const duplicateTopUp =
      error.code === "23505" && (error.message ?? "").includes("stripe_payment_intent");
    if (duplicateTopUp) return;
    throw new Error(`Kon creditmutatie niet vastleggen: ${error.message}`);
  }
}
