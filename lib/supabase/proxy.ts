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

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    },
  );

  // Required: this call is what refreshes an expiring session. Removing it
  // causes intermittent logouts that are maddening to reproduce, because they
  // only happen once a token actually ages out.
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
