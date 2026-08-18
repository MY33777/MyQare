"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { absoluteUrl } from "@/lib/site";

export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) redirect("/wachtwoord-vergeten?error=missing_fields");

  // Keyed on the email rather than an IP, matching sign-in. Five an hour is far
  // more than a person needs and stops this being used to mail-bomb an address.
  const allowed = await checkRateLimit(`reset:${email}`, 5, 3600);
  if (!allowed) redirect("/wachtwoord-vergeten?error=rate_limited");

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: absoluteUrl("/wachtwoord-herstellen"),
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
