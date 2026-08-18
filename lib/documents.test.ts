import { describe, expect, it } from "vitest";
import {
  DOCUMENT_KIND_LABELS,
  KINDS_NEEDING_EXPIRY,
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
