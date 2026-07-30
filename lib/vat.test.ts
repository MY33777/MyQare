import { describe, expect, it } from "vitest";
import { assertInvoiceable, decideVat, invoiceAmounts } from "@/lib/vat";

describe("decideVat", () => {
  it("charges no VAT for an exempt medical professional", () => {
    const decision = decideVat(true);
    expect(decision.treatment).toBe("exempt_medical");
    expect(decision.rateBp).toBe(0);
    expect(decision.note).toMatch(/vrijgesteld/i);
  });

  it("charges 21% for a professional who is not exempt", () => {
    const decision = decideVat(false);
    expect(decision.treatment).toBe("standard_21");
    expect(decision.rateBp).toBe(2100);
  });

  /*
   * The distinction the whole module exists for: "nobody has decided yet" is not
   * the same as "decided to be exempt". Defaulting an unknown to exempt would
   * under-charge VAT on real invoices and surface in an audit.
   */
  it("treats unknown as undetermined, not as exempt", () => {
    const decision = decideVat(null);
    expect(decision.treatment).toBe("undetermined");
    expect(decision.rateBp).toBe(0);
  });

  it("prefers a recorded reason over the default wording", () => {
    expect(decideVat(true, "BIG-geregistreerd, art. 11-1-g").note).toBe(
      "BIG-geregistreerd, art. 11-1-g",
    );
  });

  it("ignores a blank reason and falls back to the default wording", () => {
    expect(decideVat(true, "   ").note).toMatch(/vrijgesteld/i);
  });
});

describe("invoiceAmounts", () => {
  it("leaves an exempt invoice at its net amount", () => {
    const amounts = invoiceAmounts(40_000, true);
    expect(amounts.vatAmountCents).toBe(0);
    expect(amounts.totalCents).toBe(40_000);
    expect(amounts.treatment).toBe("exempt_medical");
  });

  it("adds 21% for a taxable invoice", () => {
    const amounts = invoiceAmounts(40_000, false);
    expect(amounts.vatAmountCents).toBe(8_400);
    expect(amounts.totalCents).toBe(48_400);
  });

  it("rounds VAT half-up on an awkward net amount", () => {
    // 21% of €329.38 is 6917.0 cents (69.1698 → 6917).
    const amounts = invoiceAmounts(32_938, false);
    expect(amounts.vatAmountCents).toBe(6_917);
    expect(amounts.totalCents).toBe(39_855);
  });

  it("never returns a fractional cent", () => {
    for (const net of [1, 99, 3_333, 32_938, 123_457]) {
      const amounts = invoiceAmounts(net, false);
      expect(Number.isInteger(amounts.vatAmountCents)).toBe(true);
      expect(Number.isInteger(amounts.totalCents)).toBe(true);
    }
  });
});

describe("assertInvoiceable", () => {
  it("allows an explicitly exempt or explicitly taxable professional", () => {
    expect(() => assertInvoiceable(true)).not.toThrow();
    expect(() => assertInvoiceable(false)).not.toThrow();
  });

  /*
   * Blocking is the point. Sending a facility an invoice with the wrong VAT is
   * worse than making someone answer the question first — they deduct what we
   * print.
   */
  it("blocks invoicing when the treatment is undetermined", () => {
    expect(() => assertInvoiceable(null)).toThrow(/btw/i);
  });
});
