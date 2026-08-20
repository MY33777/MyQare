import { amsterdamDateKey } from '@/lib/timezone';
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
export type ReceivablesSummary = {
  /** Sent, unpaid. Money somebody has actually been asked for. */
  outstandingCents: number;
  overdueCents: number;
  overdueCount: number;
  /** Numbered but never sent — waiting on the freelancer, not on the facility. */
  unsentCents: number;
  unsentCount: number;
};

export function summariseReceivables(
  /*
   * sent_at is REQUIRED, deliberately.
   *
   * Optional would mean a caller that forgets to select the column gets
   * `undefined`, which is neither null nor a timestamp — and whichever way this
   * function then guessed, it would be guessing. Required makes the compiler ask
   * the question at every call site instead.
   */
  invoices: (InvoiceLike & { due_on: string; sent_at: string | null })[],
  now = new Date(),
): ReceivablesSummary {
  // Amsterdam calendar day: the UTC day is still yesterday just after local
  // midnight, which flags an invoice overdue a day early.
  const todayKey = amsterdamDateKey(now);

  let outstanding = 0;
  let overdue = 0;
  let overdueCount = 0;
  let unsent = 0;
  let unsentCount = 0;

  for (const invoice of invoices) {
    if (invoice.paid_at) continue;

    /*
     * A held invoice is not a receivable.
     *
     * With auto_send off the invoice is created and numbered but deliberately not
     * sent — the freelancer reviews it first. It was being counted as
     * "Openstaand" and, once its due date passed, flagged "te laat" in red. The
     * facility had never received it. Nobody was late; the invoice was sitting
     * here waiting for a button to be pressed, and the screen was blaming the
     * client for it.
     *
     * The facility's own list already excluded these (see
     * app/zorginstelling/facturen/page.tsx) — so the two sides disagreed about
     * whether a debt existed, which is the worse half of the bug.
     *
     * Counted separately rather than dropped, because it needs an action from the
     * person reading this page and silence would not prompt one.
     */
    if (invoice.sent_at === null) {
      unsent += invoice.total_cents;
      unsentCount++;
      continue;
    }

    outstanding += invoice.total_cents;
    // String comparison is correct for ISO dates and avoids a timezone question
    // that has no right answer here — a due date is a calendar day, not an instant.
    if (invoice.due_on < todayKey) {
      overdue += invoice.total_cents;
      overdueCount++;
    }
  }

  return {
    outstandingCents: outstanding,
    overdueCents: overdue,
    overdueCount,
    unsentCents: unsent,
    unsentCount,
  };
}

/**
 * Splits invoices into calendar quarters, newest first.
 *
 * Quarters rather than months because that is the btw-aangifte cycle for most
 * zzp'ers, and a month view would make them do the addition themselves four times
 * a year.
 */
export type QuarterRow = {
  label: string;
  year: number;
  quarter: number;
  exVatCents: number;
  vatCents: number;
  /** Turnover that carried 21% — rubriek 1a of the aangifte. */
  taxedExVatCents: number;
  /** Turnover exempt under art. 11-1-g — a different box entirely. */
  exemptExVatCents: number;
};

/**
 * Splits invoices into calendar quarters, newest first.
 *
 * Quarters rather than months because that is the btw-aangifte cycle for most
 * zzp'ers, and a month view would make them do the addition themselves four times
 * a year.
 *
 * TAXED AND EXEMPT TURNOVER ARE KEPT APART
 * ----------------------------------------
 * They were added together into one exVat figure. For a nurse who does both — an
 * agency shift on a ward is exempt care under art. 11-1-g, a training day for the
 * same client usually is not — that single number is exactly the one thing the
 * aangifte never asks for. Rubriek 1a wants taxed turnover; exempt turnover goes
 * somewhere else. A total of the two belongs in neither box, so anyone filing
 * from this table had to go back through the invoices by hand, which is the work
 * the table exists to save.
 *
 * The combined figure stays as `exVatCents` because the year total is still a
 * real number a person wants; it is simply no longer the only one on offer.
 */
export function byQuarter(invoices: InvoiceLike[]): QuarterRow[] {
  const buckets = new Map<
    string,
    { year: number; quarter: number; exVat: number; vat: number; taxed: number; exempt: number }
  >();

  for (const invoice of invoices) {
    const year = Number(invoice.issued_on.slice(0, 4));
    const month = Number(invoice.issued_on.slice(5, 7));
    const quarter = Math.floor((month - 1) / 3) + 1;
    const key = `${year}-Q${quarter}`;

    const bucket =
      buckets.get(key) ?? { year, quarter, exVat: 0, vat: 0, taxed: 0, exempt: 0 };

    bucket.exVat += invoice.amount_ex_vat_cents;
    bucket.vat += invoice.vat_amount_cents;

    /*
     * Keyed on the treatment RECORDED ON THE INVOICE, never recomputed from the
     * freelancer's current profile. An invoice must be able to explain itself
     * years later, and somebody who registered for VAT in March must not see last
     * year's exempt work silently move into the taxed column.
     */
    if (invoice.vat_treatment === "exempt_medical") bucket.exempt += invoice.amount_ex_vat_cents;
    else bucket.taxed += invoice.amount_ex_vat_cents;

    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([label, bucket]) => ({
      label,
      year: bucket.year,
      quarter: bucket.quarter,
      exVatCents: bucket.exVat,
      vatCents: bucket.vat,
      taxedExVatCents: bucket.taxed,
      exemptExVatCents: bucket.exempt,
    }))
    .sort((a, b) => b.year - a.year || b.quarter - a.quarter);
}
