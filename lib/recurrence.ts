import { localInputToDate, dateToLocalInput, NL_TIMEZONE } from "@/lib/timezone";

/*
 * Repeating a shift across several days.
 *
 * A ward covering a week of nights currently fills the posting form seven times
 * and gets the DST boundary wrong at least twice a year. This expands one form
 * submission into a set of start/end pairs.
 *
 * Everything here works on WALL-CLOCK time and re-resolves each occurrence through
 * the timezone conversion, rather than adding 24 hours of milliseconds. On the
 * clock-change weekend those differ by an hour: a 23:00 night shift must stay a
 * 23:00 night shift, not become 22:00 because the underlying instant moved.
 */

export type RecurrencePattern = "none" | "daily" | "weekdays" | "weekly";

export const RECURRENCE_LABELS: Record<RecurrencePattern, string> = {
  none: "Eenmalig",
  daily: "Elke dag",
  weekdays: "Elke werkdag (ma–vr)",
  weekly: "Elke week, zelfde dag",
};

/** Hard cap. A typo in "herhaal" should not create four hundred shifts. */
export const MAX_OCCURRENCES = 31;

export type Occurrence = { startsAt: string; endsAt: string };

/**
 * Expands a first shift into all its occurrences.
 *
 * @param startInput  wall-clock "YYYY-MM-DDTHH:mm" for the first shift
 * @param endInput    wall-clock end of the first shift; may be the next day
 * @param count       total occurrences including the first
 */
export function expandRecurrence(
  startInput: string,
  endInput: string,
  pattern: RecurrencePattern,
  count: number,
): Occurrence[] {
  const first = localInputToDate(startInput);
  const last = localInputToDate(endInput);
  if (!first || !last) return [];

  const firstOccurrence: Occurrence = {
    startsAt: first.toISOString(),
    endsAt: last.toISOString(),
  };

  if (pattern === "none" || count <= 1) return [firstOccurrence];

  const total = Math.min(Math.max(1, Math.floor(count)), MAX_OCCURRENCES);
  const occurrences: Occurrence[] = [firstOccurrence];

  // Walked in whole days on the calendar rather than in milliseconds, so a DST
  // change shifts the instant and leaves the wall clock alone.
  let dayOffset = 0;
  const step = pattern === "weekly" ? 7 : 1;

  while (occurrences.length < total) {
    dayOffset += step;

    const startShifted = addDaysToWallClock(startInput, dayOffset);
    if (!startShifted) break;

    if (pattern === "weekdays" && isWeekend(startShifted.date)) continue;

    const endShifted = addDaysToWallClock(endInput, dayOffset);
    if (!endShifted) break;

    occurrences.push({
      startsAt: startShifted.date.toISOString(),
      endsAt: endShifted.date.toISOString(),
    });

    // Runaway guard: 'weekdays' skips days without adding one, so a bad pattern
    // could otherwise spin.
    if (dayOffset > MAX_OCCURRENCES * 7 + 14) break;
  }

  return occurrences;
}

/**
 * Adds whole calendar days to a wall-clock string, then re-resolves to an instant.
 *
 * The re-resolution is the point: 23:00 stays 23:00 across the clock change, which
 * plain millisecond arithmetic would not preserve.
 */
function addDaysToWallClock(input: string, days: number): { date: Date; wall: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(input.trim());
  if (!match) return null;

  const [, y, mo, d, h, mi] = match;

  // UTC arithmetic purely to roll the calendar date; the time of day is carried
  // across untouched and re-interpreted in Amsterdam afterwards.
  const rolled = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  rolled.setUTCDate(rolled.getUTCDate() + days);

  const wall = `${rolled.toISOString().slice(0, 10)}T${h}:${mi}`;
  const date = localInputToDate(wall);
  return date ? { date, wall } : null;
}

function isWeekend(date: Date): boolean {
  // Weekday as seen in Amsterdam — a Sunday 23:00 shift is Sunday locally even
  // when the instant is already Monday in UTC.
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: NL_TIMEZONE,
    weekday: "short",
  }).format(date);
  return weekday === "Sat" || weekday === "Sun";
}

/** Human summary for the confirmation message. */
export function describeRecurrence(pattern: RecurrencePattern, count: number): string {
  if (pattern === "none" || count <= 1) return "1 dienst";
  return `${count} diensten — ${RECURRENCE_LABELS[pattern].toLowerCase()}`;
}

export { dateToLocalInput };
