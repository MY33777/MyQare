import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { recordLedgerEntry } from "@/lib/credits";

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

  return NextResponse.json({ received: true });
}
