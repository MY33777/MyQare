import { describe, expect, it } from "vitest";
import { MAX_OCCURRENCES, describeRecurrence, expandRecurrence } from "@/lib/recurrence";
import { dateToLocalInput } from "@/lib/timezone";

/** Wall-clock start times, which is what a coordinator actually typed. */
const walls = (occurrences: { startsAt: string }[]) =>
  occurrences.map((o) => dateToLocalInput(o.startsAt));

describe("expandRecurrence", () => {
  it("returns just the one shift when not repeating", () => {
    const out = expandRecurrence("2026-08-14T07:00", "2026-08-14T15:00", "none", 1);
    expect(out).toHaveLength(1);
    expect(out[0].startsAt).toBe("2026-08-14T05:00:00.000Z");
  });

  it("ignores a count when the pattern is none", () => {
    expect(expandRecurrence("2026-08-14T07:00", "2026-08-14T15:00", "none", 7)).toHaveLength(1);
  });

  it("repeats daily", () => {
    const out = expandRecurrence("2026-08-14T07:00", "2026-08-14T15:00", "daily", 3);
    expect(walls(out)).toEqual([
      "2026-08-14T07:00",
      "2026-08-15T07:00",
      "2026-08-16T07:00",
    ]);
  });

  it("repeats weekly on the same weekday", () => {
    const out = expandRecurrence("2026-08-14T07:00", "2026-08-14T15:00", "weekly", 3);
    expect(walls(out)).toEqual([
      "2026-08-14T07:00",
      "2026-08-21T07:00",
      "2026-08-28T07:00",
    ]);
  });

  /*
   * 14 August 2026 is a Friday, so weekdays-only must skip the 15th and 16th and
   * resume on Monday the 17th.
   */
  it("skips the weekend on the weekdays pattern", () => {
    const out = expandRecurrence("2026-08-14T07:00", "2026-08-14T15:00", "weekdays", 4);
    expect(walls(out)).toEqual([
      "2026-08-14T07:00",
      "2026-08-17T07:00",
      "2026-08-18T07:00",
      "2026-08-19T07:00",
    ]);
  });

  /*
   * THE reason this module walks calendar days instead of adding 24h of
   * milliseconds. The Netherlands falls back on 25 October 2026, so the 24th and
   * the 26th sit on opposite sides of the change. A 23:00 night shift must stay
   * 23:00 — millisecond arithmetic would slide it to 22:00 and put a nurse on the
   * ward an hour early.
   */
  it("keeps the wall clock across the autumn clock change", () => {
    const out = expandRecurrence("2026-10-24T23:00", "2026-10-25T07:00", "daily", 3);
    expect(walls(out)).toEqual([
      "2026-10-24T23:00",
      "2026-10-25T23:00",
      "2026-10-26T23:00",
    ]);
  });

  it("keeps the wall clock across the spring clock change", () => {
    const out = expandRecurrence("2026-03-28T22:00", "2026-03-29T06:00", "daily", 3);
    expect(walls(out)).toEqual([
      "2026-03-28T22:00",
      "2026-03-29T22:00",
      "2026-03-30T22:00",
    ]);
  });

  it("carries an overnight end time along with each occurrence", () => {
    const out = expandRecurrence("2026-08-14T23:00", "2026-08-15T07:00", "daily", 2);
    expect(out[1].startsAt).toBe("2026-08-15T21:00:00.000Z");
    expect(out[1].endsAt).toBe("2026-08-16T05:00:00.000Z");
    // Every occurrence must still end after it starts.
    for (const occurrence of out) {
      expect(new Date(occurrence.endsAt).getTime()).toBeGreaterThan(
        new Date(occurrence.startsAt).getTime(),
      );
    }
  });

  it("caps the count, so a typo cannot create hundreds of shifts", () => {
    const out = expandRecurrence("2026-08-14T07:00", "2026-08-14T15:00", "daily", 9999);
    expect(out).toHaveLength(MAX_OCCURRENCES);
  });

  it("returns nothing for unusable input rather than an invalid date", () => {
    expect(expandRecurrence("nope", "2026-08-14T15:00", "daily", 3)).toEqual([]);
    expect(expandRecurrence("2026-08-14T07:00", "", "daily", 3)).toEqual([]);
  });

  it("never produces duplicate start times", () => {
    const out = expandRecurrence("2026-08-14T07:00", "2026-08-14T15:00", "weekdays", 10);
    expect(new Set(out.map((o) => o.startsAt)).size).toBe(out.length);
  });
});

describe("describeRecurrence", () => {
  it("describes a single shift", () => {
    expect(describeRecurrence("none", 1)).toBe("1 dienst");
    expect(describeRecurrence("daily", 1)).toBe("1 dienst");
  });

  it("describes a repeating series", () => {
    expect(describeRecurrence("daily", 5)).toContain("5 diensten");
    expect(describeRecurrence("weekdays", 5)).toContain("werkdag");
  });
});
