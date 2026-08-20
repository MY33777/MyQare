"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { clientIp, isRateLimited, recordRateLimitHit } from "@/lib/rateLimit";
import { absoluteUrl } from "@/lib/site";

/*
 * Two ceilings, for two different harms.
 *
 * Per client: somebody working through a list of addresses to see which bounce,
 * or simply hammering our mail sender. Charged to them, so it costs nobody else.
 *
 * Per address: mail-bombing one inbox. This one IS keyed on something the caller
 * types, which is the shape that made sign-in lockable — but the consequence is
 * different in kind. Tripping it does not lock anyone out of anything: the links
 * already delivered are valid for an hour, so a victim whose budget somebody
 * burned has eight working recovery links sitting in the inbox they are about to
 * open. Sized to bound the spam, not to gate the account.
 */
const RESETS_PER_ADDRESS = 8;
const RESETS_PER_CLIENT = 15;
const RESET_WINDOW_SECONDS = 3600;

export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) redirect("/wachtwoord-vergeten?error=missing_fields");

  const ip = await clientIp();
  const addressBucket = `reset:${email}`;
  const clientBucket = ip ? `reset_ip:${ip}` : null;

  const blocked =
    (await isRateLimited(addressBucket, RESETS_PER_ADDRESS, RESET_WINDOW_SECONDS)) ||
    (clientBucket
      ? await isRateLimited(clientBucket, RESETS_PER_CLIENT, RESET_WINDOW_SECONDS)
      : false);

  /*
   * Reports the same success it reports for an address with no account, rather
   * than "rate_limited". Saying "you have asked too often" about an address the
   * caller merely typed confirms nothing about whether it exists — but saying it
   * ONLY sometimes would, and it tells whoever is probing that their traffic is
   * being counted. Nothing is sent; nothing is admitted.
   */
  if (blocked) redirect("/wachtwoord-vergeten?sent=1");

  await recordRateLimitHit(addressBucket);
  if (clientBucket) await recordRateLimitHit(clientBucket);

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    /*
     * Through the callback, which is what actually turns the emailed code into a
     * session. Pointing at /wachtwoord-herstellen directly — as this did — meant
     * the code arrived somewhere that could not spend it, and recovery worked for
     * nobody. See app/auth/callback/route.ts.
     */
    redirectTo: absoluteUrl("/auth/callback?next=%2Fwachtwoord-herstellen"),
  });

  /*
   * Always reports success, even for an address with no account. The error is
   * deliberately not surfaced: a form that says "no account with this email" is an
   * account-enumeration oracle, and for a platform whose users are named
   * healthcare workers, confirming who does and does not have an account is worth
   * more to an attacker than it sounds.
   */
  redirect("/wachtwoord-vergeten?sent=1");
}
