/*
 * Performance scores.
 *
 * The 2021 plan proposed a plain average of the last 20 ratings, starting
 * everyone at 6.0, and routing the best work to the highest scores. Its reviewer
 * asked the obvious question — what happens before there are 20 ratings? — and
 * the honest answer is that a plain average is noise at low counts. One
 * irritated coordinator on someone's first shift would brand them a 2.0 and cost
 * them work indefinitely.
 *
 * So two rules here:
 *
 *   1. The stored `score` is always the raw number a human gave. Nothing is
 *      pre-averaged in the database, so this display rule can change without the
 *      history being wrong.
 *
 *   2. The shown average is pulled toward the 6.0 baseline in proportion to how
 *      few ratings exist (a standard shrinkage estimator). With one rating you
 *      are still mostly a 6.0; by twenty, the baseline barely matters.
 */

export const BASELINE_SCORE = 6.0;

/** How many baseline "phantom" ratings the prior is worth. */
const PRIOR_WEIGHT = 5;

/** Ratings beyond this many are ignored, so old history stops following people forever. */
export const RATING_WINDOW = 20;

/** Below this many real ratings the score is labelled provisional in the UI. */
export const PROVISIONAL_BELOW = 5;

export type RatingSummary = {
  /** Shrunk toward the baseline. One decimal place, as scores are given out of 10. */
  score: number;
  /** Real ratings inside the window. Always shown next to the score — never the score alone. */
  count: number;
  /** True when there is too little data for the number to mean much yet. */
  provisional: boolean;
};

/**
 * @param scores Raw scores, newest first. Only the first RATING_WINDOW are used.
 */
export function summariseRatings(scores: number[]): RatingSummary {
  const window = scores.slice(0, RATING_WINDOW);
  const n = window.length;
  const sum = window.reduce((a, b) => a + b, 0);

  const shrunk = (sum + BASELINE_SCORE * PRIOR_WEIGHT) / (n + PRIOR_WEIGHT);

  return {
    // Rounded for display only. Never round before comparing two freelancers,
    // or a 7.44 and a 7.35 become indistinguishable ties.
    score: Math.round(shrunk * 10) / 10,
    count: n,
    provisional: n < PROVISIONAL_BELOW,
  };
}

/*
 * NO RANKING FUNCTION HERE, DELIBERATELY.
 *
 * There was one — rankingScore, an ordering key for "who gets offered a shift
 * first", written, documented and covered by three tests. Nothing called it, and
 * calling it would not have done anything: the fan-out in lib/shifts.ts inserts
 * every offer in a single statement and notifies everyone at once, so the order
 * of that list is not observable by anybody. Wiring it up would have been the
 * appearance of a feature.
 *
 * It is removed rather than left waiting for a caller, because a tested function
 * with a confident docstring reads as a shipped mechanism — and this codebase has
 * now produced that shape often enough to have a name for it. Ordering by score
 * only becomes real alongside something that consumes an order: a cap on how many
 * people an offer reaches, or a staggered fan-out. When one of those exists, the
 * arithmetic is four lines away from summariseRatings below.
 *
 * If it comes back, it comes back through rating_summary() — since migration 019
 * the raw scores do not leave the database, and a second implementation of the
 * shrinkage is the exact drift lib/ratings.sql.test.ts exists to catch.
 */

/**
 * Clamps a rating to the range a human is allowed to give.
 *
 * The plan wanted raters limited to ±2 from the current average. That is not
 * implemented: it makes a rating a statement about the average rather than about
 * the shift, and it means the same performance scores differently depending on
 * history. The shrinkage above solves the problem it was aimed at — outliers
 * moving the number too far — without distorting what the rater said.
 */
export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return BASELINE_SCORE;
  return Math.min(10, Math.max(0, Math.round(score)));
}

/**
 * Turns rating_summary()'s two columns into the shape the pages render.
 *
 * The raw scores no longer leave the database — see migration 019, which stopped
 * handing a freelancer the individual mark one named coordinator gave them for
 * one specific night. So the shrinkage happens in SQL and this only adapts it.
 *
 * A null score means below PROVISIONAL_BELOW: too few opinions to publish, and
 * few enough that a published figure could be inverted back to a single one.
 */
export function summaryFromRpc(
  row: { rating_count: number | null; shrunk_score: number | string | null } | null,
): RatingSummary {
  const count = row?.rating_count ?? 0;
  const raw = row?.shrunk_score;

  if (raw === null || raw === undefined) {
    return { score: BASELINE_SCORE, count, provisional: true };
  }

  return { score: Number(raw), count, provisional: false };
}
