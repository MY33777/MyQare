import Link from "next/link";
import type { ChecklistStep } from "@/lib/onboarding";

/**
 * Setup checklist for a facility that is not yet running.
 *
 * Disappears entirely once every step is done — a permanent "you did it" panel is
 * clutter on a screen someone opens every morning to fill tomorrow's roster.
 */
export function Checklist({ steps, next }: { steps: ChecklistStep[]; next: ChecklistStep | null }) {
  const remaining = steps.filter((step) => !step.done).length;
  if (remaining === 0) return null;

  return (
    <section className="card p-5 mb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="font-bold">Nog even instellen</h2>
        <span className="text-sm tnum" style={{ color: "var(--text-muted)" }}>
          {steps.length - remaining} van {steps.length} klaar
        </span>
      </div>

      {/*
        "Begin bij X" is an instruction, and it must only appear when X is
        something they can actually begin.

        nextStep() falls back to the first unfinished step when nothing is
        actionable, which for a brand-new facility is "account geverifieerd" — so
        this read "Begin bij account geverifieerd", telling a coordinator to go and
        do the thing she is waiting on us for. When the next step is one of ours,
        the honest line is that there is nothing for her to do.
      */}
      {next ? (
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          {next.waiting ? (
            <>
              Wij zijn aan zet. Je hoeft nu niets te doen — je krijgt bericht zodra dit rond is.
            </>
          ) : (
            <>
              Begin bij <strong>{next.title.toLowerCase()}</strong>.
            </>
          )}
        </p>
      ) : null}

      <ol className="space-y-3">
        {steps.map((step) => (
          <li key={step.key} className="flex gap-3">
            <span
              className="flex-none w-5 h-5 mt-0.5 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                background: step.done
                  ? "var(--ok-subtle)"
                  : step.waiting
                    ? "var(--warn-subtle)"
                    : "var(--surface-sunken)",
                color: step.done
                  ? "var(--ok)"
                  : step.waiting
                    ? "var(--warn)"
                    : "var(--text-muted)",
              }}
              aria-hidden
            >
              {step.done ? "✓" : step.waiting ? "…" : ""}
            </span>

            <div className="flex-1">
              <p className="font-semibold text-sm">
                {step.title}
                {/* A blocking step the facility CAN act on is the only thing worth
                    shouting about. "Waiting on us" gets a calmer marker above. */}
                {step.blocking && !step.done && !step.waiting ? (
                  <span className="badge badge-warn ml-2">nodig om te starten</span>
                ) : null}
              </p>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {step.body}
              </p>
              {!step.done && !step.waiting ? (
                <Link className="text-sm font-medium" href={step.href}>
                  {step.cta} →
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
