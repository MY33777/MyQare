import type { NextRequest } from "next/server";

/**
 * Guards a cron route.
 *
 * Vercel signs scheduled invocations with CRON_SECRET as a bearer token. Without
 * this check the endpoints are public URLs that send email — anyone who found
 * /api/cron/invoice-reminders could fire reminders at every facility in the
 * system, repeatedly.
 *
 * Fails CLOSED, unlike lib/rateLimit.ts: a missing secret refuses rather than
 * allows, because the downside here is outbound email to customers rather than a
 * blocked form.
 */
export function cronAuthorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
