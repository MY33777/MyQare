import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { recordLedgerEntry } from "@/lib/credits";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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
    const { data: recipient } = await getSupabaseAdmin()
      .from("freelancers")
      .select("profile_id")
      .eq("profile_id", profileId)
      .maybeSingle<{ profile_id: string }>();

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
   * Money going back out.
   *
   * There was no handler for any of this. Somebody could top up €500, spend it
   * accepting shifts, dispute the charge with their bank, and keep the balance —
   * Stripe pulls the money back, MyQare never hears, and the ledger still says
   * they have it.
   *
   * charge.refunded covers a refund we or Stripe issued; charge.dispute.created
   * covers a chargeback, and deliberately reverses at the moment the dispute is
   * OPENED rather than when it is lost. The funds are withdrawn immediately either
   * way, and leaving spendable balance in place during a dispute is exactly the
   * window somebody would use.
   */
  if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    const reversal = await reverseCharge(event);
    return NextResponse.json({ received: true, ...reversal });
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
  const charge =
    event.type === "charge.refunded"
      ? (event.data.object as Stripe.Charge)
      : ((event.data.object as Stripe.Dispute).charge as Stripe.Charge | string);

  const paymentIntent =
    typeof charge === "string"
      ? charge
      : typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : (charge.payment_intent?.id ?? charge.id);

  if (!paymentIntent) return { skipped: "no_payment_intent" };

  const admin = getSupabaseAdmin();

  const { data: original } = await admin
    .from("credit_ledger")
    .select("profile_id, delta_cents")
    .eq("stripe_payment_intent", paymentIntent)
    .eq("reason", "topup")
    .maybeSingle<{ profile_id: string; delta_cents: number }>();

  // Nothing was ever credited for this payment, so there is nothing to take back.
  if (!original) return { skipped: "no_matching_topup" };

  try {
    await recordLedgerEntry({
      profileId: original.profile_id,
      // Negative: the credit leaves the balance. Exactly what was granted, so a
      // reversal can never remove more than the top-up put in.
      deltaCents: -original.delta_cents,
      reason: "chargeback",
      /*
       * Prefixed so it is unique against the top-up's own row while still getting
       * idempotency from the same index. Stripe redelivers dispute events as
       * readily as payment ones, and reversing twice would be the mirror of the
       * bug this fixes.
       */
      stripePaymentIntent: `reversal:${paymentIntent}`,
      note:
        event.type === "charge.refunded"
          ? "Terugbetaling van een opwaardering"
          : "Opwaardering teruggeboekt na een betaalgeschil",
    });
  } catch (error) {
    // 500 so Stripe retries. Balance that should be gone and is not is the same
    // class of problem as balance that was paid for and never arrived.
    const message = error instanceof Error ? error.message : "reversal failed";
    console.error(`[stripe] reversal failed for ${paymentIntent}: ${message}`);
    throw error;
  }

  return { reversed: original.delta_cents };
}
