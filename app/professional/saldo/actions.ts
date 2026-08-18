"use server";

import { redirect } from "next/navigation";
import { getFreelancer } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { clampTopupCents } from "@/lib/credits";
import { parseEurosToCents } from "@/lib/money";
import { absoluteUrl } from "@/lib/site";

const SALDO_PATH = "/professional/saldo";

export async function startTopupAction(formData: FormData) {
  const freelancer = await getFreelancer();
  if (!freelancer) redirect("/login?next=%2Fprofessional%2Fsaldo");

  const requested = parseEurosToCents(String(formData.get("amount") ?? ""));
  if (requested === null) redirect(`${SALDO_PATH}?error=invalid_amount`);

  const amountCents = clampTopupCents(requested);

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    // iDEAL is how the Netherlands pays. Card is kept as a fallback for anyone
    // billing through a foreign account.
    payment_method_types: ["ideal", "card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: amountCents,
          product_data: {
            name: "MyQare saldo",
            description: "Saldo voor de bemiddelingsvergoeding van 5% per aangenomen dienst.",
          },
        },
      },
    ],
    /*
     * The profile id travels on the session and comes back on the webhook, which
     * is the only place the ledger is actually credited. The success redirect is
     * not proof of payment — the customer can close the tab, and anyone can
     * request that URL directly.
     */
    metadata: { profile_id: freelancer.userId },
    success_url: absoluteUrl(`${SALDO_PATH}?topup=success`),
    cancel_url: absoluteUrl(`${SALDO_PATH}?topup=cancelled`),
  });

  if (!session.url) redirect(`${SALDO_PATH}?error=unknown`);

  redirect(session.url);
}
