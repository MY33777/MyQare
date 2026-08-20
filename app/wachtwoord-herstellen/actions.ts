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
   * EVERY session signed out, including this one.
   *
   * Somebody resetting a password may be doing it because a session is in hands
   * that should not have it. Leaving those alive means the new password changes
   * nothing for the next hour of refresh-token life.
   *
   * This used to sign out "others" and keep the current session, which quietly
   * broke the last step: proxy.ts redirects a signed-in visitor away from /login,
   * so /login?reset=1 bounced straight to the marketing homepage and the person
   * who had just reset their password never saw a word of confirmation. Signing
   * out fully fixes that and is the better answer anyway — proving the new
   * password works by using it beats being told it was saved.
   */
  await supabase.auth.signOut();

  redirect("/login?reset=1");
}
