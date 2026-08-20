import { cookies } from "next/headers";

/*
 * Keeping what somebody typed when the server sends them back.
 *
 * A server action that validates and then redirects loses the whole submission —
 * the browser issues a fresh GET and every field comes back empty. Three forms in
 * this product do that, and the worst of them is the shift form: twelve fields, a
 * coordinator filling it in because somebody called in sick an hour ago, one
 * mistyped rate, and all of it gone. People retype it once. The second time they
 * phone an agency instead.
 *
 * WHY A COOKIE AND NOT THE QUERY STRING
 * -------------------------------------
 * The obvious fix is `?starts_at=...&hourly_rate=...`, and for the registration
 * and onboarding forms it is the wrong one: those carry a named healthcare
 * worker's full name, email address and phone number, and a query string ends up
 * in browser history, in the Referer header of every outbound link on the page,
 * and in every access log between here and the browser. This codebase already
 * hashes addresses out of the rate-limit table for exactly that reason — putting
 * the same class of data into a URL two directories away would be incoherent.
 *
 * httpOnly, so a script on the page cannot read it back. Path-scoped, so it is
 * only sent to the form it belongs to. Five minutes, because it exists to survive
 * one redirect and nothing longer.
 *
 * NEVER PASSWORDS
 * ---------------
 * The deny-list below is not a convenience. A password in a cookie is a password
 * written to disk on a shared ward workstation, and the registration form has two
 * of them. Anything whose name contains "password" is dropped before the cookie
 * is built, and the input type is irrelevant — the name is what we control.
 */

/** Five minutes: long enough for one redirect, short enough to be forgotten. */
const DRAFT_MAX_AGE_SECONDS = 300;

/**
 * Cookies must stay well under the 4KB browsers allow, and a draft is not a
 * document — a description longer than this is being pasted, not typed.
 */
const MAX_VALUE_LENGTH = 2000;
const MAX_COOKIE_BYTES = 3500;

/** Field names that must never be written down, matched case-insensitively. */
const NEVER_STORE = ["password", "wachtwoord", "token", "secret", "otp"];

function isStorable(name: string, value: FormDataEntryValue): value is string {
  if (typeof value !== "string") return false; // a File has no business here
  const lower = name.toLowerCase();
  return !NEVER_STORE.some((banned) => lower.includes(banned));
}

/**
 * Writes the submission so the form can be rebuilt after a redirect.
 *
 * Call once, before the first bail-out, so every validation path is covered
 * without each one having to remember. Silent on failure: losing a draft must
 * never turn into losing the action.
 */
export async function saveFormDraft(key: string, formData: FormData, path: string): Promise<void> {
  try {
    const draft: Record<string, string> = {};

    for (const [name, value] of formData.entries()) {
      if (!isStorable(name, value)) continue;
      if (!value) continue;
      draft[name] = value.slice(0, MAX_VALUE_LENGTH);
    }

    const encoded = JSON.stringify(draft);

    /*
     * Too big to store is not an error worth surfacing. The form comes back
     * empty, exactly as it did before this existed, and the alternative — a
     * silently truncated draft — would restore some fields and not others, which
     * is more confusing than restoring none.
     */
    if (Buffer.byteLength(encoded, "utf8") > MAX_COOKIE_BYTES) return;

    (await cookies()).set(draftName(key), encoded, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: DRAFT_MAX_AGE_SECONDS,
      path,
    });
  } catch {
    // cookies() throws outside a request scope, and a draft is never worth a 500.
  }
}

/**
 * Reads a draft back.
 *
 * `onlyWhenErrored` is the important argument. A draft read unconditionally
 * repopulates a form somebody opened fresh five minutes later with last time's
 * half-finished shift, which is worse than an empty form because it looks like
 * saved work. So the page passes whether it is rendering an error, and a draft is
 * only ever used to explain one.
 */
export async function readFormDraft(
  key: string,
  onlyWhenErrored: boolean,
): Promise<Record<string, string>> {
  if (!onlyWhenErrored) return {};

  try {
    const raw = (await cookies()).get(draftName(key))?.value;
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    // Values only, and strings only: the cookie is ours, but a corrupted one must
    // not put an object into a defaultValue.
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[name] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Drops a draft. Called on the success path, so a completed form leaves nothing. */
export async function clearFormDraft(key: string, path: string): Promise<void> {
  try {
    (await cookies()).set(draftName(key), "", { maxAge: 0, path });
  } catch {
    // As above.
  }
}

function draftName(key: string): string {
  return `myqare_draft_${key}`;
}
