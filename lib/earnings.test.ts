import { describe, expect, it } from "vitest";
import {
  byQuarter,
  summariseEarnings,
  summariseReceivables,
  type InvoiceLike,
} from "@/lib/earnings";

const NOW = new Date("2026-08-18T12:00:00Z");

function invoice(overrides: Partial<InvoiceLike & { due_on: string }> = {}) {
  return {
    issued_on: "2026-08-01",
    due_on: "2026-08-31",
    paid_at: null,
    amount_ex_vat_cents: 40_000,
    vat_amount_cents: 8_400,
    total_cents: 48_400,
    vat_treatment: "standard_21",
    ...overrides,
  };
}

describe("summariseEarnings", () => {
  it("sums turnover net of VAT", () => {
    const out = summariseEarnings([invoice(), invoice()], []);
    expect(out.turnoverExVatCents).toBe(80_000);
    expect(out.vatChargedCents).toBe(16_800);
    expect(out.invoiceCount).toBe(2);
  });

  /*
   * Turnover is net on purpose. Gross flatters the figure by up to 21%, and that
   * portion is never the freelancer's money — it passes to the Belastingdienst. A
   * dashboard showing gross as "verdiend" invites someone to spend what they owe.
   */
  it("does not count VAT as earnings", () => {
    const out = summariseEarnings([invoice()], []);
    expect(out.turnoverExVatCents).toBe(40_000);
    expect(out.turnoverExVatCents).not.toBe(48_400);
  });

  it("counts an exempt invoice at its full amount", () => {
    const exempt = invoice({
      amount_ex_vat_cents: 31_875,
      vat_amount_cents: 0,
      total_cents: 31_875,
      vat_treatment: "exempt_medical",
    });
    const out = summariseEarnings([exempt], []);
    expect(out.turnoverExVatCents).toBe(31_875);
    expect(out.vatChargedCents).toBe(0);
  });

  it("values booked-but-unworked shifts", () => {
    const out = summariseEarnings([], [{ minutes: 480, rateCents: 5000 }]);
    expect(out.bookedCents).toBe(40_000);
  });

  it("rounds each booked shift the way it will actually be invoiced", () => {
    // Three shifts of 7h45 at €42.50: 32_937.5 each, rounded per shift.
    const out = summariseEarnings([], [
      { minutes: 465, rateCents: 4250 },
      { minutes: 465, rateCents: 4250 },
      { minutes: 465, rateCents: 4250 },
    ]);
    expect(out.bookedCents).toBe(32_938 * 3);
  });

  it("is all zeroes for a brand new account", () => {
    const out = summariseEarnings([], []);
    expect(out).toEqual({
      turnoverExVatCents: 0,
      vatChargedCents: 0,
      bookedCents: 0,
      invoiceCount: 0,
    });
  });
});

describe("summariseReceivables", () => {
  it("counts only unpaid invoices as outstanding", () => {
    const out = summariseReceivables(
      [invoice(), invoice({ paid_at: "2026-08-10T00:00:00Z" })],
      NOW,
    );
    expect(out.outstandingCents).toBe(48_400);
  });

  it("separates overdue from merely unpaid", () => {
    const out = summariseReceivables(
      [
        invoice({ due_on: "2026-08-31" }), // still within term
        invoice({ due_on: "2026-08-01" }), // past due
      ],
      NOW,
    );
    expect(out.outstandingCents).toBe(96_800);
    expect(out.overdueCents).toBe(48_400);
    expect(out.overdueCount).toBe(1);
  });

  /*
   * A facility inside its 30-day term is not a problem, and flagging it red trains
   * people to ignore the colour by the time one genuinely is late.
   */
  it("does not treat an invoice due today as overdue", () => {
    const out = summariseReceivables([invoice({ due_on: "2026-08-18" })], NOW);
    expect(out.overdueCents).toBe(0);
    expect(out.outstandingCents).toBe(48_400);
  });

  it("never counts a paid invoice as overdue, however old", () => {
    const out = summariseReceivables(
      [invoice({ due_on: "2020-01-01", paid_at: "2020-01-02T00:00:00Z" })],
      NOW,
    );
    expect(out.outstandingCents).toBe(0);
    expect(out.overdueCents).toBe(0);
  });

  it("is zero for someone with no invoices", () => {
    expect(summariseReceivables([], NOW)).toEqual({
      outstandingCents: 0,
      overdueCents: 0,
      overdueCount: 0,
    });
  });
});

describe("byQuarter", () => {
  it("buckets by calendar quarter, newest first", () => {
    const out = byQuarter([
      invoice({ issued_on: "2026-01-15" }),
      invoice({ issued_on: "2026-04-02" }),
      invoice({ issued_on: "2026-08-01" }),
    ]);
    expect(out.map((bucket) => bucket.label)).toEqual(["2026-Q3", "2026-Q2", "2026-Q1"]);
  });

  it("sums within a quarter", () => {
    const out = byQuarter([invoice({ issued_on: "2026-07-01" }), invoice({ issued_on: "2026-09-30" })]);
    expect(out).toHaveLength(1);
    expect(out[0].exVatCents).toBe(80_000);
    expect(out[0].vatCents).toBe(16_800);
  });

  it("puts quarter boundaries on the right side", () => {
    // March is Q1, April is Q2; September is Q3, October is Q4.
    const labels = byQuarter([
      invoice({ issued_on: "2026-03-31" }),
      invoice({ issued_on: "2026-04-01" }),
      invoice({ issued_on: "2026-09-30" }),
      invoice({ issued_on: "2026-10-01" }),
    ]).map((bucket) => bucket.label);

    expect(labels).toEqual(["2026-Q4", "2026-Q3", "2026-Q2", "2026-Q1"]);
  });

  it("keeps years apart", () => {
    const out = byQuarter([invoice({ issued_on: "2025-08-01" }), invoice({ issued_on: "2026-08-01" })]);
    expect(out.map((bucket) => bucket.label)).toEqual(["2026-Q3", "2025-Q3"]);
  });

  it("returns nothing for no invoices", () => {
    expect(byQuarter([])).toEqual([]);
  });
});
