"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRecoveryUser } from "@/lib/auth";
import { mapAuthError } from "@/lib/authErrors";

const MIN_PASSWORD_LENGTH = 8;

export async function setNewPasswordAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("password_confirm") ?? "");

  if (!password) redirect("/wachtwoord-herstellen?error=missing_fields");
  if (password !== confirm) redirect("/wachtwoord-herstellen?error=passwords_differ");
  if (password.length < MIN_PASSWORD_LENGTH) redirect("/wachtwoord-herstellen?error=weak_password");

  /*
   * A recovery session, not merely a session.
   *
   * The old check was "is anybody signed in", which this form turns into "set a
   * new password without knowing the old one". Anyone who could reach a logged-in
   * browser — a borrowed phone, a shared workstation on a ward, a machine left
   * open in a break room — could take the account outright in three clicks.
   *
   * A session created by following the emailed link is marked as such in the
   * token Supabase signs. See lib/authSession.ts.
   */
  const user = await getRecoveryUser();
  if (!user) redirect("/wachtwoord-vergeten?error=needs_recovery_link");

  const supabase = await createClient();

  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(`/wachtwoord-herstellen?error=${mapAuthError(error.message)}`);

  /*
   * Everything else signed out.
   *
   * Somebody resetting a password may be doing it because a session is in hands
   * that should not have it. Leaving those sessions alive means the new password
   * changes nothing for the next hour of refresh-token life. "others" keeps this
   * request's own session so the redirect below lands somewhere sane.
   */
  await supabase.auth.signOut({ scope: "others" });

  redirect("/login?reset=1");
}
