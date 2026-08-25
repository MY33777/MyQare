import { describe, expect, it } from "vitest";
import {
  checklistComplete,
  facilityChecklist,
  nextStep,
  type FacilityState,
} from "@/lib/onboarding";

function state(overrides: Partial<FacilityState> = {}): FacilityState {
  return {
    verified: false,
    hasBillingEmail: false,
    hasBillingAddress: false,
    poolCount: 0,
    shiftCount: 0,
    assignmentCount: 0,
    ...overrides,
  };
}

describe("facilityChecklist", () => {
  it("marks nothing done for a brand new facility", () => {
    const steps = facilityChecklist(state());
    expect(steps.every((step) => !step.done)).toBe(true);
    expect(checklistComplete(steps)).toBe(false);
  });

  it("marks everything done once the facility is running", () => {
    const steps = facilityChecklist(
      state({ verified: true, hasBillingEmail: true, hasBillingAddress: true, poolCount: 4, shiftCount: 2 }),
    );
    expect(checklistComplete(steps)).toBe(true);
  });

  /*
   * Verification blocks posting but is not something the facility can act on, so it
   * is marked waiting. Presenting it as an outstanding task reads as "you forgot
   * something" when they are in fact waiting on us.
   */
  it("treats verification as waiting on us, not as their task", () => {
    const verification = facilityChecklist(state()).find((step) => step.key === "verified")!;
    expect(verification.blocking).toBe(true);
    expect(verification.waiting).toBe(true);
  });

  it("stops flagging verification once it is done", () => {
    const verification = facilityChecklist(state({ verified: true })).find(
      (step) => step.key === "verified",
    )!;
    expect(verification.done).toBe(true);
    expect(verification.blocking).toBe(false);
  });

  /*
   * The failure this whole module exists for. An empty pool does not stop a shift
   * being posted — it stops anyone hearing about it, and the app reports success
   * anyway. Nothing else in the product makes that visible.
   */
  it("treats an empty pool as blocking", () => {
    const pool = facilityChecklist(state({ verified: true })).find((step) => step.key === "pool")!;
    expect(pool.blocking).toBe(true);
    expect(pool.waiting).toBe(false);
  });

  /*
   * And the gate the step did not know about.
   *
   * addToPoolAction refuses while the organisation is unverified. This step had
   * no `waiting` flag, so nextStep() led a brand-new facility straight to a form
   * the server would refuse — and the refusal told her to build her pool.
   */
  it("marks the pool as waiting while verification is pending", () => {
    const pool = facilityChecklist(state()).find((step) => step.key === "pool")!;
    expect(pool.waiting).toBe(true);
    expect(pool.body).toMatch(/geverifieerd/);
  });

  it("marks posting as waiting while verification is pending", () => {
    const shift = facilityChecklist(state()).find((step) => step.key === "shift")!;
    expect(shift.waiting).toBe(true);
    expect(shift.body).toMatch(/geverifieerd/);
  });

  it("stops flagging the pool once it has anyone in it", () => {
    const pool = facilityChecklist(state({ poolCount: 1 })).find((step) => step.key === "pool")!;
    expect(pool.done).toBe(true);
    expect(pool.blocking).toBe(false);
  });

  it("counts in singular and plural correctly", () => {
    expect(facilityChecklist(state({ poolCount: 1 })).find((s) => s.key === "pool")!.body).toContain(
      "1 zorgprofessional in",
    );
    expect(facilityChecklist(state({ poolCount: 3 })).find((s) => s.key === "pool")!.body).toContain(
      "3 zorgprofessionals",
    );
    expect(facilityChecklist(state({ shiftCount: 1 })).find((s) => s.key === "shift")!.body).toContain(
      "1 dienst ",
    );
    expect(facilityChecklist(state({ shiftCount: 2 })).find((s) => s.key === "shift")!.body).toContain(
      "2 diensten",
    );
  });

  it("gives every step somewhere to go", () => {
    for (const step of facilityChecklist(state())) {
      expect(step.href.startsWith("/")).toBe(true);
      expect(step.cta.length).toBeGreaterThan(0);
    }
  });
});

describe("nextStep", () => {
  /*
   * While unverified there is nothing they can do at all, and saying so is the
   * honest answer.
   *
   * This used to assert "pool", on the stated assumption that building a pool is
   * something "they can do meanwhile". They cannot: addToPoolAction refuses until
   * the organisation is verified, and the refusal told them to build their pool.
   * So the test encoded the false premise and the dead end it produced.
   *
   * Only `billing` remains actionable, and onboarding seeds billing_email from
   * the founder's own address — so for a real new facility this returns null and
   * the checklist stops recommending anything, which is correct: there is nothing
   * to do but wait one working day.
   */
  it("does not point at the pool while verification is pending", () => {
    expect(nextStep(facilityChecklist(state()))?.key).not.toBe("pool");
  });

  /*
   * When only we are holding things up, the step it lands on is ours — and
   * components/Checklist.tsx reads `waiting` to say "wij zijn aan zet" instead of
   * "begin bij…". What must not happen is landing on a step she cannot act on
   * while presenting it as her next action.
   */
  it("lands on a waiting step when nothing is actionable", () => {
    const next = nextStep(facilityChecklist(state({ hasBillingEmail: true, hasBillingAddress: true })));
    expect(next?.waiting).toBe(true);
  });

  it("still points at the pool once verified but empty", () => {
    expect(nextStep(facilityChecklist(state({ verified: true })))?.key).toBe("pool");
  });

  it("moves on to billing once the pool exists", () => {
    expect(
      nextStep(facilityChecklist(state({ verified: true, poolCount: 2 })))?.key,
    ).toBe("billing");
  });

  it("ends on posting a shift", () => {
    expect(
      nextStep(facilityChecklist(state({ verified: true, poolCount: 2, hasBillingEmail: true, hasBillingAddress: true })))
        ?.key,
    ).toBe("shift");
  });

  it("returns nothing once everything is done", () => {
    expect(
      nextStep(
        facilityChecklist(
          state({ verified: true, hasBillingEmail: true, hasBillingAddress: true, poolCount: 1, shiftCount: 1 }),
        ),
      ),
    ).toBeNull();
  });
});
