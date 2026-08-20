"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mapAuthError } from "@/lib/authErrors";
import { safeNextPath } from "@/lib/nextPath";
import { clientIp, isRateLimited, recordRateLimitHit } from "@/lib/rateLimit";

/*
 * Per client, per hour. Generous enough that a shared office address running a
 * few fat-fingered logins never notices, tight enough that guessing a password
 * from one machine is hopeless.
 */
const FAILURES_PER_ACCOUNT = 10;
const FAILURES_PER_CLIENT = 50;
const FAILURE_WINDOW_SECONDS = 900;

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? "")) ?? "/";

  const backTo = (code: string) =>
    `/login?error=${code}&next=${encodeURIComponent(next)}`;

  if (!email || !password) redirect(backTo("missing_fields"));

  /*
   * Keyed on the CLIENT, and spent only by a wrong password.
   *
   * This used to be `signin:<email>`, 10 per 5 minutes, charged on every attempt.
   * The email is typed into the form by whoever is asking, so ten deliberate
   * wrong passwords against any address on the platform locked that address out
   * — renewable forever, from a script, against a nurse who then cannot accept
   * tonight's shift. The limiter was doing the attacker's work.
   *
   * Two things fix it. The bucket now includes the caller's address, so the
   * budget being burned is the guesser's own; and nothing is spent unless the
   * password was actually wrong, so a person who knows their password is never
   * turned away no matter how much noise has been made against their account.
   *
   * With no client address available we fall back to the email alone, which is
   * the old shape and the old exposure — but the numbers below are per fifteen
   * minutes rather than per five, and on Vercel the header is always set.
   */
  const ip = await clientIp();
  const account = `signin_fail:${email.toLowerCase()}:${ip ?? "noip"}`;
  const client = ip ? `signin_fail_ip:${ip}` : null;

  const blocked =
    (await isRateLimited(account, FAILURES_PER_ACCOUNT, FAILURE_WINDOW_SECONDS)) ||
    (client
      ? await isRateLimited(client, FAILURES_PER_CLIENT, FAILURE_WINDOW_SECONDS)
      : false);

  if (blocked) redirect(backTo("rate_limited"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Charged here, after the fact, so a correct password costs nothing.
    await recordRateLimitHit(account);
    if (client) await recordRateLimitHit(client);
    redirect(backTo(mapAuthError(error.message)));
  }

  redirect(next);
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
