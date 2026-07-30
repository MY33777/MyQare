import { createBrowserClient } from "@supabase/ssr";

/** Auth-aware client for Client Components. Reads and writes the session cookie. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
