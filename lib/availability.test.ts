import { describe, expect, it } from "vitest";
import {
  blockCoversDate,
  isBlockedForShift,
  qualificationMatches,
  regionMatches,
  shiftDateKey,
  type AvailabilityBlock,
} from "@/lib/availability";

const block = (starts_on: string, ends_on: string): AvailabilityBlock => ({
  id: "b",
  starts_on,
  ends_on,
  reason: null,
});

describe("shiftDateKey", () => {
  it("uses the Amsterdam calendar date, not UTC", () => {
    // 23:30 on the 14th in Amsterdam is 21:30Z — same day either way.
    expect(shiftDateKey("2026-08-14T21:30:00Z")).toBe("2026-08-14");
  });

  /*
   * The case that catches people out: 00:30 Amsterdam on the 15th is 22:30Z on the
   * 14th. Using the UTC date would file it under the wrong day and miss a block.
   */
  it("rolls to the next day at Amsterdam midnight, not UTC midnight", () => {
    expect(shiftDateKey("2026-08-14T22:30:00Z")).toBe("2026-08-15");
  });

  it("handles winter offset too", () => {
    expect(shiftDateKey("2026-01-14T23:30:00Z")).toBe("2026-01-15");
  });
});

describe("blockCoversDate", () => {
  it("covers a single blocked day, both ends inclusive", () => {
    expect(blockCoversDate(block("2026-12-24", "2026-12-24"), "2026-12-24")).toBe(true);
  });

  it("covers the whole range including both boundaries", () => {
    const holiday = block("2026-07-01", "2026-07-14");
    expect(blockCoversDate(holiday, "2026-07-01")).toBe(true);
    expect(blockCoversDate(holiday, "2026-07-07")).toBe(true);
    expect(blockCoversDate(holiday, "2026-07-14")).toBe(true);
  });

  it("does not cover days outside the range", () => {
    const holiday = block("2026-07-01", "2026-07-14");
    expect(blockCoversDate(holiday, "2026-06-30")).toBe(false);
    expect(blockCoversDate(holiday, "2026-07-15")).toBe(false);
  });
});

describe("isBlockedForShift", () => {
  it("blocks a shift starting inside a blocked range", () => {
    expect(isBlockedForShift([block("2026-07-01", "2026-07-14")], "2026-07-07T07:00:00Z")).toBe(true);
  });

  it("allows a shift outside every block", () => {
    expect(isBlockedForShift([block("2026-07-01", "2026-07-14")], "2026-08-07T07:00:00Z")).toBe(false);
  });

  it("allows everything when nothing is blocked, which is the default state", () => {
    expect(isBlockedForShift([], "2026-07-07T07:00:00Z")).toBe(false);
  });

  /*
   * A night shift belongs to the evening it started, not the morning it ended.
   * Someone who blocked the 14th is unavailable for a shift beginning 23:00 on the
   * 14th, even though most of it falls on the 15th.
   */
  it("files a night shift under the day it started", () => {
    const blocked14th = [block("2026-08-14", "2026-08-14")];
    expect(isBlockedForShift(blocked14th, "2026-08-14T21:00:00Z")).toBe(true);

    const blocked15th = [block("2026-08-15", "2026-08-15")];
    expect(isBlockedForShift(blocked15th, "2026-08-14T21:00:00Z")).toBe(false);
  });
});

describe("regionMatches", () => {
  it("matches identical regions", () => {
    expect(regionMatches("Rotterdam", "Rotterdam")).toBe(true);
  });

  it("is case and whitespace insensitive", () => {
    expect(regionMatches("  ROTTERDAM ", "rotterdam")).toBe(true);
  });

  /*
   * Free text on both sides, so equality would match almost nothing in practice —
   * facilities write "Rotterdam" and freelancers write "Rotterdam-Rijnmond".
   */
  it("matches when either string contains the other", () => {
    expect(regionMatches("Rotterdam", "Rotterdam-Rijnmond")).toBe(true);
    expect(regionMatches("Rotterdam-Rijnmond", "Rotterdam")).toBe(true);
  });

  it("does not match unrelated regions", () => {
    expect(regionMatches("Rotterdam", "Groningen")).toBe(false);
  });

  /*
   * Generous in the right direction. A freelancer who never filled in a region has
   * not opted out of anything, and over-offering is visible and declinable while
   * under-offering is silent.
   */
  it("imposes no restriction when either side is unset", () => {
    expect(regionMatches("Rotterdam", null)).toBe(true);
    expect(regionMatches(null, "Groningen")).toBe(true);
    expect(regionMatches("", "")).toBe(true);
  });
});

describe("qualificationMatches", () => {
  it("matches on the main profession", () => {
    expect(qualificationMatches("verzorgende-ig-niveau-3", "verzorgende-ig-niveau-3", [])).toBe(true);
  });

  it("matches on a listed specialisation", () => {
    expect(qualificationMatches("ic-verpleegkundige", "mbo-verpleegkundige-niveau-4", ["ic-verpleegkundige"])).toBe(true);
  });

  /*
   * The bug this function exists to fix. Onboarding only sets `profession`, and
   * `specialisations` starts empty — so matching on specialisations alone meant a
   * region-wide shift reached nobody at all.
   */
  it("still matches when specialisations is empty, which is the default", () => {
    expect(qualificationMatches("verzorgende-ig-niveau-3", "verzorgende-ig-niveau-3", [])).toBe(true);
    expect(qualificationMatches("verzorgende-ig-niveau-3", "verzorgende-ig-niveau-3", null)).toBe(true);
  });

  it("does not match a different qualification", () => {
    expect(qualificationMatches("ic-verpleegkundige", "helpende-zorg-en-welzijn-niveau-2", [])).toBe(false);
  });
});
