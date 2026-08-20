import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/nextPath";

const PROTECTED_PREFIXES = ["/zorginstelling", "/professional", "/beheer", "/onboarding"];
const AUTH_PAGES = ["/login", "/registreren"];

/**
 * Session refresh plus an optimistic redirect for logged-out visitors.
 *
 * NOT a security boundary — see the long comment in lib/auth.ts. Two jobs only:
 * keep the Supabase session cookie fresh, and save a signed-out visitor from
 * rendering a page shell they cannot use. The pages themselves re-check.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  /*
   * Fail OPEN. Both of this function's jobs are optional; taking the site down is
   * not one of them.
   *
   * These used to be read with `!`, which is a TypeScript assertion that compiles
   * to nothing. With the variables unset — a fresh Vercel project before anyone
   * has filled them in — createServerClient received undefined and threw, and
   * because the matcher below covers nearly every path, EVERY request 500'd. The
   * public marketing site, robots.txt and the statically generated pages all went
   * down over a missing key none of them use.
   *
   * Passing the request through is safe precisely because this is not a security
   * boundary: lib/auth.ts re-checks on every protected page and server action,
   * and those fail loudly on their own. The worst case here is a stale session
   * cookie and no optimistic redirect.
   */
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error(
      "[proxy] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. " +
        "Session refresh is disabled; protected pages will redirect to /login. " +
        "These are inlined at BUILD time, so set them in Vercel and redeploy.",
    );
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  /*
   * Required: this call is what refreshes an expiring session. Removing it causes
   * intermittent logouts that are maddening to reproduce, because they only
   * happen once a token actually ages out.
   *
   * Wrapped for the same reason as the check above: Supabase being unreachable is
   * a bad afternoon, not a reason for the marketing site to return 500.
   */
  let user = null;
  try {
    ({
      data: { user },
    } = await supabase.auth.getUser());
  } catch (error) {
    console.error(`[proxy] session refresh failed: ${String(error)}`);
    return response;
  }

  const path = request.nextUrl.pathname;

  if (!user && PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    const url = new URL("/login", request.url);
    // Preserve the query string too: a shift link arrives as
    // /professional/diensten/<id>, and dropping it means a freelancer who
    // clicked a notification lands somewhere generic instead of on the shift.
    url.searchParams.set("next", `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  if (user && AUTH_PAGES.includes(path)) {
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    return NextResponse.redirect(new URL(next ?? "/", request.url));
  }

  return response;
}
