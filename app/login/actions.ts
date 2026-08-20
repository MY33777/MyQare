"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mapAuthError } from "@/lib/authErrors";
import { safeNextPath } from "@/lib/nextPath";
import { bucketKey, clientIp, isRateLimited, recordRateLimitHit } from "@/lib/rateLimit";

/*
 * Failures against ONE account from ONE client, per fifteen minutes.
 *
 * Both halves of the key are needed to spend from this, so the only person who
 * can exhaust a nurse's budget is somebody already sitting on her address AND
 * typing her email — at which point the budget is the least of it.
 */
const FAILURES_PER_ACCOUNT = 10;
const FAILURE_WINDOW_SECONDS = 900;

/*
 * Failures from one client, across every account it tries. NOT a gate.
 *
 * A previous version refused every request from an address that crossed this,
 * which locked out whole wards and VPNs: many people, one address. It is now
 * counted and logged so credential spraying is at least VISIBLE in the data,
 * and nothing is refused on the strength of it. See the long note in
 * lib/rateLimit.ts for why that asymmetry is the rule and not a compromise.
 */
const SPRAY_SIGNAL_PER_CLIENT = 50;

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? "")) ?? "/";

  const backTo = (code: string) =>
    `/login?error=${code}&next=${encodeURIComponent(next)}`;

  if (!email || !password) redirect(backTo("missing_fields"));

  const ip = await clientIp();

  /*
   * Hashed, so this table stops being a record of who tried to sign in from
   * where. The limiter only ever asks whether two attempts are the same one.
   */
  const account = bucketKey("signin_fail", email.toLowerCase(), ip);
  const client = ip ? bucketKey("signin_spray", ip) : null;

  /*
   * Only the account bucket gates, and only a WRONG password spends from it.
   *
   * Together those two properties mean a person who knows their own password is
   * never turned away — not by noise somebody else made against their address,
   * not by a colleague on the same wifi getting their own password wrong, not by
   * anything a third party can do at all.
   */
  if (await isRateLimited(account, FAILURES_PER_ACCOUNT, FAILURE_WINDOW_SECONDS)) {
    redirect(backTo("rate_limited"));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Charged here, after the fact, so a correct password costs nothing.
    await recordRateLimitHit(account);

    if (client) {
      await recordRateLimitHit(client);

      /*
       * Reported, not enforced. Fifty failures from one address in a quarter of
       * an hour is either a spray or a very bad afternoon on a ward; either way
       * somebody should be able to find out, and neither is a reason to refuse
       * the next person who types their password correctly.
       */
      if (await isRateLimited(client, SPRAY_SIGNAL_PER_CLIENT, FAILURE_WINDOW_SECONDS)) {
        console.warn(
          `[login] ${SPRAY_SIGNAL_PER_CLIENT}+ failed sign-ins from one client in ` +
            `${FAILURE_WINDOW_SECONDS / 60} minutes (bucket ${client}). Possible credential spraying.`,
        );
      }
    }

    redirect(backTo(mapAuthError(error.message)));
  }

  redirect(next);
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
