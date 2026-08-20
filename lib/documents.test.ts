import { describe, expect, it } from "vitest";
import {
  DOCUMENT_KIND_LABELS,
  KINDS_NEEDING_EXPIRY,
  uploadDocument,
  MAX_DOCUMENT_BYTES,
  daysUntilExpiry,
  expiryState,
} from "@/lib/documents";

const NOW = new Date("2026-08-18T12:00:00Z");

describe("daysUntilExpiry", () => {
  it("counts days into the future", () => {
    expect(daysUntilExpiry("2026-09-17", NOW)).toBe(30);
  });

  it("goes negative once lapsed", () => {
    expect(daysUntilExpiry("2026-08-08", NOW)).toBe(-10);
  });

  it("returns null when there is no expiry date", () => {
    expect(daysUntilExpiry(null, NOW)).toBeNull();
  });
});

describe("expiryState", () => {
  it("is valid when comfortably in the future", () => {
    expect(expiryState("2027-01-01", NOW)).toBe("geldig");
  });

  /*
   * Sixty days of warning, not seven. A VOG takes weeks to obtain, so warning on
   * the day it lapses would be useless — the freelancer would already be unable to
   * work.
   */
  it("warns two months ahead, which is how long a VOG takes to get", () => {
    expect(expiryState("2026-10-01", NOW)).toBe("verloopt_binnenkort");
    expect(expiryState("2026-10-30", NOW)).toBe("geldig");
  });

  it("flags a lapsed document", () => {
    expect(expiryState("2026-08-17", NOW)).toBe("verlopen");
  });

  it("treats the expiry day itself as still expiring rather than expired", () => {
    expect(expiryState("2026-08-18", NOW)).toBe("verloopt_binnenkort");
  });

  it("says so when a kind carries no date", () => {
    expect(expiryState(null, NOW)).toBe("geen_datum");
  });
});

describe("document kinds", () => {
  it("labels every kind, so no dropdown renders a raw enum value", () => {
    for (const kind of Object.keys(DOCUMENT_KIND_LABELS)) {
      expect(DOCUMENT_KIND_LABELS[kind as keyof typeof DOCUMENT_KIND_LABELS].length).toBeGreaterThan(
        3,
      );
    }
  });

  it("asks for an expiry date on exactly the kinds that lapse", () => {
    expect(KINDS_NEEDING_EXPIRY).toContain("vog");
    expect(KINDS_NEEDING_EXPIRY).toContain("insurance");
    // A diploma does not expire; asking for a date would be a field nobody can fill.
    expect(KINDS_NEEDING_EXPIRY).not.toContain("diploma");
    expect(KINDS_NEEDING_EXPIRY).not.toContain("id");
  });

  it("caps uploads below the configured server action body limit", () => {
    // next.config.ts allows 6mb of raw body; the gap absorbs multipart overhead so
    // a file at exactly the app limit is not rejected by the framework first.
    expect(MAX_DOCUMENT_BYTES).toBeLessThan(6 * 1024 * 1024);
  });
});

describe("daysUntilExpiry does not drift through the day", () => {
  /*
   * It used to parse the expiry as midnight UTC and subtract the current instant,
   * so the answer changed as the day went on. At 23:00 Amsterdam in summer the
   * UTC clock reads 21:00 the same day, and the rounding tipped a day early — a
   * VOG showed "verlopen" an evening before it was, and the expiry cron, which
   * matches an exact day count, could miss its window entirely.
   */
  const expiry = "2026-08-20";

  it("gives the same answer at 00:30 and 23:30 Amsterdam", () => {
    // 00:30 and 23:30 CEST on 18 August = 22:30 on the 17th and 21:30 on the 18th UTC.
    const earlyMorning = new Date("2026-08-17T22:30:00Z");
    const lateEvening = new Date("2026-08-18T21:30:00Z");

    expect(daysUntilExpiry(expiry, earlyMorning)).toBe(2);
    expect(daysUntilExpiry(expiry, lateEvening)).toBe(2);
  });

  it("is zero on the day itself, whatever the hour", () => {
    expect(daysUntilExpiry(expiry, new Date("2026-08-19T22:30:00Z"))).toBe(0); // 00:30 on the 20th
    expect(daysUntilExpiry(expiry, new Date("2026-08-20T21:30:00Z"))).toBe(0); // 23:30 on the 20th
  });

  it("goes negative only once the day has passed", () => {
    expect(daysUntilExpiry(expiry, new Date("2026-08-20T21:59:00Z"))).toBe(0);
    expect(daysUntilExpiry(expiry, new Date("2026-08-20T22:01:00Z"))).toBe(-1);
  });

  it("still returns null when nothing expires", () => {
    expect(daysUntilExpiry(null)).toBeNull();
  });
});

/*
 * Uploading, and the two rules that were written down and never applied.
 *
 * The storage and database calls are faked because what is under test is the
 * validation that runs BEFORE either of them — and, in the delete case, that a
 * failed storage remove stops the row from being deleted.
 */
describe("uploadDocument validation", () => {
  const pdf = () =>
    new File([new Uint8Array([1, 2, 3])], "vog.pdf", { type: "application/pdf" });

  const tomorrow = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 30);
    return d.toISOString().slice(0, 10);
  };

  it.each(KINDS_NEEDING_EXPIRY)("refuses %s with no expiry date", async (kind) => {
    const result = await uploadDocument({
      freelancerId: "f1",
      kind,
      file: pdf(),
      issuedOn: null,
      expiresOn: null,
    });

    // The form has always SAID these need one. Nothing checked, so a VOG with a
    // blank date was approved and then sat in the dossier as valid forever: the
    // expiry cron matches on a day count and a null never matches.
    expect(result).toEqual({ ok: false, reason: "expiry_required" });
  });

  it("refuses an expiry date that is not a date", async () => {
    const result = await uploadDocument({
      freelancerId: "f1",
      kind: "vog",
      file: pdf(),
      issuedOn: null,
      expiresOn: "volgend jaar",
    });
    expect(result).toEqual({ ok: false, reason: "expiry_invalid" });
  });

  it("refuses a document that has already lapsed", async () => {
    const result = await uploadDocument({
      freelancerId: "f1",
      kind: "insurance",
      file: pdf(),
      issuedOn: null,
      expiresOn: "2020-01-01",
    });
    expect(result).toEqual({ ok: false, reason: "expiry_past" });
  });

  it("lets a well-formed future date through to the storage call", async () => {
    /*
     * Reaching getSupabaseAdmin IS the assertion. There is no Supabase in a unit
     * test, so it throws — and the date is what this test is about: it was not the
     * thing that stopped the upload. Asserting the throw is honest about where
     * the test stops, rather than mocking a client just to reach a return value
     * nobody is checking.
     */
    await expect(
      uploadDocument({
        freelancerId: "f1",
        kind: "vog",
        file: pdf(),
        issuedOn: null,
        expiresOn: tomorrow(),
      }),
    ).rejects.toThrow(/Supabase admin client/);
  });

  it("does not demand an expiry date for a kind that has none", async () => {
    // A diploma does not expire, so a blank date must reach storage rather than
    // being refused. Same reasoning as the test above for why this is a throw.
    await expect(
      uploadDocument({
        freelancerId: "f1",
        kind: "diploma",
        file: pdf(),
        issuedOn: "2018-06-01",
        expiresOn: null,
      }),
    ).rejects.toThrow(/Supabase admin client/);
  });

  it("still rejects the file itself before looking at any date", async () => {
    const tooBig = new File([new Uint8Array(6 * 1024 * 1024)], "vog.pdf", {
      type: "application/pdf",
    });
    const result = await uploadDocument({
      freelancerId: "f1",
      kind: "vog",
      file: tooBig,
      issuedOn: null,
      expiresOn: null,
    });
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });
});
