"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { mapAuthError } from "@/lib/authErrors";
import {
  bucketKey,
  checkRateLimit,
  clientIp,
  isRateLimited,
  recordRateLimitHit,
} from "@/lib/rateLimit";
import { absoluteUrl } from "@/lib/site";
import { clearFormDraft, saveFormDraft } from "@/lib/formDraft";

/** Scopes the draft cookie to this form. See lib/formDraft.ts. */
const DRAFT_KEY = "signup";
const DRAFT_PATH = "/registreren";

const MIN_PASSWORD_LENGTH = 8;

export async function signUpAction(formData: FormData) {
  /*
   * Everything typed, kept, before anything can send them back.
   *
   * A validation redirect empties the form. On this one that means a name, an
   * email address and a chosen role retyped on a phone. Stored in an httpOnly
   * cookie rather than the query string precisely because two of those are
   * personal data about a named healthcare worker, and a query string ends up
   * in history, referrers and every access log on the way. Passwords are
   * dropped by saveFormDraft itself.
   */
  await saveFormDraft(DRAFT_KEY, formData, DRAFT_PATH);

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

  /*
   * Keyed on the CLIENT, not on the address, per the rule written in
   * lib/rateLimit.ts: a bucket keyed on something a stranger shares with the
   * victim may count and be logged, but must not GATE an action whose refusal
   * harms the person who did not spend it.
   *
   * This gated on the email alone, so five attempts against any address blocked
   * that address from registering for an hour — renewable, from a script,
   * against somebody who has not signed up yet and cannot tell why it will not
   * work. That is the same shape as the sign-in lockout the login action was
   * rewritten to remove, in the file whose own comment forbids it.
   *
   * The address still gets a ceiling because signing up sends mail, and mail to
   * an address the caller typed is a way to fill somebody's inbox — but tripping
   * it now reports the same "check your email" as success, so nothing is
   * confirmed and nobody is told their address is blocked.
   */
  const ip = await clientIp();
  const clientBucket = ip ? bucketKey("signup_ip", ip) : null;
  const addressBucket = bucketKey("signup", email.toLowerCase());

  if (clientBucket && (await isRateLimited(clientBucket, 20, 3600))) {
    redirect(backTo("rate_limited"));
  }

  const mailBudgetLeft = !(await isRateLimited(addressBucket, 5, 3600));

  await recordRateLimitHit(addressBucket);
  if (clientBucket) await recordRateLimitHit(clientBucket);

  /*
   * Out of mail budget — but only a RESEND is suppressed, never a first signup.
   *
   * This skipped supabase.auth.signUp entirely and redirected to the confirmation
   * page, so no account was created at all. The comment above calls the address
   * bucket "a ceiling on mail" and cites the rule in lib/rateLimit.ts that a
   * bucket keyed on something a stranger shares with the victim must not gate an
   * action whose refusal harms the person who did not spend it. It gated the
   * action, and the previous version at least told the caller; this one shows the
   * same page as success, so somebody blocked from registering by five requests
   * from a script waits for a confirmation email that was never sent.
   *
   * The distinction that makes the ceiling legitimate is whether the address
   * already has an account. If it does, this submission would only re-send mail
   * to somebody who can already sign in or reset their password, and suppressing
   * that harms nobody. If it does not, this is a first registration and it
   * proceeds — abuse from one machine is what the client bucket above is for.
   *
   * The check runs with the service role and its answer never reaches the
   * response: both branches below render the same confirmation page, so this
   * cannot be used to find out whether an address is registered.
   */
  if (!mailBudgetLeft && (await addressHasAccount(email))) {
    redirect("/registreren/bevestig?email=" + encodeURIComponent(email));
  }

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

  // Registered. The draft is now somebody else's half-finished form waiting
  // to repopulate the next one on a shared workstation.
  await clearFormDraft(DRAFT_KEY, DRAFT_PATH);

  // The address rides along so /registreren/bevestig can name it and prefill the
  // resend field. It is re-read from the form there, never trusted from the URL.
  redirect(`/registreren/bevestig?email=${encodeURIComponent(email)}`);
}

/**
 * Sends the confirmation mail again.
 *
 * /registreren/bevestig had no controls at all, so the two things that actually
 * happen there — the mail lands in spam, or it never arrives — both ended with
 * the person closing the tab. There was no route back into their own account.
 *
 * The address comes from the FORM, never from the query string. Somebody can
 * arrive at that page with any ?email= they like, and a resend endpoint that
 * mails whatever the URL says is a way to send mail from our domain to a
 * stranger — a small open relay with our branding on it.
 */
export async function resendConfirmationAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const back = (query: string) => `/registreren/bevestig?${query}`;

  if (!email) redirect(back("error=missing_fields"));

  /*
   * Per address and per client, same shape as the password-reset form and for
   * the same reason: this sends mail to an address the caller typed, so it is a
   * way to fill somebody's inbox. Tripping it reports success rather than
   * "rate_limited" — saying "you have asked too often" about an address confirms
   * nothing about whether it exists, but saying it only SOMETIMES would.
   */
  const ip = await clientIp();
  const blocked =
    (await isRateLimited(bucketKey("resend", email), 5, 3600)) ||
    (ip ? await isRateLimited(bucketKey("resend_ip", ip), 15, 3600) : false);

  if (blocked) redirect(back(`sent=1&email=${encodeURIComponent(email)}`));

  await recordRateLimitHit(bucketKey("resend", email));
  if (ip) await recordRateLimitHit(bucketKey("resend_ip", ip));

  const supabase = await createClient();

  /*
   * The error is deliberately not surfaced. Supabase refuses to resend for an
   * address with no pending signup, and reporting that would turn this form into
   * an account-enumeration oracle — the same reason the password-reset form
   * always reports success. For a platform whose users are named healthcare
   * workers, confirming who has an account is worth more to an attacker than it
   * sounds.
   */
  await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: absoluteUrl("/auth/callback?next=%2Fonboarding") },
  });

  redirect(back(`sent=1&email=${encodeURIComponent(email)}`));
}

/**
 * Whether an address already has an account, for the mail ceiling only.
 *
 * Service role, and the answer never leaves the server: both callers render the
 * same confirmation page whichever way it goes. lookup_account_by_email returns
 * an id and nothing else, and is revoked from anon and authenticated.
 *
 * A failed lookup answers FALSE — treat it as a first registration and let the
 * signup proceed. The alternative fails the wrong way: a database blip would
 * silently refuse to create accounts.
 */
async function addressHasAccount(email: string): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("lookup_account_by_email", {
      p_email: email,
    });
    if (error) {
      console.error(`[registreren] account lookup failed: ${error.message}`);
      return false;
    }
    return Boolean(data);
  } catch {
    return false;
  }
}
