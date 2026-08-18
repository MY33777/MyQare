/*
 * Converting between the times a Dutch coordinator types and the instants we
 * store.
 *
 * THE BUG THIS PREVENTS
 * ---------------------
 * An <input type="datetime-local"> submits a naive wall-clock string like
 * "2026-08-14T07:00" with no zone attached. `new Date("2026-08-14T07:00")`
 * interprets that in the *runtime's* zone. On a developer's laptop in Amsterdam
 * that happens to be right; on Vercel, where the runtime is UTC, a 07:00 shift is
 * stored as 07:00Z and displayed back to the coordinator as 09:00.
 *
 * It would look correct in development and be two hours wrong in production, for
 * half the year. In a staffing product that means people turning up at the wrong
 * time, so the conversion is explicit and tested rather than incidental.
 */

export const NL_TIMEZONE = "Europe/Amsterdam";

/**
 * Offset of a time zone from UTC at a given instant, in milliseconds.
 *
 * JavaScript has no API that hands you the offset for an arbitrary zone, so this
 * asks the formatter what wall clock the instant shows there, reads that back as
 * if it were UTC, and diffs. That makes it DST-aware without a timezone library:
 * +2h in August and +1h in January because the formatter says so.
 *
 * Deliberately built on formatToParts rather than the shorter
 * `new Date(instant.toLocaleString("en-US", { timeZone }))` trick. That version
 * round-trips through a string which `new Date` parses in the *runtime's* zone,
 * and during the spring-forward gap the wall clock it produces does not exist —
 * 02:00 on the changeover day resolves to 03:00, so the offset comes back an hour
 * short and every shift on that date is stored wrong. Reading the parts directly
 * never parses in local time at all.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  // en-US with hour12:false emits "24" for midnight on some ICU builds.
  const hour = value("hour") % 24;

  const wallClockAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    hour,
    value("minute"),
    value("second"),
  );

  return wallClockAsUtc - instant.getTime();
}

/**
 * Turns a naive "YYYY-MM-DDTHH:mm" wall-clock string in Amsterdam into a real
 * instant.
 *
 * Applied twice on purpose. The offset depends on the instant, but the instant is
 * what we are solving for, so the first pass uses an approximate offset and the
 * second corrects it. Without the second pass, a shift starting within an hour or
 * two of a DST changeover lands an hour out.
 */
export function localInputToDate(value: string, timeZone = NL_TIMEZONE): Date | null {
  if (!value) return null;

  // Accept both "2026-08-14T07:00" and "2026-08-14T07:00:00".
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;

  const [, y, mo, d, h, mi, s] = match;
  const asIfUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
  );

  const firstGuess = new Date(asIfUtc - zoneOffsetMs(new Date(asIfUtc), timeZone));
  const corrected = new Date(asIfUtc - zoneOffsetMs(firstGuess, timeZone));

  if (Number.isNaN(corrected.getTime())) return null;
  return corrected;
}

/** ISO string for storage, or null if the input was unusable. */
export function localInputToIso(value: string, timeZone = NL_TIMEZONE): string | null {
  const date = localInputToDate(value, timeZone);
  return date ? date.toISOString() : null;
}

/**
 * The calendar date in Amsterdam, as YYYY-MM-DD.
 *
 * Use this anywhere a DATE is derived from "now" — an invoice date, a due date, an
 * overdue comparison, the year in an invoice number.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, and Amsterdam runs one
 * or two hours AHEAD, so between midnight and 01:00 or 02:00 local the two
 * disagree. An invoice approved at 00:30 was dated the previous day, while the PDF
 * beside it printed the Amsterdam date — the document contradicted its own record.
 * On New Year's Eve it also picked the wrong year for the invoice number, which
 * breaks the per-year sequence the Belastingdienst expects.
 */
export function amsterdamDateKey(instant: Date = new Date(), timeZone = NL_TIMEZONE): string {
  // en-CA is the one locale that formats as YYYY-MM-DD without reassembling parts.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** The calendar year in Amsterdam. Invoice numbering restarts on it. */
export function amsterdamYear(instant: Date = new Date(), timeZone = NL_TIMEZONE): number {
  return Number(amsterdamDateKey(instant, timeZone).slice(0, 4));
}

/**
 * Adds whole calendar days to a YYYY-MM-DD key, staying a calendar date.
 *
 * Used for payment terms: "30 days after the invoice date" is 30 calendar days,
 * not 30 × 86,400,000 milliseconds, and the two differ across a clock change.
 */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const rolled = new Date(Date.UTC(year, month - 1, day));
  rolled.setUTCDate(rolled.getUTCDate() + days);
  return rolled.toISOString().slice(0, 10);
}

/**
 * The reverse: an instant rendered as the wall-clock string a datetime-local
 * input expects, so an edit form shows what the coordinator originally typed.
 */
export function dateToLocalInput(value: Date | string, timeZone = NL_TIMEZONE): string {
  const date = typeof value === "string" ? new Date(value) : value;

  // en-CA gives YYYY-MM-DD, which is the only locale that matches the input's
  // required format without reassembling the parts by hand.
  const datePart = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

  const timePart = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  return `${datePart}T${timePart}`;
}
