/*
 * Invoice numbering.
 *
 * The invoicing party is the freelancer, not MyQare — we generate the document
 * on their behalf. So the series is per freelancer, restarting each calendar
 * year, and it has to be unbroken: the Belastingdienst expects a sequential
 * series per invoicing party, and a gap is the kind of thing that turns a
 * routine check into a longer one.
 *
 * Allocation itself is racy by nature (two shifts approved in the same second),
 * so the caller retries against the unique (freelancer_id, number) constraint in
 * supabase/schema.sql rather than trusting a read-then-write. The logic here is
 * kept pure so that retry loop is the only stateful part.
 */

const PATTERN = /^(\d{4})-(\d{4,})$/;

export function formatInvoiceNumber(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error(`Invalid invoice year: ${year}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Invoice sequence starts at 1, got ${sequence}`);
  }
  // Padded to four digits, but not truncated past it — a freelancer who somehow
  // issues 10,000 invoices in a year gets "2026-10000" rather than a collision.
  return `${year}-${String(sequence).padStart(4, "0")}`;
}

export function parseInvoiceNumber(value: string): { year: number; sequence: number } | null {
  const match = PATTERN.exec(value.trim());
  if (!match) return null;
  return { year: Number(match[1]), sequence: Number(match[2]) };
}

/**
 * Next number in a freelancer's series for the given year.
 *
 * @param existing Every invoice number already issued to this freelancer. Numbers
 *   from other years are ignored rather than rejected, since the same freelancer
 *   carries a series across years and the caller passes the whole set.
 */
export function nextInvoiceNumber(existing: string[], year: number): string {
  let highest = 0;
  for (const value of existing) {
    const parsed = parseInvoiceNumber(value);
    if (parsed && parsed.year === year && parsed.sequence > highest) {
      highest = parsed.sequence;
    }
  }
  return formatInvoiceNumber(year, highest + 1);
}

/**
 * Payment term. 30 days is the Dutch commercial default and what a facility's
 * accounts-payable process expects; anything shorter just generates arguments.
 */
export const PAYMENT_TERM_DAYS = 30;

export function dueDate(issuedOn: Date, termDays = PAYMENT_TERM_DAYS): Date {
  const due = new Date(issuedOn);
  due.setUTCDate(due.getUTCDate() + termDays);
  return due;
}
