"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mapAuthError } from "@/lib/authErrors";
import { checkRateLimit } from "@/lib/rateLimit";
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

  const allowed = await checkRateLimit(`signup:${email.toLowerCase()}`, 5, 3600);
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
      emailRedirectTo: absoluteUrl("/onboarding"),
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
