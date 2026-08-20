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

  const failed = (reason: string) =>
    NextResponse.redirect(new URL(`/wachtwoord-vergeten?error=${reason}`, url.origin));

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
