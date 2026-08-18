/*
 * What a freelancer has earned, and what is still coming.
 *
 * A zzp'er has to answer three questions constantly: what did I invoice this
 * quarter, what is still unpaid, and what is already booked but not yet worked.
 * The app held all three and showed none of them.
 *
 * Everything here is pure so it can be tested; the queries live in the page.
 */

export type InvoiceLike = {
  issued_on: string;
  paid_at: string | null;
  amount_ex_vat_cents: number;
  vat_amount_cents: number;
  total_cents: number;
  vat_treatment: string;
};

export type BookedLike = {
  /** Scheduled minutes for an accepted-but-not-yet-worked shift. */
  minutes: number;
  rateCents: number;
};

export type EarningsSummary = {
  /** Net of VAT — this is the freelancer's actual turnover. */
  turnoverExVatCents: number;
  /** VAT charged on taxable work. Owed onward, never the freelancer's money. */
  vatChargedCents: number;
  /** Accepted shifts not yet worked. An expectation, not a receivable. */
  bookedCents: number;
  invoiceCount: number;
};

/*
 * Outstanding and overdue deliberately do NOT live here — they need the due date,
 * and see summariseReceivables. They were briefly fields on this type that were
 * always returned as zero, which is worse than absent: a dashboard would have
 * shown "€ 0,00 openstaand" to someone owed thousands.
 */

/**
 * Aggregates a set of invoices plus upcoming work.
 *
 * Turnover is net of VAT deliberately. Gross would flatter the number by up to 21%
 * and that portion is never the freelancer's — it passes straight to the
 * Belastingdienst. A dashboard that shows gross as "verdiend" invites someone to
 * spend money they owe.
 */
export function summariseEarnings(
  invoices: InvoiceLike[],
  booked: BookedLike[],
): EarningsSummary {
  let turnover = 0;
  let vat = 0;

  for (const invoice of invoices) {
    turnover += invoice.amount_ex_vat_cents;
    vat += invoice.vat_amount_cents;
  }

  return {
    turnoverExVatCents: turnover,
    vatChargedCents: vat,
    // Rounded per shift, matching how each one will actually be invoiced. Summing
    // unrounded and rounding once would drift from the total of the eventual
    // invoices by a cent or two.
    bookedCents: booked.reduce(
      (sum, item) => sum + Math.round((item.minutes * item.rateCents) / 60),
      0,
    ),
    invoiceCount: invoices.length,
  };
}

/**
 * Outstanding and overdue, which need the due date the summary above does not take.
 *
 * Kept separate because "unpaid" and "past due" are different questions and a
 * facility being within its 30-day term is not a problem worth flagging in red.
 */
export function summariseReceivables(
  invoices: (InvoiceLike & { due_on: string })[],
  now = new Date(),
): { outstandingCents: number; overdueCents: number; overdueCount: number } {
  const todayKey = now.toISOString().slice(0, 10);

  let outstanding = 0;
  let overdue = 0;
  let overdueCount = 0;

  for (const invoice of invoices) {
    if (invoice.paid_at) continue;
    outstanding += invoice.total_cents;
    // String comparison is correct for ISO dates and avoids a timezone question
    // that has no right answer here — a due date is a calendar day, not an instant.
    if (invoice.due_on < todayKey) {
      overdue += invoice.total_cents;
      overdueCount++;
    }
  }

  return { outstandingCents: outstanding, overdueCents: overdue, overdueCount };
}

/**
 * Splits invoices into calendar quarters, newest first.
 *
 * Quarters rather than months because that is the btw-aangifte cycle for most
 * zzp'ers, and a month view would make them do the addition themselves four times
 * a year.
 */
export function byQuarter(
  invoices: InvoiceLike[],
): { label: string; year: number; quarter: number; exVatCents: number; vatCents: number }[] {
  const buckets = new Map<string, { year: number; quarter: number; exVat: number; vat: number }>();

  for (const invoice of invoices) {
    const year = Number(invoice.issued_on.slice(0, 4));
    const month = Number(invoice.issued_on.slice(5, 7));
    const quarter = Math.floor((month - 1) / 3) + 1;
    const key = `${year}-Q${quarter}`;

    const bucket = buckets.get(key) ?? { year, quarter, exVat: 0, vat: 0 };
    bucket.exVat += invoice.amount_ex_vat_cents;
    bucket.vat += invoice.vat_amount_cents;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([label, bucket]) => ({
      label,
      year: bucket.year,
      quarter: bucket.quarter,
      exVatCents: bucket.exVat,
      vatCents: bucket.vat,
    }))
    .sort((a, b) => b.year - a.year || b.quarter - a.quarter);
}
