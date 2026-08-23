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
  | {
      act: true;
      deltaCents: number;
      cumulative: number;
      /**
       * Which reversal this is for the cause: 1 the first time, 2 after a win
       * that was reopened and lost. Goes into the key. See reversalKey.
       */
      attempt: number;
    };

/**
 * How much more to take off the balance for this event.
 *
 * `reversibleCents` is CUMULATIVE for a refund — Stripe's charge.amount_refunded
 * is the running total across every refund on that charge — and the disputed
 * amount for a dispute. Deriving the movement as "what should be gone, minus
 * what already is" makes a redelivered event compute zero, which is what makes
 * this idempotent without depending on the unique index to save it.
 *
 * WHAT "WHAT ALREADY IS" HAS TO MEAN
 * ----------------------------------
 * Per CAUSE, and this is the fourth defect found in this file.
 *
 * It used to net every prior movement on the payment together while comparing
 * that total against a figure scoped to ONE cause. Refunds and disputes are
 * independent — Stripe takes the money for each of them separately — so mixing
 * them made the second one look mostly settled by the first:
 *
 *     €100 top-up
 *     partial refund of €30  ->  reversible 30, already 0   -> removes €30  OK
 *     dispute for €70        ->  reversible 70, already 30  -> removes €40  WRONG
 *
 * Stripe took €100. We removed €70 and left €30 of somebody else's money on the
 * balance. In the other order it is worse: the €30 refund computes a NEGATIVE
 * delta after a €70 dispute and removes nothing at all.
 *
 * So the running total is scoped to the cause, and a separate ceiling keeps the
 * SUM of all causes within the top-up — because two causes cannot legitimately
 * take back more than was ever granted, whatever Stripe reports for each.
 */
export function computeReversal(input: {
  topUpCents: number;
  reversibleCents: number;
  /** Refunds and disputes keep separate running totals. See above. */
  cause: "refund" | "dispute";
  /** The dispute's own id. Required for a dispute; ignored for a refund. */
  causeId?: string;
  prior: PriorMovement[];
}): ReversalDecision {
  const mine = priorForCause(input.prior, input.cause, input.causeId);

  const alreadyForCause = netReversed(mine);
  const targetForCause = Math.min(input.reversibleCents, input.topUpCents);

  /*
   * How much may still be taken off in total, across every cause. A won dispute
   * that was restored frees its share again, which is why this is the net rather
   * than the sum of reversals.
   */
  const headroom = input.topUpCents - netReversed(input.prior);

  const delta = Math.min(targetForCause - alreadyForCause, headroom);

  if (delta <= 0) return { act: false, reason: "already_settled" };

  /*
   * The cumulative figure that goes into the key is what this CAUSE has now
   * removed — not the target — so a delta clamped by the ceiling still produces a
   * key that a redelivery of the same event reproduces exactly.
   */
  /*
   * How many times this cause has ALREADY reversed. Restores are not counted:
   * they are the same cause moving the other way.
   *
   * A dispute that is won and then reopened nets back to zero — that netting is
   * deliberate, it is what lets the reopened dispute reverse again — and the
   * cumulative figure therefore comes out identical to the first time. So does
   * the key. See reversalKey.
   */
  const attempt = mine.filter((row) => row.key.startsWith("reversal:")).length + 1;

  return { act: true, deltaCents: delta, cumulative: alreadyForCause + delta, attempt };
}

/**
 * The prior movements belonging to one cause.
 *
 * A dispute owns its own reversals AND its restore, so a won-then-reopened
 * dispute nets back to zero and can reverse again. A refund owns every
 * `:refund:` reversal on the payment, because Stripe reports refunds as one
 * cumulative figure rather than individually.
 */
function priorForCause(
  prior: PriorMovement[],
  cause: "refund" | "dispute",
  causeId?: string,
): PriorMovement[] {
  if (cause === "refund") return prior.filter((row) => row.key.includes(":refund:"));

  /*
   * Without an id there is no way to tell one dispute's rows from another's, so
   * this scopes to nothing rather than to everything. Reversing too much is the
   * failure that leaves a freelancer with a negative balance and no route back;
   * reversing too little is visible in the Stripe dashboard and correctable.
   */
  if (!causeId) return [];

  return prior.filter(
    (row) => row.key.includes(`:dispute:${causeId}:`) || row.key.endsWith(`:${causeId}`),
  );
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
export function computeRestore(prior: PriorMovement[], disputeId: string): RestoreDecision {
  /*
   * THIS dispute's reversal, not every dispute's.
   *
   * Scoping only to ":dispute:" gave back the total of every open dispute on the
   * payment the moment any one of them was won. Two disputes for €200 each, one
   * won, and €400 came back — half of it for a chargeback still outstanding.
   *
   * Reachable because the key now carries the dispute id, which is what the
   * previous version lacked.
   */
  const mine = prior.filter((row) => row.key.includes(`:dispute:${disputeId}:`));
  if (mine.length === 0) return { act: false, reason: "nothing_was_reversed" };

  // The restore for this dispute, if an earlier delivery already made one.
  const restores = prior.filter((row) => row.key === restoreKey(paymentOf(mine[0].key), disputeId));
  const outstanding = netReversed([...mine, ...restores]);

  if (outstanding <= 0) return { act: false, reason: "already_restored" };
  return { act: true, deltaCents: outstanding };
}

/** Pulls the payment intent back out of a reversal key: reversal:<pi>:... */
function paymentOf(key: string): string {
  return key.split(":")[1] ?? "";
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
export function reversalKey(
  paymentIntent: string,
  cause: "refund" | "dispute",
  cumulative: number,
  /**
   * The dispute's own id. Required for a dispute, absent for a refund.
   *
   * Without it, a charge disputed a SECOND time produced a byte-identical key to
   * the first: a won dispute restores the credit, so netReversed returns to zero,
   * so the cumulative amount is the same charge amount again. The insert then hit
   * the unique index, recordLedgerEntry swallowed the 23505 as a redelivery, and
   * the webhook returned 200 with `reversed` set — money Stripe had taken back,
   * reported as taken back, still sitting on the balance.
   *
   * Refunds do not need it: Stripe's amount_refunded is cumulative and strictly
   * increases, so each genuine refund already yields a distinct key.
   */
  causeId?: string,
  /**
   * Which reversal this is for the cause. Omitted or 1 for the first, which keeps
   * every key already in the ledger byte-identical.
   *
   * A dispute WON and then REOPENED needs this. `priorForCause` deliberately
   * counts the restore alongside the reversal so the pair nets to zero and the
   * reopened dispute can act again — and that is exactly what makes the second
   * reversal recompute the first one's cumulative figure, and its key. The insert
   * then violated the unique index, recordLedgerEntry swallowed the 23505 as a
   * redelivery, and the webhook answered 200 with `reversed` set: Stripe had
   * taken the money back, we reported that we had, and the balance still held it.
   *
   * The causeId above fixed the SECOND-dispute case and looked like it covered
   * this one. It does not; the id is the same dispute both times.
   *
   * Safe against redelivery because idempotency does not rest here: a redelivered
   * event computes a delta of zero in computeReversal and never reaches this. Two
   * SIMULTANEOUS deliveries both read the same prior rows, so they still produce
   * the same attempt and the same key, and the index still separates them.
   */
  attempt = 1,
) {
  const scope = cause === "dispute" && causeId ? `${cause}:${causeId}` : cause;
  const base = `reversal:${paymentIntent}:${scope}:${cumulative}`;
  return attempt > 1 ? `${base}:${attempt}` : base;
}

/** The ledger key for a restore. Scoped to the dispute, so a second one restores again. */
export function restoreKey(paymentIntent: string, disputeId: string) {
  return `restored:${paymentIntent}:${disputeId}`;
}
