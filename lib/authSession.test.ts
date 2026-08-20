import { describe, expect, it } from "vitest";
import {
  RECOVERY_MAX_AGE_SECONDS,
  amrFromToken,
  decodeJwtPayload,
  isRecoveryToken,
} from "@/lib/authSession";

/*
 * This decides whether the password reset form will accept a session, so both
 * failure directions are expensive: too strict and nobody can ever reset a
 * password, too loose and a borrowed unlocked phone takes the account.
 *
 * The tokens below are built rather than pasted so no real one ends up in the
 * repository, but the payload shape is Supabase's.
 */
const NOW = 1_755_000_000;

function token(payload: Record<string, unknown>): string {
  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  // The signature is never checked here — see the note in lib/authSession.ts —
  // so a placeholder is honest about what this test covers.
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.not-verified`;
}

describe("decodeJwtPayload", () => {
  it("reads a payload whose base64url needs padding restored", () => {
    // Chosen so the encoded payload length is not a multiple of four.
    const payload = { sub: "abc", role: "authenticated" };
    expect(decodeJwtPayload(token(payload))).toEqual(payload);
  });

  it.each([
    ["nothing", null],
    ["an empty string", ""],
    ["not a JWT at all", "sb_publishable_something"],
    ["only two segments", "header.payload"],
    ["a payload that is not JSON", "aGVhZGVy.bm90LWpzb24.sig"],
    ["a payload that is an array", `${Buffer.from('{"a":1}').toString("base64url")}.${Buffer.from("[1,2]").toString("base64url")}.sig`],
  ])("returns null for %s", (_label, value) => {
    expect(decodeJwtPayload(value as string | null)).toBeNull();
  });
});

describe("amrFromToken", () => {
  it("reads the methods Supabase writes", () => {
    const t = token({ amr: [{ method: "password", timestamp: NOW }] });
    expect(amrFromToken(t)).toEqual([{ method: "password", timestamp: NOW }]);
  });

  it("is empty when the claim is missing entirely", () => {
    expect(amrFromToken(token({ sub: "abc" }))).toEqual([]);
  });

  it("drops entries that are not shaped like an amr entry", () => {
    const t = token({
      amr: [null, "recovery", { timestamp: NOW }, { method: 42 }, { method: "otp", timestamp: NOW }],
    });
    // A bare string "recovery" is NOT an entry. Accepting it would let a claim
    // from some other issuer's token shape open the reset form.
    expect(amrFromToken(t)).toEqual([{ method: "otp", timestamp: NOW }]);
  });

  it("keeps an entry whose timestamp is missing, without inventing one", () => {
    expect(amrFromToken(token({ amr: [{ method: "recovery" }] }))).toEqual([
      { method: "recovery", timestamp: undefined },
    ]);
  });
});

describe("isRecoveryToken", () => {
  it("accepts a session made by following a recovery link", () => {
    const t = token({ amr: [{ method: "recovery", timestamp: NOW - 60 }] });
    expect(isRecoveryToken(t, NOW)).toBe(true);
  });

  it.each(["otp", "magiclink"])("accepts %s, which Supabase also uses for emailed links", (method) => {
    expect(isRecoveryToken(token({ amr: [{ method, timestamp: NOW }] }), NOW)).toBe(true);
  });

  it("refuses an ordinary password session — this is the borrowed-laptop case", () => {
    const t = token({ amr: [{ method: "password", timestamp: NOW }] });
    expect(isRecoveryToken(t, NOW)).toBe(false);
  });

  it("refuses a recovery session that has aged out", () => {
    const t = token({ amr: [{ method: "recovery", timestamp: NOW - RECOVERY_MAX_AGE_SECONDS - 1 }] });
    expect(isRecoveryToken(t, NOW)).toBe(false);
  });

  it("accepts one right on the boundary", () => {
    const t = token({ amr: [{ method: "recovery", timestamp: NOW - RECOVERY_MAX_AGE_SECONDS }] });
    expect(isRecoveryToken(t, NOW)).toBe(true);
  });

  it("refuses a timestamp in the future", () => {
    // Clock skew is one explanation; a fabricated claim is the other, and there
    // is no reading under which a link was followed tomorrow.
    const t = token({ amr: [{ method: "recovery", timestamp: NOW + 120 }] });
    expect(isRecoveryToken(t, NOW)).toBe(false);
  });

  it("refuses a recovery entry with no timestamp at all", () => {
    expect(isRecoveryToken(token({ amr: [{ method: "recovery" }] }), NOW)).toBe(false);
  });

  it("accepts a session that signed in with a password AND then followed a link", () => {
    // Both entries are present after a recovery on top of an existing session;
    // the recovery one is what the reset form is asking about.
    const t = token({
      amr: [
        { method: "password", timestamp: NOW - 5000 },
        { method: "recovery", timestamp: NOW - 30 },
      ],
    });
    expect(isRecoveryToken(t, NOW)).toBe(true);
  });

  it.each([null, undefined, "", "garbage"])("refuses %p", (value) => {
    expect(isRecoveryToken(value as string | null, NOW)).toBe(false);
  });
});
