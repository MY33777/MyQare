import Stripe from "stripe";

let cached: Stripe | null = null;

/**
 * Lazily constructed so a missing key is an error at the moment payment is
 * attempted, not at module load — which would take down every page that happens
 * to import anything from this file.
 */
export function getStripe(): Stripe {
  if (cached) return cached;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY ontbreekt. Zet hem in .env.local én in het Vercel-dashboard.",
    );
  }

  cached = new Stripe(key);
  return cached;
}

/** Whether top-ups can be offered at all. Lets the UI explain rather than crash. */
export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}
