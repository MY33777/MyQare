import { describe, expect, it } from "vitest";
import {
  dueDate,
  formatInvoiceNumber,
  nextInvoiceNumber,
  parseInvoiceNumber,
} from "@/lib/invoiceNumber";

describe("formatInvoiceNumber", () => {
  it("pads the sequence to four digits", () => {
    expect(formatInvoiceNumber(2026, 1)).toBe("2026-0001");
    expect(formatInvoiceNumber(2026, 42)).toBe("2026-0042");
  });

  it("does not truncate past four digits", () => {
    expect(formatInvoiceNumber(2026, 10_000)).toBe("2026-10000");
  });

  it("rejects an impossible year or sequence", () => {
    expect(() => formatInvoiceNumber(26, 1)).toThrow();
    expect(() => formatInvoiceNumber(2026, 0)).toThrow();
    expect(() => formatInvoiceNumber(2026, -1)).toThrow();
  });
});

describe("parseInvoiceNumber", () => {
  it("round-trips a formatted number", () => {
    expect(parseInvoiceNumber("2026-0042")).toEqual({ prefix: "", year: 2026, sequence: 42 });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseInvoiceNumber(" 2026-0042 ")).toEqual({ prefix: "", year: 2026, sequence: 42 });
  });

  it("returns null for anything that is not one of our numbers", () => {
    expect(parseInvoiceNumber("INV-42")).toBeNull();
    expect(parseInvoiceNumber("2026/0042")).toBeNull();
    expect(parseInvoiceNumber("")).toBeNull();
  });
});

describe("nextInvoiceNumber", () => {
  it("starts a fresh series at 1", () => {
    expect(nextInvoiceNumber([], 2026)).toBe("2026-0001");
  });

  it("continues from the highest existing number", () => {
    expect(nextInvoiceNumber(["2026-0001", "2026-0002"], 2026)).toBe("2026-0003");
  });

  it("does not depend on the order it is given", () => {
    expect(nextInvoiceNumber(["2026-0007", "2026-0002"], 2026)).toBe("2026-0008");
  });

  /*
   * The series restarts each January but the caller passes a freelancer's whole
   * history, so last year's numbers must not push this year's sequence forward.
   */
  it("restarts the sequence in a new year", () => {
    expect(nextInvoiceNumber(["2025-0001", "2025-0099"], 2026)).toBe("2026-0001");
  });

  it("ignores foreign numbering that somehow got into the set", () => {
    expect(nextInvoiceNumber(["INV-999", "2026-0001"], 2026)).toBe("2026-0002");
  });

  it("leaves no gap, which is the entire point", () => {
    let issued: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const next = nextInvoiceNumber(issued, 2026);
      expect(next).toBe(formatInvoiceNumber(2026, i));
      issued = [...issued, next];
    }
  });
});

describe("dueDate", () => {
  it("defaults to 30 days, the Dutch commercial norm", () => {
    expect(dueDate(new Date("2026-08-14T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-09-13");
  });

  it("accepts a custom term", () => {
    expect(dueDate(new Date("2026-08-14T00:00:00Z"), 14).toISOString().slice(0, 10)).toBe(
      "2026-08-28",
    );
  });

  it("rolls over a month and a year boundary correctly", () => {
    expect(dueDate(new Date("2026-12-20T00:00:00Z")).toISOString().slice(0, 10)).toBe("2027-01-19");
  });

  it("does not mutate the date it was given", () => {
    const issued = new Date("2026-08-14T00:00:00Z");
    dueDate(issued);
    expect(issued.toISOString().slice(0, 10)).toBe("2026-08-14");
  });
});

describe("a freelancer's own numbering series", () => {
  it("puts the chosen prefix in front of the year", () => {
    expect(formatInvoiceNumber(2026, 1, "F")).toBe("F2026-0001");
    expect(formatInvoiceNumber(2026, 1, null)).toBe("2026-0001");
    expect(parseInvoiceNumber("F2026-0042")).toEqual({ prefix: "F", year: 2026, sequence: 42 });
  });

  it("refuses a prefix that would not survive a filename or a search", () => {
    expect(() => formatInvoiceNumber(2026, 1, "F/2")).toThrow();
    expect(() => formatInvoiceNumber(2026, 1, "far-too-long")).toThrow();
  });

  /*
   * Somebody continuing a series they already ran in their own bookkeeping. Only
   * applies to an empty year — see below.
   */
  it("starts at the requested number when nothing has been issued this year", () => {
    expect(nextInvoiceNumber([], 2026, { start: 250 })).toBe("2026-0250");
    expect(nextInvoiceNumber([], 2026, { start: 250, prefix: "F" })).toBe("F2026-0250");
  });

  it("never pulls the sequence backwards to honour a start", () => {
    // Reusing a number is worse than ignoring a setting: two invoices sharing one
    // number is the thing the whole per-party series exists to prevent.
    expect(nextInvoiceNumber(["2026-0007"], 2026, { start: 3 })).toBe("2026-0008");
  });

  /*
   * Changing the prefix mid-year must not restart the count. Two invoices whose
   * numbers differ only by a letter are not a series.
   */
  it("ignores the prefix when finding the highest number so far", () => {
    expect(nextInvoiceNumber(["2026-0004"], 2026, { prefix: "F" })).toBe("F2026-0005");
    expect(nextInvoiceNumber(["F2026-0004"], 2026, { prefix: null })).toBe("2026-0005");
  });

  it("keeps the series per year", () => {
    expect(nextInvoiceNumber(["2025-0099"], 2026, { prefix: "F" })).toBe("F2026-0001");
  });
});
