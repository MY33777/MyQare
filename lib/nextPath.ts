/**
 * Sanitises a `?next=` redirect target.
 *
 * Without this, `/login?next=https://evil.example/phish` turns our own login
 * form into an open redirect: the user sees a myqare.com URL, signs in, and gets
 * handed to someone else's page. Only same-site absolute paths survive.
 *
 * Protocol-relative URLs ("//evil.example") are the case that catches people out
 * — they start with a slash but the browser treats them as a different origin.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  // A backslash is normalised to a forward slash by some browsers, so "/\evil"
  // can escape the origin too.
  if (value.includes("\\")) return null;
  return value;
}
