import { describe, expect, it } from "vitest";
import {
  QUALIFICATIONS,
  findQualification,
  isKnownQualification,
  qualificationLabel,
  qualificationsByCategory,
  searchQualifications,
} from "@/lib/qualifications";

/*
 * Integrity checks on generated data.
 *
 * The file is machine-written from a research run, so the risk is not a typo in
 * one entry — it is a whole class of entries coming out malformed and nobody
 * noticing until a dropdown renders blank options in front of a customer.
 */
describe("the taxonomy itself", () => {
  it("is populated", () => {
    expect(QUALIFICATIONS.length).toBeGreaterThan(100);
  });

  it("has unique slugs", () => {
    const slugs = QUALIFICATIONS.map((q) => q.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has a usable label on every entry", () => {
    for (const q of QUALIFICATIONS) {
      expect(q.nameNl.trim().length).toBeGreaterThan(0);
      expect(q.shortNl.trim().length).toBeGreaterThan(0);
      expect(q.levelLabel.trim().length).toBeGreaterThan(0);
    }
  });

  it("uses kebab-case slugs, since they are stored and must never need escaping", () => {
    for (const q of QUALIFICATIONS) {
      expect(q.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("only uses categories the UI can group", () => {
    const valid = new Set([
      "mbo_verpleging_verzorging",
      "mbo_welzijn_begeleiding",
      "mbo_assisterend",
      "hbo",
      "wo",
      "specialisatie",
    ]);
    for (const q of QUALIFICATIONS) expect(valid.has(q.category)).toBe(true);
  });

  it("only uses known BIG statuses", () => {
    const valid = new Set(["big_artikel_3", "big_artikel_34", "geen_big", "onbekend"]);
    for (const q of QUALIFICATIONS) expect(valid.has(q.bigStatus)).toBe(true);
  });

  /*
   * A CREBO code is a thing a facility can look up. An invented one is worse than
   * a missing one, so the generator drops any the verifier could not confirm —
   * which means every code that survived must at least be shaped like a real one.
   */
  it("never carries a malformed CREBO code", () => {
    for (const q of QUALIFICATIONS) {
      if (q.crebo !== undefined) expect(q.crebo).toMatch(/^\d{4,6}$/);
    }
  });

  /*
   * These slugs are stored in the database, so a rename is a migration. Asserting
   * them here means the generator cannot quietly rename one on a re-run.
   */
  it("covers the everyday roles the product is built around", () => {
    for (const slug of [
      "verzorgende-ig-niveau-3",
      "mbo-verpleegkundige-niveau-4",
      "helpende-zorg-en-welzijn-niveau-2",
      "hbo-verpleegkunde-bachelor",
    ]) {
      expect(isKnownQualification(slug)).toBe(true);
    }
  });

  it("covers the Begeleider family, which is easy to under-cover", () => {
    const begeleiders = QUALIFICATIONS.filter((q) => q.category === "mbo_welzijn_begeleiding");
    expect(begeleiders.length).toBeGreaterThanOrEqual(10);
  });

  it("covers post-initial specialisations", () => {
    const specialisms = QUALIFICATIONS.filter((q) => q.category === "specialisatie");
    expect(specialisms.length).toBeGreaterThanOrEqual(40);
  });
});

describe("qualificationLabel", () => {
  it("resolves a known slug to its short name", () => {
    expect(qualificationLabel("verzorgende-ig-niveau-3")).toMatch(/verzorgende/i);
  });

  /*
   * Falls back to the raw value rather than showing "—", so a shift posted before
   * a slug was renamed still renders something a human recognises.
   */
  it("falls back to the raw value for an unknown slug", () => {
    expect(qualificationLabel("iets-ouds")).toBe("iets-ouds");
  });

  it("shows a dash for nothing at all", () => {
    expect(qualificationLabel(null)).toBe("—");
    expect(qualificationLabel(undefined)).toBe("—");
    expect(qualificationLabel("")).toBe("—");
  });
});

describe("qualificationsByCategory", () => {
  it("returns groups in a stable order with no empty ones", () => {
    const groups = qualificationsByCategory();
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) expect(group.items.length).toBeGreaterThan(0);
    expect(groups[0].category).toBe("mbo_verpleging_verzorging");
  });

  it("puts the everyday roles first, so nobody scrolls to find them", () => {
    const first = qualificationsByCategory()[0];
    expect(first.items[0].slug).toBe("verzorgende-ig-niveau-3");
  });

  it("accounts for every qualification exactly once", () => {
    const total = qualificationsByCategory().reduce((sum, g) => sum + g.items.length, 0);
    expect(total).toBe(QUALIFICATIONS.length);
  });
});

describe("searchQualifications", () => {
  it("finds by official name", () => {
    expect(searchQualifications("verzorgende").length).toBeGreaterThan(0);
  });

  /*
   * The abbreviations are the point. None of these appear in an official name, and
   * they are what a real person types.
   */
  it("finds by abbreviation", () => {
    for (const abbreviation of ["VIG", "HBO-V"]) {
      expect(searchQualifications(abbreviation).length).toBeGreaterThan(0);
    }
  });

  it("is case-insensitive", () => {
    expect(searchQualifications("VERZORGENDE").length).toBe(searchQualifications("verzorgende").length);
  });

  it("ranks an exact short-name match first", () => {
    const target = QUALIFICATIONS[0];
    expect(searchQualifications(target.shortNl)[0].slug).toBe(target.slug);
  });

  it("returns nothing for nonsense", () => {
    expect(searchQualifications("qwertyuiop")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(searchQualifications("", 5).length).toBe(5);
  });
});

describe("findQualification", () => {
  it("returns the entry for a known slug", () => {
    expect(findQualification("verzorgende-ig-niveau-3")?.category).toBe(
      "mbo_verpleging_verzorging",
    );
  });

  it("returns undefined for an unknown slug", () => {
    expect(findQualification("bestaat-niet")).toBeUndefined();
  });
});
