"use server";

import { redirect } from "next/navigation";
import { getFreelancer } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { MAX_TOPUP_CENTS, MIN_TOPUP_CENTS, clampTopupCents } from "@/lib/credits";
import { safeNextPath } from "@/lib/nextPath";
import { FEE_PERCENT_LABEL } from "@/lib/fees";
import { parseEurosToCents } from "@/lib/money";
import { absoluteUrl } from "@/lib/site";

const SALDO_PATH = "/professional/saldo";

export async function startTopupAction(formData: FormData) {
  const freelancer = await getFreelancer();
  if (!freelancer) redirect("/login?next=%2Fprofessional%2Fsaldo");

  /*
   * The webhook credits on a `freelancers` ROW. This checked `profiles.role`.
   *
   * Those are not the same condition. role is set at signup; the freelancers row
   * appears when onboarding is finished. In the gap between them — which is
   * exactly when somebody is setting their account up and most likely to try
   * topping it up — checkout opened, iDEAL took real money, and the webhook then
   * logged "top-up for unknown freelancer" and credited nothing. Gone from their
   * bank, present nowhere, on an append-only ledger with no clean way to put it
   * right afterwards.
   *
   * Checked here against the same table the webhook checks, so the two conditions
   * cannot be different. Nobody is sent to Stripe who cannot be credited.
   */
  const { data: onboarded } = await getSupabaseAdmin()
    .from("freelancers")
    .select("profile_id")
    .eq("profile_id", freelancer.userId)
    .maybeSingle<{ profile_id: string }>();

  if (!onboarded) redirect("/onboarding?error=finish_onboarding_first");

  const requested = parseEurosToCents(String(formData.get("amount") ?? ""));
  if (requested === null) redirect(`${SALDO_PATH}?error=invalid_amount`);

  /*
   * Refused, not silently corrected.
   *
   * clampTopupCents was applied straight to the Stripe line item, so typing
   * "10000" meaning ten thousand euros produced a checkout for five thousand —
   * a different amount from the one on the screen, with no warning, on a payment
   * page. The clamp is a last-line guard against a nonsense value reaching
   * Stripe, not a licence to change what somebody asked for.
   *
   * The rest of this product explains its rules rather than enforcing them
   * invisibly; a payment form is the last place to make an exception.
   */
  if (requested < MIN_TOPUP_CENTS) redirect(`${SALDO_PATH}?error=topup_too_low`);
  if (requested > MAX_TOPUP_CENTS) redirect(`${SALDO_PATH}?error=topup_too_high`);

  const amountCents = clampTopupCents(requested);

  /*
   * Where to go after paying.
   *
   * Somebody tops up because a shift they want costs more than their balance —
   * so the natural end of this journey is that shift, not this page. Sanitised
   * through safeNextPath: it arrives in a form field, and an unchecked value
   * here would make our own Stripe return an open redirect.
   */
  const next = safeNextPath(String(formData.get("next") ?? "")) ?? SALDO_PATH;

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
            description:
              `Saldo voor de bemiddelingsvergoeding van ${FEE_PERCENT_LABEL}% plus btw per aangenomen dienst.`,
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
    /*
     * Back to whatever they were doing. `topup=success` still rides along so the
     * destination can say the money arrived — and, on the shift page, so the
     * reader is not left wondering whether the balance shown is the new one.
     */
    success_url: absoluteUrl(`${next}${next.includes("?") ? "&" : "?"}topup=success`),
    cancel_url: absoluteUrl(`${next}${next.includes("?") ? "&" : "?"}topup=cancelled`),
  });

  if (!session.url) redirect(`${SALDO_PATH}?error=unknown`);

  redirect(session.url);
}
