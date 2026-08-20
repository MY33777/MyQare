import { describe, expect, it } from "vitest";
import {
  computeReversal,
  computeRestore,
  reversalKey,
  restoreKey,
  type PriorMovement,
} from "@/lib/reversal";

/*
 * The sequences three audits found broken, written down.
 *
 * Every one of these passed review as prose and failed as arithmetic. There was
 * no test at all until now, because the logic was tangled with Supabase calls —
 * which is the actual lesson: money arithmetic that cannot be run without a
 * database will not be run.
 */

const TOP_UP = 50_000; // €500
const PI = "pi_X";

/** Applies a decision the way the webhook does, returning the new prior list. */
function apply(
  prior: PriorMovement[],
  cause: "refund" | "dispute",
  cumulative: number,
  deltaCents: number,
): PriorMovement[] {
  return [...prior, { deltaCents: -deltaCents, key: reversalKey(PI, cause, cumulative) }];
}

describe("partial refunds", () => {
  it("takes back only the newly refunded amount, not the cumulative total again", () => {
    // The round 6 defect: €50 then €30 removed €130 from a €500 top-up.
    let prior: PriorMovement[] = [];

    const first = computeReversal({ topUpCents: TOP_UP, reversibleCents: 5_000, prior });
    expect(first).toEqual({ act: true, deltaCents: 5_000, cumulative: 5_000 });
    prior = apply(prior, "refund", 5_000, 5_000);

    // Stripe sends the CUMULATIVE amount_refunded on the second event.
    const second = computeReversal({ topUpCents: TOP_UP, reversibleCents: 8_000, prior });
    expect(second).toEqual({ act: true, deltaCents: 3_000, cumulative: 8_000 });
    prior = apply(prior, "refund", 8_000, 3_000);

    const removed = prior.reduce((sum, row) => sum - row.deltaCents, 0);
    expect(removed).toBe(8_000);
  });

  it("does nothing on a redelivered event", () => {
    const prior = apply([], "refund", 5_000, 5_000);
    expect(computeReversal({ topUpCents: TOP_UP, reversibleCents: 5_000, prior })).toEqual({
      act: false,
      reason: "already_settled",
    });
  });

  it("never removes more than the top-up granted", () => {
    // A refund in a different currency, or Stripe reporting more than we credited.
    const decision = computeReversal({ topUpCents: TOP_UP, reversibleCents: 90_000, prior: [] });
    expect(decision).toEqual({ act: true, deltaCents: TOP_UP, cumulative: TOP_UP });
  });
});

describe("a partial refund followed by a dispute", () => {
  it("removes the top-up once in total, not the refund plus the whole charge", () => {
    // Previously: €50 refund then a €500 dispute removed €550 against a €500
    // top-up, driving the balance negative with no in-app way back.
    let prior = apply([], "refund", 5_000, 5_000);

    const dispute = computeReversal({ topUpCents: TOP_UP, reversibleCents: TOP_UP, prior });
    expect(dispute).toEqual({ act: true, deltaCents: 45_000, cumulative: TOP_UP });
    prior = apply(prior, "dispute", TOP_UP, 45_000);

    expect(prior.reduce((sum, row) => sum - row.deltaCents, 0)).toBe(TOP_UP);
  });
});

describe("winning a dispute", () => {
  it("gives back what the dispute took", () => {
    const prior = apply([], "dispute", TOP_UP, TOP_UP);
    expect(computeRestore(prior)).toEqual({ act: true, deltaCents: TOP_UP });
  });

  it("does NOT give back a refund", () => {
    /*
     * The round 6 defect. A refund is permanent — the cardholder has the money —
     * so restoring it on an unrelated dispute win credits a balance nobody paid
     * for. Both rows used to be keyed identically.
     */
    let prior = apply([], "refund", 5_000, 5_000);
    prior = apply(prior, "dispute", TOP_UP, 45_000);

    expect(computeRestore(prior)).toEqual({ act: true, deltaCents: 45_000 });
  });

  it("does nothing when only a refund happened", () => {
    const prior = apply([], "refund", 5_000, 5_000);
    expect(computeRestore(prior)).toEqual({ act: false, reason: "nothing_was_reversed" });
  });

  it("does nothing on a redelivered close event", () => {
    const prior: PriorMovement[] = [
      { deltaCents: -TOP_UP, key: reversalKey(PI, "dispute", TOP_UP) },
      { deltaCents: TOP_UP, key: restoreKey(PI, "dp_1") },
    ];
    expect(computeRestore(prior)).toEqual({ act: false, reason: "already_restored" });
  });
});

describe("a refund AFTER a dispute was won", () => {
  it("still takes the money back", () => {
    /*
     * The other round 6 critical. The old code counted the dispute reversal as
     * "already reversed" while ignoring the restore that gave it back, so a later
     * refund computed a delta of zero and took nothing — the platform paid €500
     * out of Stripe and the freelancer kept €500 of spendable balance.
     */
    const prior: PriorMovement[] = [
      { deltaCents: -TOP_UP, key: reversalKey(PI, "dispute", TOP_UP) },
      { deltaCents: TOP_UP, key: restoreKey(PI, "dp_1") },
    ];

    const decision = computeReversal({ topUpCents: TOP_UP, reversibleCents: TOP_UP, prior });
    expect(decision).toEqual({ act: true, deltaCents: TOP_UP, cumulative: TOP_UP });
  });
});

describe("the keys", () => {
  it("distinguishes cause, so a win can give back only its own share", () => {
    expect(reversalKey(PI, "refund", 5_000)).toBe("reversal:pi_X:refund:5000");
    expect(reversalKey(PI, "dispute", 50_000)).toBe("reversal:pi_X:dispute:50000");
  });

  it("scopes a restore to one dispute, so a second dispute restores again", () => {
    expect(restoreKey(PI, "dp_1")).not.toBe(restoreKey(PI, "dp_2"));
  });

  it("never collides with the original top-up's own key", () => {
    for (const key of [reversalKey(PI, "refund", 1), restoreKey(PI, "dp_1")]) {
      expect(key).not.toBe(PI);
      expect(key.startsWith(PI)).toBe(false);
    }
  });
});
