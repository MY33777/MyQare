import { describe, expect, it } from "vitest";
import { dateToLocalInput, localInputToDate, localInputToIso } from "@/lib/timezone";

describe("localInputToDate", () => {
  /*
   * The whole point. These two assertions fail if the conversion ever silently
   * falls back to the runtime's zone — which on Vercel is UTC, and would put every
   * shift out by an hour or two.
   */
  it("treats summer input as CEST (UTC+2)", () => {
    expect(localInputToDate("2026-08-14T07:00")?.toISOString()).toBe("2026-08-14T05:00:00.000Z");
  });

  it("treats winter input as CET (UTC+1)", () => {
    expect(localInputToDate("2026-01-14T07:00")?.toISOString()).toBe("2026-01-14T06:00:00.000Z");
  });

  it("accepts seconds as well as bare minutes", () => {
    expect(localInputToDate("2026-08-14T07:00:00")?.toISOString()).toBe("2026-08-14T05:00:00.000Z");
  });

  it("handles a night shift crossing midnight", () => {
    expect(localInputToDate("2026-08-14T23:30")?.toISOString()).toBe("2026-08-14T21:30:00.000Z");
    expect(localInputToDate("2026-08-15T07:30")?.toISOString()).toBe("2026-08-15T05:30:00.000Z");
  });

  /*
   * DST changeovers. In 2026 the Netherlands springs forward on 29 March and falls
   * back on 25 October. A shift on either side of those must not drift, which is
   * what the second correction pass in localInputToDate is for.
   */
  it("is correct on both sides of the spring-forward boundary", () => {
    expect(localInputToDate("2026-03-29T01:00")?.toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(localInputToDate("2026-03-29T04:00")?.toISOString()).toBe("2026-03-29T02:00:00.000Z");
  });

  it("is correct on both sides of the autumn fall-back boundary", () => {
    expect(localInputToDate("2026-10-25T01:00")?.toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(localInputToDate("2026-10-25T04:00")?.toISOString()).toBe("2026-10-25T03:00:00.000Z");
  });

  it("rejects unusable input rather than producing an Invalid Date", () => {
    expect(localInputToDate("")).toBeNull();
    expect(localInputToDate("gisteren")).toBeNull();
    expect(localInputToDate("2026-08-14")).toBeNull();
    expect(localInputToDate("14-08-2026T07:00")).toBeNull();
  });
});

describe("localInputToIso", () => {
  it("returns a storable ISO string", () => {
    expect(localInputToIso("2026-08-14T07:00")).toBe("2026-08-14T05:00:00.000Z");
  });

  it("returns null for unusable input", () => {
    expect(localInputToIso("nope")).toBeNull();
  });
});

describe("dateToLocalInput", () => {
  it("renders an instant back as the wall clock the coordinator typed", () => {
    expect(dateToLocalInput("2026-08-14T05:00:00.000Z")).toBe("2026-08-14T07:00");
  });

  it("renders winter instants at the winter offset", () => {
    expect(dateToLocalInput("2026-01-14T06:00:00.000Z")).toBe("2026-01-14T07:00");
  });

  /*
   * Round-tripping is the property that actually matters: an edit form must show
   * exactly what was entered, or every edit silently shifts the shift.
   */
  it("round-trips through both conversions unchanged", () => {
    for (const wall of [
      "2026-08-14T07:00",
      "2026-01-14T23:45",
      "2026-03-29T04:00",
      "2026-10-25T04:00",
      "2026-12-31T00:00",
    ]) {
      const instant = localInputToDate(wall);
      expect(instant).not.toBeNull();
      expect(dateToLocalInput(instant as Date)).toBe(wall);
    }
  });
});
