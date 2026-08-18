"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mapAuthError } from "@/lib/authErrors";

const MIN_PASSWORD_LENGTH = 8;

export async function setNewPasswordAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("password_confirm") ?? "");

  if (!password) redirect("/wachtwoord-herstellen?error=missing_fields");
  if (password !== confirm) redirect("/wachtwoord-herstellen?error=passwords_differ");
  if (password.length < MIN_PASSWORD_LENGTH) redirect("/wachtwoord-herstellen?error=weak_password");

  const supabase = await createClient();

  /*
   * The recovery link puts a real session in the cookie before this runs, so
   * updateUser applies to whoever followed the link. That also means the check
   * that matters is simply "is there a session" — without one there is nothing to
   * update, and the request is either an expired link or someone guessing the URL.
   */
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/wachtwoord-vergeten?error=link_expired");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(`/wachtwoord-herstellen?error=${mapAuthError(error.message)}`);

  redirect("/login?reset=1");
}
