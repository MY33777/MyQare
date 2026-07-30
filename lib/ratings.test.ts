import { describe, expect, it } from "vitest";
import {
  BASELINE_SCORE,
  RATING_WINDOW,
  clampScore,
  rankingScore,
  summariseRatings,
} from "@/lib/ratings";

describe("summariseRatings", () => {
  it("starts everyone at the baseline with no ratings", () => {
    const summary = summariseRatings([]);
    expect(summary.score).toBe(BASELINE_SCORE);
    expect(summary.count).toBe(0);
    expect(summary.provisional).toBe(true);
  });

  /*
   * The failure the 2021 reviewer identified. One irritated coordinator on a
   * first shift must not brand someone a 2.0 — with the shrinkage they land near
   * 5.3, visibly below average but recoverable.
   */
  it("does not let a single bad rating tank a newcomer", () => {
    const summary = summariseRatings([2]);
    expect(summary.score).toBeGreaterThan(5);
    expect(summary.score).toBeLessThan(6);
    expect(summary.count).toBe(1);
    expect(summary.provisional).toBe(true);
  });

  it("does not let a single glowing rating vault someone to the top either", () => {
    const summary = summariseRatings([10]);
    expect(summary.score).toBeLessThan(7);
    expect(summary.score).toBeGreaterThan(6);
  });

  it("converges on the true average as ratings accumulate", () => {
    const twenty = Array(20).fill(8);
    const summary = summariseRatings(twenty);
    expect(summary.score).toBeGreaterThan(7.5);
    expect(summary.count).toBe(20);
    expect(summary.provisional).toBe(false);
  });

  it("reports the real count, never a padded one", () => {
    expect(summariseRatings([7, 8, 9]).count).toBe(3);
  });

  it("ignores history beyond the window so old ratings stop following people", () => {
    const recentGood = Array(RATING_WINDOW).fill(9);
    const ancientBad = Array(40).fill(1);
    const summary = summariseRatings([...recentGood, ...ancientBad]);
    expect(summary.count).toBe(RATING_WINDOW);
    expect(summary.score).toBeGreaterThan(8);
  });

  it("stops being provisional once there is enough data", () => {
    expect(summariseRatings([7, 7, 7, 7]).provisional).toBe(true);
    expect(summariseRatings([7, 7, 7, 7, 7]).provisional).toBe(false);
  });
});

describe("rankingScore", () => {
  it("puts a proven performer above a newcomer", () => {
    const proven = rankingScore(Array(20).fill(9));
    const newcomer = rankingScore([]);
    expect(proven).toBeGreaterThan(newcomer);
  });

  it("puts a newcomer above someone with a long poor record", () => {
    const newcomer = rankingScore([]);
    const poor = rankingScore(Array(20).fill(4));
    expect(newcomer).toBeGreaterThan(poor);
  });

  /*
   * Unrounded on purpose: rounding before comparison turns a 7.44 and a 7.35
   * into a tie, and ties in an ordering mean work gets handed out arbitrarily.
   */
  it("does not round, so near-neighbours stay distinguishable", () => {
    const a = rankingScore([8, 7, 8, 7, 8, 7]);
    const b = rankingScore([8, 7, 8, 7, 8, 8]);
    expect(a).not.toBe(b);
  });
});

describe("clampScore", () => {
  it("keeps a valid score", () => {
    expect(clampScore(7)).toBe(7);
  });

  it("clamps to the 0–10 range", () => {
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(99)).toBe(10);
  });

  it("rounds a fractional score to a whole one", () => {
    expect(clampScore(7.6)).toBe(8);
  });

  it("falls back to the baseline for nonsense", () => {
    expect(clampScore(NaN)).toBe(BASELINE_SCORE);
  });
});
