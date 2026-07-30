import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Crude fixed-window rate limit, backed by a table.
 *
 * Not a distributed token bucket, and does not need to be: the things it guards
 * are human-paced actions — posting a shift, accepting one, uploading a
 * document. It exists so a buggy client or someone poking the API cannot create
 * ten thousand offers, each of which sends an email.
 *
 * Deliberately fails **open**. If the limiter itself errors, letting a legitimate
 * coordinator post tomorrow's night shift matters more than perfectly enforcing
 * a soft cap. Anything where failing open is unacceptable belongs behind a
 * database constraint instead — which is why double-charging is prevented by the
 * unique index on stripe_payment_intent, not by this.
 */
export async function checkRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const admin = getSupabaseAdmin();
    const since = new Date(Date.now() - windowSeconds * 1000).toISOString();

    const { count, error } = await admin
      .from("rate_limit_hits")
      .select("id", { count: "exact", head: true })
      .eq("bucket", bucket)
      .gte("created_at", since);

    if (error) return true;
    if ((count ?? 0) >= limit) return false;

    await admin.from("rate_limit_hits").insert({ bucket });
    return true;
  } catch {
    return true;
  }
}
