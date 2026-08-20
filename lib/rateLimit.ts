import { headers } from "next/headers";
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
 *
 * WHO PAYS FOR A HIT
 * ------------------
 * A bucket keyed on something the *caller* supplies rather than something they
 * had to prove is not a rate limit, it is a remote off switch for somebody
 * else's account. `signin:<email>` was exactly that: ten wrong passwords against
 * a stranger's address locked that address out for five minutes, renewable
 * forever, and the person being locked out had done nothing.
 *
 * So the rule is: **budget is consumed by whoever is doing the work.** Buckets
 * that guard an account are keyed on the client, and only a FAILED attempt
 * spends anything, so a correct password always gets in no matter how much
 * noise somebody else has made against that address. Buckets that guard a
 * shared resource (an inbox, our mail sender) may be keyed on the target, and
 * are sized so that tripping one costs the victim nothing they cannot recover.
 */
export async function checkRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  if (await isRateLimited(bucket, limit, windowSeconds)) return false;
  await recordRateLimitHit(bucket);
  return true;
}

/**
 * Reads the counter WITHOUT spending from it.
 *
 * Split out so a caller can decide after the fact whether an attempt should have
 * cost anything — see the sign-in action, where only a wrong password does.
 */
export async function isRateLimited(
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

    // Fails open, as above.
    if (error) return false;
    return (count ?? 0) >= limit;
  } catch {
    return false;
  }
}

/** Spends one unit from a bucket. Silent on failure — see the fail-open note. */
export async function recordRateLimitHit(bucket: string): Promise<void> {
  try {
    await getSupabaseAdmin().from("rate_limit_hits").insert({ bucket });
  } catch {
    // Nothing useful to do: refusing the action because we could not write a
    // counter would turn a bookkeeping problem into an outage.
  }
}

/**
 * The client's address, for buckets that must charge the caller.
 *
 * `x-forwarded-for` is spoofable in general, but Vercel's edge sets both of
 * these itself and does not pass a client-supplied value through, so on the
 * deployment this runs on they are trustworthy. Even where they are not, the
 * failure mode is the safe one: forging a fresh address each request *evades*
 * the limit, it does not let anybody lock a third party out. That asymmetry is
 * the whole reason these buckets are keyed this way.
 *
 * Returns null rather than a constant when no header is present — a shared
 * fallback key would put every visitor in one bucket, which is the lockout this
 * is here to prevent, arrived at from the other direction.
 */
export async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();

    // x-real-ip is a single address; XFF is a chain and its FIRST entry is the
    // client (Vercel rewrites the header, so there is no untrusted prefix).
    const real = h.get("x-real-ip")?.trim();
    if (real) return real;

    const forwarded = h.get("x-forwarded-for");
    const first = forwarded?.split(",")[0]?.trim();
    return first || null;
  } catch {
    // headers() throws outside a request scope.
    return null;
  }
}
