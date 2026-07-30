"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mapAuthError } from "@/lib/authErrors";
import { safeNextPath } from "@/lib/nextPath";
import { checkRateLimit } from "@/lib/rateLimit";

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? "")) ?? "/";

  const backTo = (code: string) =>
    `/login?error=${code}&next=${encodeURIComponent(next)}`;

  if (!email || !password) redirect(backTo("missing_fields"));

  /*
   * Keyed on the email rather than an IP. Vercel puts every request behind its
   * own edge, so IPs are a poor identifier here, and the attack this actually
   * blunts is password-guessing against one known account.
   */
  const allowed = await checkRateLimit(`signin:${email.toLowerCase()}`, 10, 300);
  if (!allowed) redirect(backTo("rate_limited"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) redirect(backTo(mapAuthError(error.message)));

  redirect(next);
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
