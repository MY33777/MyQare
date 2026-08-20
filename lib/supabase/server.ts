import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Auth-aware client for Server Components, Server Actions and Route Handlers.
 *
 * Runs as the signed-in user, so every query is subject to Row Level Security.
 * That is the point: use this by default, and reach for the admin client only
 * where a write genuinely has to cross a user boundary.
 */
export async function createClient() {
  // Async in Next 16 — synchronous cookie access was removed entirely, not
  // merely deprecated.
  const cookieStore = await cookies();

  /*
   * Named, not asserted. These were read with `!`, a TypeScript assertion that
   * compiles to nothing — so with the variables unset, createServerClient got
   * undefined and threw whatever it felt like, several frames from the cause.
   *
   * NEXT_PUBLIC_* values are inlined at BUILD time, so setting them in Vercel
   * without redeploying changes nothing. That is the part that costs an hour, and
   * it is why the message says it.
   */
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. " +
        "Set both in the Vercel dashboard AND redeploy — NEXT_PUBLIC_* variables are " +
        "baked in at build time, so an existing deployment will not pick them up.",
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Harmless as long as proxy.ts is also refreshing the session.
        }
      },
    },
  });
}
