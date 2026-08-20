import { describe, expect, it, vi, beforeEach } from "vitest";

/*
 * The cookie that carries a half-filled form through a redirect.
 *
 * Tested because two of its rules are the kind that are easy to write and easy
 * to quietly break later: passwords must never reach the cookie, and a draft
 * must not repopulate a form that was opened fresh.
 */

const store = new Map<string, { value: string; options: Record<string, unknown> }>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      if (options.maxAge === 0) store.delete(name);
      else store.set(name, { value, options });
    },
    get: (name: string) => store.get(name),
  }),
}));

const { saveFormDraft, readFormDraft, clearFormDraft } = await import("@/lib/formDraft");

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.append(k, v);
  return data;
};

beforeEach(() => store.clear());

describe("saveFormDraft", () => {
  it("keeps what was typed", async () => {
    await saveFormDraft("shift", form({ hourly_rate: "42,50", department: "Neuro" }), "/x");
    expect(await readFormDraft("shift", true)).toEqual({
      hourly_rate: "42,50",
      department: "Neuro",
    });
  });

  it.each(["password", "password_confirm", "wachtwoord", "reset_token", "client_secret", "otp_code"])(
    "never stores a field called %s",
    async (name) => {
      await saveFormDraft("reg", form({ email: "a@b.nl", [name]: "hunter2" }), "/x");
      const draft = await readFormDraft("reg", true);
      expect(draft).not.toHaveProperty(name);
      expect(JSON.stringify(draft)).not.toContain("hunter2");
      // The rest of the form still survives — the deny-list drops a field, not
      // the draft.
      expect(draft.email).toBe("a@b.nl");
    },
  );

  it("drops a file rather than serialising it", async () => {
    const data = form({ kind: "vog" });
    data.append("file", new File(["x"], "vog.pdf", { type: "application/pdf" }));

    await saveFormDraft("docs", data, "/x");
    const draft = await readFormDraft("docs", true);
    expect(draft).toEqual({ kind: "vog" });
  });

  it("is httpOnly, path-scoped and short-lived", async () => {
    await saveFormDraft("shift", form({ a: "1" }), "/zorginstelling/diensten/nieuw");
    const cookie = store.get("myqare_draft_shift");

    // httpOnly so a script on the page cannot read the draft back out.
    expect(cookie?.options.httpOnly).toBe(true);
    expect(cookie?.options.sameSite).toBe("lax");
    expect(cookie?.options.path).toBe("/zorginstelling/diensten/nieuw");
    expect(cookie?.options.maxAge).toBe(300);
  });

  it("stores nothing at all rather than a truncated draft", async () => {
    /*
     * A partially restored form looks like saved work and is not, so a submission
     * that will not fit is dropped whole. It takes several long fields to get
     * there — one is capped at MAX_VALUE_LENGTH long before the cookie budget
     * matters, which is what the next test covers.
     */
    const huge: Record<string, string> = {};
    for (let i = 0; i < 5; i++) huge[`field_${i}`] = "x".repeat(2_000);

    await saveFormDraft("shift", form(huge), "/x");
    expect(await readFormDraft("shift", true)).toEqual({});
  });

  it("caps one very long value instead of refusing the whole draft", async () => {
    const draft = await (async () => {
      await saveFormDraft("shift", form({ description: "y".repeat(2_500), rate: "40" }), "/x");
      return readFormDraft("shift", true);
    })();

    expect(draft.description).toHaveLength(2000);
    expect(draft.rate).toBe("40");
  });

  it("skips empty fields, so a blank does not overwrite a real default", async () => {
    await saveFormDraft("shift", form({ location: "", department: "Neuro" }), "/x");
    expect(await readFormDraft("shift", true)).toEqual({ department: "Neuro" });
  });
});

describe("readFormDraft", () => {
  it("returns nothing when the page is not showing an error", async () => {
    /*
     * The whole reason the flag exists. Without it, a coordinator who opens the
     * form fresh four minutes after abandoning one gets last time's half-finished
     * shift back — which looks like saved work, is not, and is one submit away
     * from posting a shift nobody meant to post.
     */
    await saveFormDraft("shift", form({ hourly_rate: "42,50" }), "/x");
    expect(await readFormDraft("shift", false)).toEqual({});
  });

  it("survives a corrupted cookie", async () => {
    store.set("myqare_draft_shift", { value: "{not json", options: {} });
    expect(await readFormDraft("shift", true)).toEqual({});
  });

  it("ignores non-string values a corrupted cookie might carry", async () => {
    store.set("myqare_draft_shift", {
      value: JSON.stringify({ ok: "yes", bad: { nested: 1 }, worse: 42 }),
      options: {},
    });
    expect(await readFormDraft("shift", true)).toEqual({ ok: "yes" });
  });

  it("returns nothing when there is no draft", async () => {
    expect(await readFormDraft("shift", true)).toEqual({});
  });
});

describe("clearFormDraft", () => {
  it("removes it, so a completed form leaves nothing behind", async () => {
    await saveFormDraft("shift", form({ a: "1" }), "/x");
    await clearFormDraft("shift", "/x");
    expect(await readFormDraft("shift", true)).toEqual({});
  });
});
