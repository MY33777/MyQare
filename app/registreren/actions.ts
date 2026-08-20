"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mapAuthError } from "@/lib/authErrors";
import { bucketKey, checkRateLimit } from "@/lib/rateLimit";
import { absoluteUrl } from "@/lib/site";

const MIN_PASSWORD_LENGTH = 8;

export async function signUpAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("password_confirm") ?? "");
  const role = String(formData.get("role") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const orgName = String(formData.get("org_name") ?? "").trim();

  const backTo = (code: string) => `/registreren?error=${code}`;

  if (!email || !password || !fullName) redirect(backTo("missing_fields"));
  if (role !== "facility_admin" && role !== "freelancer") redirect(backTo("invalid_role"));
  if (password !== passwordConfirm) redirect(backTo("passwords_differ"));
  if (password.length < MIN_PASSWORD_LENGTH) redirect(backTo("weak_password"));
  if (role === "facility_admin" && !orgName) redirect(backTo("org_name_required"));

  const allowed = await checkRateLimit(bucketKey("signup", email.toLowerCase()), 5, 3600);
  if (!allowed) redirect(backTo("rate_limited"));

  const supabase = await createClient();

  /*
   * Role, name and organisation go into user_metadata rather than straight into
   * our own tables, because at this point the account is unconfirmed — there is
   * no session and nothing to hang a profile row off. /onboarding reads them back
   * and creates the real rows on first signed-in visit.
   *
   * This also fixes the case lib/auth.ts already anticipates: someone confirms
   * their email, closes the tab, and returns days later. Their answers are still
   * on the auth record rather than lost with the form.
   */
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      /*
       * Through the callback, exactly like password recovery.
       *
       * This pointed straight at /onboarding, which fails three separate ways:
       * Supabase refuses to redirect anywhere not on the project's allowlist and
       * only /auth/callback is on it; /onboarding is a Server Component and
       * cannot spend a ?code= even if it arrived, because writing the session
       * cookie needs a Route Handler; and /onboarding is in the proxy's
       * PROTECTED_PREFIXES, so an unauthenticated arrival is bounced to /login
       * with the code discarded. Every confirmation link a new account received
       * was broken.
       */
      emailRedirectTo: absoluteUrl("/auth/callback?next=%2Fonboarding"),
      data: {
        role,
        full_name: fullName,
        org_name: role === "facility_admin" ? orgName : null,
      },
    },
  });

  if (error) redirect(backTo(mapAuthError(error.message)));

  redirect("/registreren/bevestig");
}
