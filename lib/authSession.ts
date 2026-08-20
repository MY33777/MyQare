/**
 * Reading how somebody proved who they are, out of the token that says so.
 *
 * Supabase signs an `amr` claim — "authentication methods references", RFC 8176
 * — into every access token, listing how the session was established and when:
 *
 *     "amr": [{ "method": "password", "timestamp": 1755000000 }]
 *
 * A session created by following a password-recovery link carries `"recovery"`.
 * That is the difference between "this person proved they can read the mailbox
 * on the account" and "this person walked up to an unlocked laptop", and the
 * reset form has to be able to tell them apart.
 *
 * The claim is inside a token Supabase signed, so it cannot be forged by the
 * browser holding it. It is read here WITHOUT verifying that signature, which is
 * fine for this one purpose and nothing else: the token came from the Supabase
 * client, which already verified it against the auth server, and the worst a
 * corrupted claim can do here is refuse a password change.
 */

export type AmrEntry = { method: string; timestamp?: number };

/** Methods that mean "arrived here from a link sent to the account's mailbox". */
const RECOVERY_METHODS = new Set(["recovery", "otp", "magiclink"]);

/**
 * How long after following the link the reset form stays open.
 *
 * Supabase's recovery links expire in an hour by default; there is no reason for
 * the window this grants to outlive them.
 */
export const RECOVERY_MAX_AGE_SECONDS = 3600;

/** The payload of a JWT, without verifying it. Null if it is not a JWT at all. */
export function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    // base64url, which Buffer's "base64" mode accepts once the two substitutions
    // are undone. Padding is optional for Buffer but not for every decoder, so
    // it is restored rather than relied upon.
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    const parsed: unknown = JSON.parse(json);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The amr entries in a token, newest last. Empty when the claim is absent. */
export function amrFromToken(token: string | null | undefined): AmrEntry[] {
  const payload = decodeJwtPayload(token);
  const raw = payload?.amr;
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry): AmrEntry[] => {
    if (!entry || typeof entry !== "object") return [];
    const method = (entry as { method?: unknown }).method;
    if (typeof method !== "string") return [];

    const timestamp = (entry as { timestamp?: unknown }).timestamp;
    return [{ method, timestamp: typeof timestamp === "number" ? timestamp : undefined }];
  });
}

/**
 * Did this session come from a recovery link, recently enough to still count?
 *
 * `nowSeconds` is a parameter so the test does not have to move the clock.
 *
 * A session refreshed after following the link keeps its amr entries, so a slow
 * reader is not thrown out mid-form — but the timestamp is the moment the link
 * was followed, so the window does not renew itself either.
 */
export function isRecoveryToken(
  token: string | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const entries = amrFromToken(token);

  return entries.some((entry) => {
    if (!RECOVERY_METHODS.has(entry.method)) return false;

    // No timestamp: Supabase always writes one, so treat its absence as a token
    // we do not recognise rather than as a session that never ages out.
    if (typeof entry.timestamp !== "number") return false;

    const age = nowSeconds - entry.timestamp;
    return age >= 0 && age <= RECOVERY_MAX_AGE_SECONDS;
  });
}
