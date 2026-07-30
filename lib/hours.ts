/**
 * Scheduled duration of a shift, in billable minutes.
 *
 * Breaks are unpaid and subtracted here, so "billable" means exactly what goes
 * on the invoice. Clamped at zero because a facility can enter a break longer
 * than the shift itself (a typo, or a shift shortened after the break was set),
 * and a negative duration would turn into a negative invoice.
 */
export function billableMinutes(
  startsAt: Date | string,
  endsAt: Date | string,
  breakMinutes: number,
): number {
  const start = typeof startsAt === "string" ? new Date(startsAt) : startsAt;
  const end = typeof endsAt === "string" ? new Date(endsAt) : endsAt;
  const gross = Math.round((end.getTime() - start.getTime()) / 60_000);
  return Math.max(0, gross - Math.max(0, breakMinutes));
}

/** "7 u 45 m" — how a Dutch timesheet reads. Minutes omitted when zero. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} m`;
  if (m === 0) return `${h} u`;
  return `${h} u ${m} m`;
}

const NL_DATETIME = new Intl.DateTimeFormat("nl-NL", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  /*
   * Pinned to Amsterdam rather than the viewer's clock. Everyone involved in a
   * shift is physically in the Netherlands, and a server rendering in UTC would
   * otherwise show a 21:00 night shift as 19:00 in winter and 20:00 in summer —
   * wrong, and wrong by a different amount depending on the date.
   */
  timeZone: "Europe/Amsterdam",
});

const NL_DATE = new Intl.DateTimeFormat("nl-NL", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Amsterdam",
});

const NL_TIME = new Intl.DateTimeFormat("nl-NL", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});

export function formatDateTime(value: Date | string): string {
  return NL_DATETIME.format(typeof value === "string" ? new Date(value) : value);
}

export function formatDate(value: Date | string): string {
  return NL_DATE.format(typeof value === "string" ? new Date(value) : value);
}

export function formatTime(value: Date | string): string {
  return NL_TIME.format(typeof value === "string" ? new Date(value) : value);
}

/** "vr 14 aug 07:00 – 15:30" — one line for a shift, without repeating the date. */
export function formatShiftWindow(startsAt: Date | string, endsAt: Date | string): string {
  return `${formatDateTime(startsAt)} – ${formatTime(endsAt)}`;
}
