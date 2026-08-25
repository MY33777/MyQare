"use client";

import { useEffect, useState } from "react";

/**
 * Shows what the shift being typed actually costs, before it is posted.
 *
 * The form asks for a start, an end, a break and an hourly rate, and then said
 * nothing about what those four add up to. A coordinator posting a night shift
 * at 07:40 because somebody rang in sick is doing "23:00 to 07:00, minus 30
 * minutes, times € 42,50" in their head — and the two numbers that go wrong are
 * the ones nobody checks: a shift accidentally 24 hours long because the end
 * DATE was left on today, and a rate typed as 4250 instead of 42,50.
 *
 * Both are visible the instant the total appears, and invisible until then.
 *
 * A client component because it has to read inputs as they are typed, which a
 * Server Component cannot. It reads them by id from the DOM rather than lifting
 * the whole form into React: the form stays a plain server-rendered form that
 * works without JavaScript, and this is an addition to it that can fail to load
 * without taking anything with it.
 */
export function ShiftCostPreview() {
  const [summary, setSummary] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    const form = document.getElementById("starts_at")?.closest("form");
    if (!form) return;

    const recompute = () => {
      const value = (id: string) =>
        (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";

      const startsAt = value("starts_at");
      const endsAt = value("ends_at");
      const pattern = value("repeat_pattern");
      const repeatCount = Math.max(1, Math.min(31, Number(value("repeat_count") || 1) || 1));
      if (!startsAt || !endsAt) {
        setSummary(null);
        setWarning(null);
        return;
      }

      const start = new Date(startsAt);
      const end = new Date(endsAt);
      const breakMinutes = Number(value("break_minutes") || 0);

      /*
       * The rate is typed the Dutch way. parseEurosToCents lives on the server
       * and this is the one place a client needs the same reading — kept to the
       * two forms a person actually types ("42,50" and "42.50") rather than
       * importing the full parser, because a preview that disagrees with the
       * server would be worse than no preview. The server's answer is the one
       * that is stored; this only has to be right for what somebody typed.
       */
      const rateCents = Math.round(Number(value("hourly_rate").replace(",", ".")) * 100);

      const total = Math.round((end.getTime() - start.getTime()) / 60_000);
      const billable = total - (Number.isFinite(breakMinutes) ? breakMinutes : 0);

      if (!Number.isFinite(total) || total <= 0) {
        setSummary(null);
        setWarning(
          end.getTime() <= start.getTime()
            ? "De eindtijd ligt vóór de begintijd. Loopt de dienst door na middernacht? Zet de einddatum op de volgende dag."
            : null,
        );
        return;
      }

      /*
       * Clamped, like lib/hours.ts billableMinutes does on the server.
       *
       * The guard above checks `total` — end minus start — while everything
       * below formats `billable`, which is that minus the break. A break longer
       * than the shift made billable negative, and Math.floor and % both keep the
       * sign: the preview printed "-4 uur -30 min" and an Intl-formatted negative
       * amount, for a form the server accepts (createShiftAction only rejects a
       * NEGATIVE break, not one larger than the shift).
       */
      if (billable <= 0) {
        setSummary(null);
        setWarning("De pauze is langer dan de dienst zelf. Controleer de pauze.");
        return;
      }

      const hours = Math.floor(billable / 60);
      const minutes = billable % 60;
      const duration = minutes === 0 ? `${hours} uur` : `${hours} uur ${minutes} min`;

      const amount =
        Number.isFinite(rateCents) && rateCents > 0
          ? new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(
              (billable * rateCents) / 60 / 100,
            )
          : null;

      /*
       * THE WHOLE SERIES, not the first night of it.
       *
       * This computed one occurrence, so a coordinator picking "Elke werkdag" and
       * typing 5 read "7 uur 30 min te declareren · € 318,75" while she was about
       * to create five shifts worth five times that — and five separate fan-outs
       * to her pool. Which five dates a Thursday start produces is a question
       * about weekend skipping that nothing on the screen answered; she found out
       * on the list page afterwards, and until now there was no way to undo it.
       *
       * The dates are expanded here rather than imported from lib/recurrence.ts
       * because that module is server-side and this is a client island reading
       * the DOM. The rule is small and the server remains the authority — this is
       * a preview, and its only job is to be right about what she typed.
       */
      const occurrences: Date[] = [];

      if (pattern && pattern !== "none") {
        const cursor = new Date(start);
        while (occurrences.length < repeatCount) {
          const isWeekend = cursor.getDay() === 0 || cursor.getDay() === 6;
          if (pattern !== "weekdays" || !isWeekend) occurrences.push(new Date(cursor));
          cursor.setDate(cursor.getDate() + (pattern === "weekly" ? 7 : 1));
          // A pathological guard: "weekdays" advances a day at a time and could
          // otherwise spin if the count were ever unbounded.
          if (occurrences.length === 0 && cursor.getTime() - start.getTime() > 60 * 86_400_000) break;
        }
      }

      const dateList = occurrences
        .map((d) =>
          d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" }),
        )
        .join(" · ");

      const seriesTotal =
        Number.isFinite(rateCents) && rateCents > 0 && occurrences.length > 1
          ? new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(
              (billable * rateCents * occurrences.length) / 60 / 100,
            )
          : null;

      const one = amount ? `${duration} te declareren · ${amount}` : `${duration} te declareren`;

      setSummary(
        occurrences.length > 1
          ? `${occurrences.length} diensten${seriesTotal ? ` · samen ${seriesTotal}` : ""} — ${dateList}`
          : one,
      );

      // Twelve hours is a long shift; sixteen is almost always a wrong end date.
      setWarning(total > 16 * 60 ? "Deze dienst duurt meer dan 16 uur. Klopt de einddatum?" : null);
    };

    recompute();
    form.addEventListener("input", recompute);
    return () => form.removeEventListener("input", recompute);
  }, []);

  if (!summary && !warning) return null;

  return (
    <div
      className="rounded-lg px-4 py-3 text-sm"
      style={{
        background: warning ? "var(--warn-subtle)" : "var(--surface-sunken)",
        color: warning ? "var(--warn)" : "var(--text)",
      }}
      // Announced, but without interrupting: this updates on every keystroke.
      role="status"
      aria-live="polite"
    >
      {summary ? <span className="font-semibold tnum">{summary}</span> : null}
      {summary && warning ? " — " : null}
      {warning}
    </div>
  );
}
