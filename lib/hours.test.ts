import { describe, expect, it } from "vitest";
import { billableMinutes, formatMinutes, formatTime } from "@/lib/hours";

describe("billableMinutes", () => {
  it("subtracts the unpaid break", () => {
    expect(billableMinutes("2026-08-14T07:00:00Z", "2026-08-14T15:00:00Z", 30)).toBe(450);
  });

  it("is the full span when there is no break", () => {
    expect(billableMinutes("2026-08-14T07:00:00Z", "2026-08-14T15:00:00Z", 0)).toBe(480);
  });

  it("accepts Date objects as well as ISO strings", () => {
    const start = new Date("2026-08-14T22:00:00Z");
    const end = new Date("2026-08-15T06:30:00Z");
    expect(billableMinutes(start, end, 0)).toBe(510);
  });

  it("handles a night shift crossing midnight", () => {
    expect(billableMinutes("2026-08-14T23:00:00Z", "2026-08-15T07:00:00Z", 45)).toBe(435);
  });

  /*
   * A break longer than the shift is a typo, or a shift that was shortened after
   * the break was entered. Clamping to zero matters because a negative duration
   * becomes a negative invoice, i.e. the freelancer paying the facility.
   */
  it("clamps at zero rather than producing a negative invoice", () => {
    expect(billableMinutes("2026-08-14T07:00:00Z", "2026-08-14T08:00:00Z", 120)).toBe(0);
  });

  it("treats a negative break as no break", () => {
    expect(billableMinutes("2026-08-14T07:00:00Z", "2026-08-14T08:00:00Z", -30)).toBe(60);
  });
});

describe("formatMinutes", () => {
  it("shows hours and minutes the way a timesheet reads", () => {
    expect(formatMinutes(465)).toBe("7 u 45 m");
  });

  it("omits minutes on the hour", () => {
    expect(formatMinutes(480)).toBe("8 u");
  });

  it("omits hours under an hour", () => {
    expect(formatMinutes(45)).toBe("45 m");
  });

  it("shows zero as minutes", () => {
    expect(formatMinutes(0)).toBe("0 m");
  });
});

describe("formatTime", () => {
  /*
   * Pinned to Europe/Amsterdam, not the runtime's clock. These two assertions are
   * the whole reason the timeZone option is there: the same UTC instant is CEST
   * in August and CET in January, and a server rendering in UTC would show a
   * 21:00 night shift starting at 19:00.
   */
  it("renders summer time in Amsterdam (UTC+2)", () => {
    expect(formatTime("2026-08-14T19:00:00Z")).toBe("21:00");
  });

  it("renders winter time in Amsterdam (UTC+1)", () => {
    expect(formatTime("2026-01-14T19:00:00Z")).toBe("20:00");
  });
});
