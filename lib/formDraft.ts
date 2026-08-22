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
    /*
     * A repeated field keeps ALL its values.
     *
     * This was `draft[name] = value`, so a control submitting several entries
     * under one name collapsed to the last one — and the only such control in
     * the product is the region multi-select on onboarding, where losing the
     * extras silently narrows where somebody receives work. The page then read
     * it back with split(","), an encoding this function never produced, so the
     * restore was broken in both directions at once and no test touched it.
     *
     * Stored as an array only when there IS more than one, so every existing
     * single-value caller keeps reading a plain string.
     */
    const collected = new Map<string, string[]>();

    for (const [name, value] of formData.entries()) {
      if (!isStorable(name, value)) continue;
      if (!value) continue;
      if (!collected.has(name)) collected.set(name, []);
      collected.get(name)!.push(value.slice(0, MAX_VALUE_LENGTH));
    }

    const draft: Record<string, string | string[]> = {};
    for (const [name, values] of collected) {
      draft[name] = values.length === 1 ? values[0] : values;
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
): Promise<Record<string, string | string[]>> {
  if (!onlyWhenErrored) return {};

  try {
    const raw = (await cookies()).get(draftName(key))?.value;
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    /*
     * Strings and arrays-of-strings only. The cookie is ours, but a corrupted one
     * must not put an object into a defaultValue, and an array of anything else
     * must not reach a multi-select.
     */
    const out: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[name] = value;
      else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        out[name] = value as string[];
      }
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


/**
 * One value from a draft, for a single-value control.
 *
 * Drafts now hold arrays for repeated fields, and every caller that feeds a
 * plain input needs a string. Takes the first entry rather than joining: a
 * single-value control that somehow received two should show one of them, not
 * "a,b" in a text box.
 */
export function draftValue(
  draft: Record<string, string | string[]>,
  name: string,
): string | undefined {
  const value = draft[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

/** Every value from a draft, for a multi-select. */
export function draftValues(
  draft: Record<string, string | string[]>,
  name: string,
): string[] | undefined {
  const value = draft[name];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  return undefined;
}
