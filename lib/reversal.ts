/*
 * The arithmetic behind a refund or a chargeback.
 *
 * Pulled out of the Stripe webhook because this is where three consecutive
 * audits found a defect, each time in a different way:
 *
 *   round 5  the dispute path looked up a CHARGE id in a column holding PAYMENT
 *            INTENT ids, so no dispute was ever reversed
 *   round 6  a partial refund reversed the entire top-up, and then the
 *            idempotency key was spent so no correction could be recorded
 *   round 6  `.eq("assignment_id", null)` matched nothing, so "already reversed"
 *            was permanently zero and each event reversed the cumulative amount
 *            again — two partial refunds of €50 and €30 removed €130
 *
 * All three were arithmetic wrapped in I/O, which is exactly the shape that
 * cannot be tested. The I/O stays in the webhook; the decisions live here.
 *
 * Every amount is integer eurocents. Reversal rows are NEGATIVE (credit leaving
 * the balance) and restores are positive, the same convention as the ledger.
 */

/** A prior movement against one payment, as stored. */
export type PriorMovement = {
  /** Negative for a reversal, positive for a restore. */
  deltaCents: number;
  /** The ledger's stripe_payment_intent value, which encodes what caused it. */
  key: string;
};

export type ReversalDecision =
  | { act: false; reason: "already_settled" }
  | { act: true; deltaCents: number; cumulative: number };

/**
 * How much more to take off the balance for this event.
 *
 * `reversibleCents` is CUMULATIVE for a refund — Stripe's charge.amount_refunded
 * is the running total across every refund on that charge — and the disputed
 * amount for a dispute. Deriving the movement as "what should be gone, minus
 * what already is" makes a redelivered event compute zero, which is what makes
 * this idempotent without depending on the unique index to save it.
 *
 * Capped at the top-up: a reversal must never remove more than was granted, and
 * `alreadyReversed` is the NET of every prior reversal and restore so a won
 * dispute that was given back does not count as still removed.
 */
export function computeReversal(input: {
  topUpCents: number;
  reversibleCents: number;
  prior: PriorMovement[];
}): ReversalDecision {
  const alreadyReversed = netReversed(input.prior);
  const shouldBeReversed = Math.min(input.reversibleCents, input.topUpCents);
  const delta = shouldBeReversed - alreadyReversed;

  if (delta <= 0) return { act: false, reason: "already_settled" };
  return { act: true, deltaCents: delta, cumulative: shouldBeReversed };
}

export type RestoreDecision =
  | { act: false; reason: "nothing_was_reversed" | "already_restored" }
  | { act: true; deltaCents: number };

/**
 * How much to give back when a dispute is won.
 *
 * Only what the DISPUTE removed. A refund is permanent — the money genuinely
 * went back to the cardholder — so handing it back on an unrelated dispute win
 * would credit a balance nobody paid for. The two are told apart by the key,
 * which is the only thing about the cause that survives into the ledger.
 */
export function computeRestore(prior: PriorMovement[]): RestoreDecision {
  const fromDisputes = prior.filter((row) => row.key.includes(":dispute:"));
  if (fromDisputes.length === 0) return { act: false, reason: "nothing_was_reversed" };

  // Restores are not tagged by cause, so they offset the dispute total directly —
  // there is nothing else they could be undoing.
  const restores = prior.filter((row) => row.key.startsWith("restored:"));
  const outstanding = netReversed([...fromDisputes, ...restores]);

  if (outstanding <= 0) return { act: false, reason: "already_restored" };
  return { act: true, deltaCents: outstanding };
}

/** Net amount currently removed: reversals are negative, restores positive. */
function netReversed(prior: PriorMovement[]): number {
  return prior.reduce((sum, row) => sum - row.deltaCents, 0);
}

/**
 * The ledger key for a reversal.
 *
 * Carries three things: the payment, what caused the movement, and the
 * cumulative amount it brings the total to. The cause is what lets a won dispute
 * give back only its own share; the cumulative amount is what makes a redelivered
 * event collide on the unique index while a genuine second partial refund does
 * not.
 */
export function reversalKey(paymentIntent: string, cause: "refund" | "dispute", cumulative: number) {
  return `reversal:${paymentIntent}:${cause}:${cumulative}`;
}

/** The ledger key for a restore. Scoped to the dispute, so a second one restores again. */
export function restoreKey(paymentIntent: string, disputeId: string) {
  return `restored:${paymentIntent}:${disputeId}`;
}
