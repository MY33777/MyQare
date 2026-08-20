import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { recordLedgerEntry } from "@/lib/credits";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  computeReversal,
  computeRestore,
  reversalKey,
  restoreKey,
  type PriorMovement,
} from "@/lib/reversal";

/*
 * Stripe webhook — the only place a top-up is credited.
 *
 * Credited here rather than on the success redirect because a browser redirect is
 * not a payment confirmation: the customer can close the tab before it fires, and
 * anyone can request the success URL directly. The webhook is the only signal
 * that actually means money moved.
 *
 * Stripe explicitly warns that events can be delivered more than once, so this
 * must be idempotent. It is, by the unique index on
 * credit_ledger.stripe_payment_intent — a replayed event tries to insert a row
 * that already exists and recordLedgerEntry swallows the 23505. A "have I seen
 * this event id" check in application code would be a race; the index is not.
 */

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  // The RAW body is required: constructEvent verifies a signature over the exact
  // bytes Stripe sent, so parsing to JSON first and re-serialising breaks it.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    // An unverifiable payload is either a misconfigured secret or someone poking
    // the endpoint. Either way it must never reach the ledger.
    const message = error instanceof Error ? error.message : "invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    // `paid` rather than merely `complete`: a session can complete with a payment
    // still processing, and crediting then would hand out balance for money that
    // may yet fail.
    if (session.payment_status !== "paid") {
      return NextResponse.json({ received: true, skipped: "not_paid" });
    }

    const profileId = session.metadata?.profile_id;
    const amount = session.amount_total;

    if (!profileId || !amount) {
      return NextResponse.json({ received: true, skipped: "missing_metadata" });
    }

    /*
     * Confirm the id names an actual freelancer before crediting it.
     *
     * metadata is set by us when the session is created, so under normal operation
     * this always holds. It is checked anyway because a ledger entry against a
     * profile that does not exist, or against a facility admin who has no balance
     * page, is money that is gone from Stripe and present nowhere — and the
     * append-only ledger has no clean way to move it afterwards.
     */
    const { data: recipient, error: recipientError } = await getSupabaseAdmin()
      .from("freelancers")
      .select("profile_id")
      .eq("profile_id", profileId)
      .maybeSingle<{ profile_id: string }>();

    /*
     * "Could not ask" is not "no such person".
     *
     * The error was discarded, so a database blip during this lookup produced
     * data: null, took the branch below, and told Stripe 200/handled — for a
     * payment that had already been taken. Stripe does not redeliver a webhook it
     * was told was handled, so the money was gone from the customer's bank and
     * present nowhere, permanently, on an append-only ledger.
     *
     * 500 here so Stripe retries, which is exactly what a transient failure needs.
     */
    if (recipientError) {
      console.error(
        `[stripe] could not verify freelancer ${profileId} for session ${session.id}: ` +
          `${recipientError.message}. Returning 500 so Stripe retries.`,
      );
      return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
    }

    if (!recipient) {
      // 200, not 500: retrying will not make the profile exist, and a webhook
      // Stripe keeps redelivering forever is its own problem.
      console.error(`[stripe] top-up for unknown freelancer ${profileId}, session ${session.id}`);
      return NextResponse.json({ received: true, skipped: "unknown_freelancer" });
    }

    const paymentIntent =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent?.id ?? session.id);

    try {
      await recordLedgerEntry({
        profileId,
        deltaCents: amount,
        reason: "topup",
        stripePaymentIntent: paymentIntent,
        note: "Saldo opgewaardeerd",
      });
    } catch (error) {
      /*
       * Returning 500 asks Stripe to retry, which is right: a failure here means
       * the customer paid and has no balance, and that must not be silently
       * dropped. The idempotency index makes the retry safe.
       */
      const message = error instanceof Error ? error.message : "ledger write failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  /*
   * A dispute the freelancer WON. The reversal has to be two-way.
   *
   * charge.dispute.created reverses at the moment a dispute opens, because the
   * funds are withdrawn immediately and leaving spendable balance in place during
   * a dispute is the window somebody would use. But nothing consumed the closing
   * event, so when the dispute was resolved in their favour and Stripe returned
   * the money, the chargeback row stood: the ledger is append-only, the app has
   * no manual credit path, and accept_shift's balance check then barred them from
   * working. The platform took €500 off someone who had done nothing wrong and
   * had no way to give it back.
   */
  if (event.type === "charge.dispute.closed") {
    const dispute = event.data.object as Stripe.Dispute;
    if (dispute.status !== "won") {
      return NextResponse.json({ received: true, skipped: `dispute_${dispute.status}` });
    }
    try {
      const restored = await restoreWonDispute(dispute);
      return NextResponse.json({ received: true, ...restored });
    } catch (error) {
      const message = error instanceof Error ? error.message : "restore failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  /*
   * charge.dispute.updated is handled alongside created.
   *
   * An inquiry — status prefixed `warning_` — is skipped on creation because
   * Stripe has withdrawn nothing. When one ESCALATES into a real chargeback,
   * Stripe does not fire `created` again; it fires `updated` with the new
   * status. Handling only `created` therefore meant every dispute that began as
   * an inquiry reversed nothing, ever.
   *
   * Safe to handle both: reverseCharge derives its movement from the ledger, so
   * a second event for a dispute already reversed computes zero.
   */
  if (
    event.type === "charge.refunded" ||
    event.type === "charge.dispute.created" ||
    event.type === "charge.dispute.updated"
  ) {
    try {
      const reversal = await reverseCharge(event);
      return NextResponse.json({ received: true, ...reversal });
    } catch (error) {
      // 500 asks Stripe to retry. An unthrown error here would be reported as
      // handled and never redelivered, leaving credit on a balance that the bank
      // has already taken back.
      const message = error instanceof Error ? error.message : "reversal failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}

/**
 * Takes back credit for a payment that was refunded or disputed.
 *
 * Finds the original top-up by its payment intent rather than trusting anything on
 * the reversal event — the amount reversed can differ from the amount credited
 * (a partial refund, a different currency presentation), and the ledger's own
 * record of what was granted is the only safe basis for what to remove.
 */
async function reverseCharge(
  event: Stripe.Event,
): Promise<{ reversed?: number; skipped?: string }> {
  /*
   * The PAYMENT INTENT id, which is what credit_ledger.stripe_payment_intent
   * holds. The first version of this read `dispute.charge` — a CHARGE id, "ch_…"
   * — and looked it up in a column that only ever contains "pi_…". It never
   * matched, so every dispute silently returned no_matching_topup and reversed
   * nothing. The handler existed and did nothing, which is worse than not having
   * written it, because it looked handled.
   *
   * A Dispute carries payment_intent directly. A Charge carries it too, expanded
   * or as a string depending on the request.
   */
  let paymentIntent: string | null = null;
  let reversibleCents = 0;
  /*
   * Which kind of reversal this is, recorded in the key.
   *
   * A refund is permanent; a dispute can be won, and winning must give back only
   * what the DISPUTE took. Both used to write `reversal:<pi>:<amount>`, so
   * restoreWonDispute could not tell them apart and handed back refunded money
   * too. The cause belongs in the key because the key is the only thing that
   * survives into the ledger.
   */
  let cause: "refund" | "dispute" = "refund";
  // The dispute's own id, so a second dispute on one charge cannot reuse the
  // first one's ledger key. See reversalKey.
  let causeId: string | undefined;

  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    paymentIntent =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : (charge.payment_intent?.id ?? null);
    // CUMULATIVE across every refund on this charge, which is what makes the
    // arithmetic below idempotent for partial refunds.
    reversibleCents = charge.amount_refunded ?? 0;
  } else {
    const dispute = event.data.object as Stripe.Dispute;

    /*
     * An INQUIRY is not a chargeback.
     *
     * Stripe fires charge.dispute.created for early warnings and inquiries too,
     * whose status is prefixed `warning_`. No funds are withdrawn for those —
     * the bank is asking a question. Reversing on one takes money off somebody
     * because their cardholder rang their bank, and the closing event for an
     * inquiry does not carry status 'won', so nothing would give it back.
     */
    if ((dispute.status ?? "").startsWith("warning_")) {
      return { skipped: `inquiry_${dispute.status}` };
    }

    cause = "dispute";
    causeId = dispute.id;
    paymentIntent =
      typeof dispute.payment_intent === "string"
        ? dispute.payment_intent
        : (dispute.payment_intent?.id ?? null);
    reversibleCents = dispute.amount ?? 0;
  }

  if (!paymentIntent) return { skipped: "no_payment_intent" };

  const admin = getSupabaseAdmin();

  const { data: original, error: lookupError } = await admin
    .from("credit_ledger")
    .select("profile_id, delta_cents")
    .eq("stripe_payment_intent", paymentIntent)
    .eq("reason", "topup")
    .maybeSingle<{ profile_id: string; delta_cents: number }>();

  /*
   * A failed read is not "nothing to reverse". Discarding it meant a transient
   * database blip abandoned the reversal and told Stripe the event was handled,
   * so it would never be redelivered and the balance stayed credited forever.
   */
  if (lookupError) throw new Error(`reversal lookup failed: ${lookupError.message}`);

  // Nothing was ever credited for this payment, so there is nothing to take back.
  if (!original) return { skipped: "no_matching_topup" };

  /*
   * How much SHOULD be gone, versus how much already is.
   *
   * Derived from the ledger rather than trusting the event, the same shape as
   * settle_timesheet. The first version reversed the whole top-up on any
   * charge.refunded, so a €5 refund on a €500 top-up wiped all €500 — and then
   * the idempotency key blocked every correction, because the key was the
   * payment intent and it had been used.
   *
   * Capped at the top-up: Stripe's amounts are in the charge's currency and a
   * reversal must never remove more than we granted.
   */
  /*
   * The NET position on this payment, not just what was taken off it.
   *
   * Two bugs lived in the previous three lines.
   *
   * `.eq("assignment_id", null)` sends `assignment_id=eq.null` to PostgREST,
   * which compares against the literal string "null" rather than meaning IS NULL
   * — it is the only `.eq(col, null)` in the repo; everywhere else uses `.is()`.
   * So this matched nothing, alreadyReversed was permanently 0, and each new
   * event reversed the cumulative amount AGAIN under a fresh key. Two partial
   * refunds of €50 and €30 removed €130.
   *
   * And filtering to reason='chargeback' ignored what restoreWonDispute had
   * already given back. After a dispute was reversed and then won, a later refund
   * saw the reversal, computed delta = 0, and took nothing — the platform paid
   * the money out of Stripe and the freelancer kept the balance.
   *
   * Both rows are keyed `reversal:<pi>…` or `restored:<pi>`, so summing the
   * DELTAS of everything under this payment other than the original top-up gives
   * the position directly: negative means still removed, zero means square.
   */
  const { data: existing, error: existingError } = await admin
    .from("credit_ledger")
    .select("delta_cents, stripe_payment_intent")
    .or(
      `stripe_payment_intent.like.reversal:${paymentIntent}%,` +
        `stripe_payment_intent.like.restored:${paymentIntent}%`,
    )
    .returns<{ delta_cents: number; stripe_payment_intent: string }[]>();

  // A failed read is not "nothing has been reversed". Discarding it is what let
  // the recomputation start from zero every time.
  if (existingError) throw new Error(`reversal history unreadable: ${existingError.message}`);

  const prior: PriorMovement[] = (existing ?? []).map((row) => ({
    deltaCents: row.delta_cents,
    key: row.stripe_payment_intent,
  }));

  // The arithmetic lives in lib/reversal.ts, where it can be tested without a
  // database. Three audits found a defect in it while it was tangled up in these
  // queries; none of them could have been caught by a test that did not exist.
  const decision = computeReversal({
    topUpCents: original.delta_cents,
    reversibleCents,
    prior,
  });

  if (!decision.act) return { skipped: decision.reason };

  try {
    await recordLedgerEntry({
      profileId: original.profile_id,
      // Negative: the credit leaves the balance.
      deltaCents: -decision.deltaCents,
      reason: "chargeback",
      /*
       * Keyed on the cumulative amount, so a redelivered event produces the same
       * key and collides on the unique index, while a SECOND partial refund
       * produces a different one and lands. Prefixed so it never collides with
       * the top-up's own row.
       */
      stripePaymentIntent: reversalKey(paymentIntent, cause, decision.cumulative, causeId),
      note:
        event.type === "charge.refunded"
          ? "Terugbetaling van een opwaardering"
          : "Opwaardering teruggeboekt na een betaalgeschil",
    });
  } catch (error) {
    // Rethrown so the caller returns 500 and Stripe retries. Balance that should
    // be gone and is not is the same class of problem as balance that was paid
    // for and never arrived.
    const message = error instanceof Error ? error.message : "reversal failed";
    console.error(`[stripe] reversal failed for ${paymentIntent}: ${message}`);
    throw error;
  }

  return { reversed: decision.deltaCents };
}

/**
 * Puts back credit that was reversed for a dispute the freelancer went on to win.
 *
 * Stripe returns the funds, so the reversal was correct while the dispute was
 * open and wrong the moment it closed in our favour. Restores exactly what was
 * taken for this payment — read from the ledger, not from the event — so it can
 * never hand back more than was removed.
 */
async function restoreWonDispute(
  dispute: Stripe.Dispute,
): Promise<{ restored?: number; skipped?: string }> {
  const paymentIntent =
    typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : (dispute.payment_intent?.id ?? null);

  if (!paymentIntent) return { skipped: "no_payment_intent" };

  const admin = getSupabaseAdmin();

  /*
   * Only what the DISPUTE removed, and only what has not been given back.
   *
   * The first version summed every reversal on this payment, which included any
   * refund — permanently correct money — and handed it back. It also ignored
   * earlier restores, so a redelivered close event credited a second time.
   */
  const { data: rows, error } = await admin
    .from("credit_ledger")
    .select("profile_id, delta_cents, stripe_payment_intent")
    .or(
      `stripe_payment_intent.like.reversal:${paymentIntent}:dispute:%,` +
        `stripe_payment_intent.like.restored:${paymentIntent}%`,
    )
    .returns<{ profile_id: string; delta_cents: number; stripe_payment_intent: string }[]>();

  if (error) throw new Error(`restore lookup failed: ${error.message}`);
  if (!rows || rows.length === 0) return { skipped: "nothing_was_reversed" };

  const decision = computeRestore(
    rows.map((row) => ({ deltaCents: row.delta_cents, key: row.stripe_payment_intent })),
    dispute.id,
  );

  if (!decision.act) return { skipped: decision.reason };

  await recordLedgerEntry({
    profileId: rows[0].profile_id,
    deltaCents: decision.deltaCents,
    reason: "topup",
    // Distinct from both the original top-up and its reversal, and stable, so a
    // redelivered close event collides on the unique index instead of crediting
    // a second time.
    // Includes the dispute id, so a charge disputed twice restores twice while a
    // redelivered event for the SAME dispute collides on the unique index.
    stripePaymentIntent: restoreKey(paymentIntent, dispute.id),
    note: "Teruggeboekt bedrag hersteld: het betaalgeschil is in jouw voordeel beslecht",
  });

  return { restored: decision.deltaCents };
}
