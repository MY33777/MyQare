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
const DISPUTE = "dp_1";

function apply(
  prior: PriorMovement[],
  cause: "refund" | "dispute",
  cumulative: number,
  deltaCents: number,
  disputeId = DISPUTE,
): PriorMovement[] {
  return [
    ...prior,
    { deltaCents: -deltaCents, key: reversalKey(PI, cause, cumulative, disputeId) },
  ];
}

describe("partial refunds", () => {
  it("takes back only the newly refunded amount, not the cumulative total again", () => {
    // The round 6 defect: €50 then €30 removed €130 from a €500 top-up.
    let prior: PriorMovement[] = [];

    const first = computeReversal({ topUpCents: TOP_UP, reversibleCents: 5_000, cause: "refund", prior });
    expect(first).toEqual({ act: true, deltaCents: 5_000, cumulative: 5_000, attempt: 1 });
    prior = apply(prior, "refund", 5_000, 5_000);

    // Stripe sends the CUMULATIVE amount_refunded on the second event.
    const second = computeReversal({ topUpCents: TOP_UP, reversibleCents: 8_000, cause: "refund", prior });
    // attempt 2: the refund cause already has one reversal row, so the key gains
    // an ordinal. A first reversal keeps the key it always had.
    expect(second).toEqual({ act: true, deltaCents: 3_000, cumulative: 8_000, attempt: 2 });
    prior = apply(prior, "refund", 8_000, 3_000);

    const removed = prior.reduce((sum, row) => sum - row.deltaCents, 0);
    expect(removed).toBe(8_000);
  });

  it("does nothing on a redelivered event", () => {
    const prior = apply([], "refund", 5_000, 5_000);
    expect(computeReversal({ topUpCents: TOP_UP, reversibleCents: 5_000, cause: "refund", prior })).toEqual({
      act: false,
      reason: "already_settled",
    });
  });

  it("never removes more than the top-up granted", () => {
    // A refund in a different currency, or Stripe reporting more than we credited.
    const decision = computeReversal({ topUpCents: TOP_UP, reversibleCents: 90_000, cause: "refund", prior: [] });
    expect(decision).toEqual({ act: true, deltaCents: TOP_UP, cumulative: TOP_UP, attempt: 1 });
  });
});

describe("a partial refund followed by a dispute", () => {
  it("removes the top-up once in total, not the refund plus the whole charge", () => {
    // Previously: €50 refund then a €500 dispute removed €550 against a €500
    // top-up, driving the balance negative with no in-app way back.
    let prior = apply([], "refund", 5_000, 5_000);

    const dispute = computeReversal({
      topUpCents: TOP_UP,
      reversibleCents: TOP_UP,
      cause: "dispute",
      causeId: DISPUTE,
      prior,
    });
    // €450, and the cumulative recorded for THIS cause is €450 too — the ceiling
    // clamped it, because €50 of the disputed charge had already gone back as a
    // refund and Stripe cannot take the same €50 twice.
    expect(dispute).toEqual({ act: true, deltaCents: 45_000, cumulative: 45_000, attempt: 1 });
    prior = apply(prior, "dispute", TOP_UP, 45_000);

    expect(prior.reduce((sum, row) => sum - row.deltaCents, 0)).toBe(TOP_UP);
  });
});

describe("winning a dispute", () => {
  it("gives back what the dispute took", () => {
    const prior = apply([], "dispute", TOP_UP, TOP_UP);
    expect(computeRestore(prior, DISPUTE)).toEqual({ act: true, deltaCents: TOP_UP });
  });

  it("does NOT give back a refund", () => {
    /*
     * The round 6 defect. A refund is permanent — the cardholder has the money —
     * so restoring it on an unrelated dispute win credits a balance nobody paid
     * for. Both rows used to be keyed identically.
     */
    let prior = apply([], "refund", 5_000, 5_000);
    prior = apply(prior, "dispute", TOP_UP, 45_000);

    expect(computeRestore(prior, DISPUTE)).toEqual({ act: true, deltaCents: 45_000 });
  });

  it("does nothing when only a refund happened", () => {
    const prior = apply([], "refund", 5_000, 5_000);
    expect(computeRestore(prior, DISPUTE)).toEqual({ act: false, reason: "nothing_was_reversed" });
  });

  it("does nothing on a redelivered close event", () => {
    const prior: PriorMovement[] = [
      { deltaCents: -TOP_UP, key: reversalKey(PI, "dispute", TOP_UP, DISPUTE) },
      { deltaCents: TOP_UP, key: restoreKey(PI, DISPUTE) },
    ];
    expect(computeRestore(prior, DISPUTE)).toEqual({ act: false, reason: "already_restored" });
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
      { deltaCents: -TOP_UP, key: reversalKey(PI, "dispute", TOP_UP, DISPUTE) },
      { deltaCents: TOP_UP, key: restoreKey(PI, DISPUTE) },
    ];

    const decision = computeReversal({
      topUpCents: TOP_UP,
      reversibleCents: TOP_UP,
      cause: "refund",
      prior,
    });
    expect(decision).toEqual({ act: true, deltaCents: TOP_UP, cumulative: TOP_UP, attempt: 1 });
  });
});

/*
 * The round 8 defect, and the fourth found in this file.
 *
 * "How much is already reversed" was the net of EVERY movement on the payment,
 * compared against a figure scoped to one cause. Refunds and disputes are
 * independent — Stripe takes the money for each separately — so the second cause
 * looked mostly settled by the first.
 */
describe("a refund and a dispute for DIFFERENT money", () => {
  it("takes back both, not just the larger one", () => {
    // €100 top-up, €30 refunded, then €70 disputed. Stripe took €100.
    const topUp = 10_000;
    let prior: PriorMovement[] = [];

    const refund = computeReversal({
      topUpCents: topUp,
      reversibleCents: 3_000,
      cause: "refund",
      prior,
    });
    expect(refund).toEqual({ act: true, deltaCents: 3_000, cumulative: 3_000, attempt: 1 });
    prior = apply(prior, "refund", 3_000, 3_000);

    const dispute = computeReversal({
      topUpCents: topUp,
      reversibleCents: 7_000,
      cause: "dispute",
      causeId: DISPUTE,
      prior,
    });
    // Was €4.000 — the €30 refund counted against the €70 dispute — leaving €30
    // of money Stripe had taken sitting on the balance as spendable credit.
    expect(dispute).toEqual({ act: true, deltaCents: 7_000, cumulative: 7_000, attempt: 1 });
    prior = apply(prior, "dispute", 7_000, 7_000);

    expect(prior.reduce((sum, row) => sum - row.deltaCents, 0)).toBe(topUp);
  });

  it("works in the other order too, where the old code removed nothing at all", () => {
    // Dispute first: the refund then computed a NEGATIVE delta and did nothing.
    const topUp = 10_000;
    let prior = apply([], "dispute", 7_000, 7_000);

    const refund = computeReversal({
      topUpCents: topUp,
      reversibleCents: 3_000,
      cause: "refund",
      prior,
    });
    expect(refund).toEqual({ act: true, deltaCents: 3_000, cumulative: 3_000, attempt: 1 });
    prior = apply(prior, "refund", 3_000, 3_000);

    expect(prior.reduce((sum, row) => sum - row.deltaCents, 0)).toBe(topUp);
  });

  it("still never removes more than the top-up, whatever Stripe reports", () => {
    // The ceiling, doing the job the per-cause totals cannot: two causes that
    // overlap on the same money must not both take it.
    const topUp = 10_000;
    let prior = apply([], "refund", 8_000, 8_000);

    const dispute = computeReversal({
      topUpCents: topUp,
      reversibleCents: 10_000,
      cause: "dispute",
      causeId: DISPUTE,
      prior,
    });
    expect(dispute).toEqual({ act: true, deltaCents: 2_000, cumulative: 2_000, attempt: 1 });
    prior = apply(prior, "dispute", 2_000, 2_000);

    expect(prior.reduce((sum, row) => sum - row.deltaCents, 0)).toBe(topUp);
  });

  it("keeps two disputes on one charge apart", () => {
    const topUp = 10_000;
    let prior = apply([], "dispute", 3_000, 3_000, "dp_1");

    const second = computeReversal({
      topUpCents: topUp,
      reversibleCents: 4_000,
      cause: "dispute",
      causeId: "dp_2",
      prior,
    });
    // dp_1's €30 must not count as dp_2's already-reversed.
    expect(second).toEqual({ act: true, deltaCents: 4_000, cumulative: 4_000, attempt: 1 });
  });

  it("a redelivered refund still does nothing once a dispute has also landed", () => {
    const topUp = 10_000;
    let prior = apply([], "refund", 3_000, 3_000);
    prior = apply(prior, "dispute", 7_000, 7_000);

    expect(
      computeReversal({ topUpCents: topUp, reversibleCents: 3_000, cause: "refund", prior }),
    ).toEqual({ act: false, reason: "already_settled" });
  });
});

describe("the keys", () => {
  it("distinguishes cause, so a win can give back only its own share", () => {
    expect(reversalKey(PI, "refund", 5_000)).toBe("reversal:pi_X:refund:5000");
    expect(reversalKey(PI, "dispute", 50_000, "dp_1")).toBe("reversal:pi_X:dispute:dp_1:50000");
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

describe("a charge disputed twice", () => {
  /*
   * The round 7 critical. A won dispute restores the credit, so netReversed
   * returns to zero and the next dispute recomputes the SAME cumulative amount.
   * With the dispute id absent from the key, that produced a byte-identical
   * string to the first dispute's row — still present, because the ledger is
   * append-only. The insert hit the unique index, recordLedgerEntry swallowed the
   * 23505 as a redelivery, and the webhook returned 200 with `reversed` set:
   * money Stripe had taken back, reported as taken back, still spendable.
   *
   * The test file itself pinned the gap open. It asserted distinct RESTORE keys
   * for dp_1 and dp_2 and never checked the reversal side.
   */
  it("produces a different key for the second dispute", () => {
    expect(reversalKey(PI, "dispute", TOP_UP, "dp_1")).not.toBe(
      reversalKey(PI, "dispute", TOP_UP, "dp_2"),
    );
  });

  it("reverses again after the first was won", () => {
    const prior: PriorMovement[] = [
      { deltaCents: -TOP_UP, key: reversalKey(PI, "dispute", TOP_UP, "dp_1") },
      { deltaCents: TOP_UP, key: restoreKey(PI, "dp_1") },
    ];
    // A SECOND dispute, so dp_1's reversed-then-restored pair must not count as
    // dp_2's already-reversed — and the ceiling is clear again because the
    // restore gave the headroom back.
    expect(
      computeReversal({
        topUpCents: TOP_UP,
        reversibleCents: TOP_UP,
        cause: "dispute",
        causeId: "dp_2",
        prior,
      }),
    ).toEqual({
      act: true,
      deltaCents: TOP_UP,
      cumulative: TOP_UP,
      // dp_1's rows belong to dp_1; this is dp_2's first reversal.
      attempt: 1,
    });
  });

  /*
   * THE SAME dispute, won and then reopened.
   *
   * A card network can reopen a dispute it has decided — pre-arbitration — and
   * the issuer can then find the other way. Stripe withdraws the money a second
   * time.
   *
   * Everything about this is correct except the key. priorForCause deliberately
   * counts dp_1's restore alongside dp_1's reversal so the pair nets to zero,
   * which is what lets the reopened dispute act at all — and that netting is
   * exactly what makes the second reversal recompute the first one's cumulative
   * figure. The causeId added in round 9 does not help: it is the same dispute
   * both times, so the key came out byte-identical, the insert hit the unique
   * index, recordLedgerEntry swallowed the 23505 as a redelivery, and the
   * webhook answered 200 reporting money reversed that never left the balance.
   *
   * The test above looks like it covers this and does not: dp_2 is a SECOND
   * dispute, which already had a distinct key.
   */
  it("gives the reopened dispute a key of its own the second time", () => {
    const prior: PriorMovement[] = [
      { deltaCents: -TOP_UP, key: reversalKey(PI, "dispute", TOP_UP, "dp_1") },
      { deltaCents: TOP_UP, key: restoreKey(PI, "dp_1") },
    ];

    const again = computeReversal({
      topUpCents: TOP_UP,
      reversibleCents: TOP_UP,
      cause: "dispute",
      causeId: "dp_1",
      prior,
    });

    expect(again).toEqual({ act: true, deltaCents: TOP_UP, cumulative: TOP_UP, attempt: 2 });
    if (!again.act) throw new Error("unreachable");

    const first = reversalKey(PI, "dispute", TOP_UP, "dp_1");
    const second = reversalKey(PI, "dispute", again.cumulative, "dp_1", again.attempt);

    expect(second).not.toBe(first);
    // The first key is unchanged, so nothing already in the ledger moves.
    expect(first).toBe("reversal:pi_X:dispute:dp_1:50000");
  });

  /*
   * A redelivery is still caught, and caught EARLIER than the key: a repeat of
   * the same event computes a delta of zero and never reaches the insert. The
   * ordinal above only applies to a movement that genuinely acts.
   */
  it("still refuses a redelivered dispute event", () => {
    const prior: PriorMovement[] = [
      { deltaCents: -TOP_UP, key: reversalKey(PI, "dispute", TOP_UP, "dp_1") },
    ];

    expect(
      computeReversal({
        topUpCents: TOP_UP,
        reversibleCents: TOP_UP,
        cause: "dispute",
        causeId: "dp_1",
        prior,
      }),
    ).toEqual({ act: false, reason: "already_settled" });
  });

  it("restores only the dispute that was won", () => {
    // Two disputes of €200 each, both reversed. Winning one must give back €200,
    // not €400 — the other chargeback is still outstanding.
    const prior: PriorMovement[] = [
      { deltaCents: -20_000, key: reversalKey(PI, "dispute", 20_000, "dp_1") },
      { deltaCents: -20_000, key: reversalKey(PI, "dispute", 40_000, "dp_2") },
    ];
    expect(computeRestore(prior, "dp_1")).toEqual({ act: true, deltaCents: 20_000 });
    expect(computeRestore(prior, "dp_2")).toEqual({ act: true, deltaCents: 20_000 });
  });

  it("says nothing was reversed for a dispute it has no row for", () => {
    const prior = apply([], "dispute", TOP_UP, TOP_UP, "dp_1");
    expect(computeRestore(prior, "dp_9")).toEqual({ act: false, reason: "nothing_was_reversed" });
  });
});
