import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/nextPath";

/**
 * Where every emailed link lands.
 *
 * WHY THIS FILE HAD TO EXIST
 * --------------------------
 * It did not, and password recovery was therefore broken end to end. The reset
 * mail pointed straight at /wachtwoord-herstellen, which is a Server Component;
 * Supabase appends a one-time `code` to that URL and expects the application to
 * exchange it for a session. Nothing did. So the page ran with whatever session
 * the browser already had:
 *
 *   - nobody signed in — every recovery link reported "deze link is verlopen",
 *     for everyone, always;
 *   - somebody signed in — the form appeared and changed THAT person's password
 *     without asking for the old one, which is the borrowed-laptop attack.
 *
 * One missing route produced both, which is why they are fixed together.
 *
 * The exchange has to happen in a Route Handler and not on the page: it writes
 * the session cookie, and cookies are read-only inside a Server Component. That
 * is also why the swallowed `setAll` in lib/supabase/server.ts is harmless here.
 *
 * TWO LINK SHAPES, DELIBERATELY
 * -----------------------------
 *   ?code=...        PKCE. Secure, but the verifier is a cookie on the browser
 *                    that ASKED for the reset — request it on a laptop, open the
 *                    mail on a phone, and it cannot work.
 *   ?token_hash=...  Verified against the auth server instead, so it works from
 *                    whichever device opened the mail.
 *
 * Both are accepted because our users read work email on a phone. See SETUP.md
 * for the one template change that makes Supabase send the second kind.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  // Same sanitiser the login form uses: an emailed link is exactly the place
  // somebody would try to smuggle an off-site redirect through.
  const next = safeNextPath(url.searchParams.get("next")) ?? "/";

  /*
   * WHERE A FAILURE LANDS DEPENDS ON WHAT THE LINK WAS FOR.
   *
   * Every failure went to /wachtwoord-vergeten, which is right for a recovery
   * link and wrong for the other one every single account has to follow. A nurse
   * registers on the ward PC and opens the confirmation mail on her phone: the
   * PKCE verifier is a cookie on the PC, the exchange fails, and she landed on a
   * page headed "Wachtwoord vergeten" telling her to reopen the link in the
   * browser where she requested "het herstel" — a recovery she never asked for.
   * Her only control there is a password-reset form, which does not confirm an
   * account, and nothing on that page links to the one screen that can resend a
   * confirmation.
   *
   * The link type is what tells them apart: `type` on the token_hash form, and
   * the `next` destination on the PKCE form, which registerAction sets to
   * /onboarding.
   */
  const isSignup = type === "signup" || type === "email" || next.startsWith("/onboarding");

  const failed = (reason: "link_expired" | "link_wrong_device") =>
    NextResponse.redirect(
      new URL(
        isSignup
          ? `/registreren/bevestig?error=${
              reason === "link_wrong_device" ? "signup_link_wrong_device" : "signup_link_expired"
            }`
          : `/wachtwoord-vergeten?error=${reason}`,
        url.origin,
      ),
    );

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (error) return failed("link_expired");
    return NextResponse.redirect(new URL(next, url.origin));
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    /*
     * The most common cause is not an expired link but a different browser: the
     * PKCE verifier lives in a cookie the requesting browser holds. Said plainly
     * on the page this redirects to, because "verlopen" sends people to request
     * a second link that fails the same way.
     */
    if (error) return failed("link_wrong_device");
    return NextResponse.redirect(new URL(next, url.origin));
  }

  return failed("link_expired");
}
