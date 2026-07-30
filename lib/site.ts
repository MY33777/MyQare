/*
 * The one canonical origin. Read from the environment so preview deployments
 * and local development don't have to be special-cased, but with a hardcoded
 * production fallback — a missing env var should degrade to the right absolute
 * URL in an emailed invoice, not to `undefined/invoices/123`.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://myqare.com";

export const SITE_NAME = "MyQare";

/** Absolute URL for links that leave the app — emails, invoice PDFs. */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
