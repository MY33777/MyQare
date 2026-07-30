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

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    },
  );
}
