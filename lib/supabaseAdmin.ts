import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Service-role client. **Bypasses Row Level Security entirely.**
 *
 * Only for writes that legitimately cross a user boundary, and there are only a
 * few in this product:
 *
 *   - the credit ledger, which has no client insert policy on purpose
 *     (supabase/schema.sql)
 *   - creating an assignment on accept, which must write the assignment, the
 *     fee and the compliance record together
 *   - allocating an invoice number, which must not leave a gap
 *   - the Stripe webhook, which arrives with no user session at all
 *
 * Every use is a place where RLS is not protecting you, so the caller must have
 * already established who the user is and what they may do — see lib/auth.ts.
 * Never import this into a Client Component: the key must not reach a browser.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Loud and specific: a missing service role key otherwise shows up as an
    // opaque 401 from Postgres much later, usually in production only, because
    // .env.local is never uploaded to Vercel.
    throw new Error(
      "Supabase admin client needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. " +
        "Both must be set in the Vercel dashboard as well as .env.local.",
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
