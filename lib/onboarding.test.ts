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
      state({ verified: true, hasBillingEmail: true, poolCount: 4, shiftCount: 2 }),
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
    expect(pool.body).toMatch(/niemand aangeboden/);
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
   * While unverified there is nothing they can do about posting, so the useful
   * next action is building the pool — which they can do meanwhile, and which is
   * the step that otherwise fails silently later.
   */
  it("points at the pool while verification is pending", () => {
    expect(nextStep(facilityChecklist(state()))?.key).toBe("pool");
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
      nextStep(facilityChecklist(state({ verified: true, poolCount: 2, hasBillingEmail: true })))
        ?.key,
    ).toBe("shift");
  });

  it("returns nothing once everything is done", () => {
    expect(
      nextStep(
        facilityChecklist(
          state({ verified: true, hasBillingEmail: true, poolCount: 1, shiftCount: 1 }),
        ),
      ),
    ).toBeNull();
  });
});
