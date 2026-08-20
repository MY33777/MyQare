"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button that says something while the action runs.
 *
 * WHY THIS EXISTS
 * ---------------
 * Nothing in the product had a pending state. Every form was a Server Component
 * posting to a server action, and a server action that talks to Supabase, Stripe
 * and a mail provider takes a second or two on a good connection and considerably
 * longer on a ward's wifi. In that gap the screen did not move at all.
 *
 * On the accept screen that is not cosmetic. A freelancer taps "Dienst aannemen",
 * nothing happens, so she taps again — and the second submission races the first
 * through accept_shift(), which charges a fee. The row-level lock and the unique
 * index make the outcome correct, but nobody should have to rely on that because
 * a button looked broken.
 *
 * `useFormStatus` reads the status of the form this button is INSIDE, which is
 * why it must be its own component rather than a prop on the page: the hook
 * returns pending only for a form above it in the tree.
 *
 * This is the first client component in the app that is not a form-field island,
 * and it is deliberately the smallest one that can do the job — no state, no
 * effects, no data. Everything around it stays a Server Component.
 */
export function SubmitButton({
  children,
  pending,
  className = "btn btn-primary",
  disabled,
  ...rest
}: {
  children: React.ReactNode;
  /** What to say while it runs. Defaults to the label with an ellipsis. */
  pending?: string;
  className?: string;
  disabled?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "disabled">) {
  const status = useFormStatus();
  const busy = status.pending;

  return (
    <button
      {...rest}
      type="submit"
      className={className}
      disabled={busy || disabled}
      /*
       * aria-busy rather than only a changed label: a screen reader user who has
       * already moved past the button still hears the state change, and the label
       * swap alone would not announce itself.
       */
      aria-busy={busy || undefined}
      /*
       * The pointer stays a pointer and the opacity drops, so the button reads as
       * "working" rather than "broken". A disabled button with no visual change is
       * indistinguishable from one that ignored the tap, which is the problem.
       */
      style={busy ? { opacity: 0.7, cursor: "progress" } : undefined}
    >
      {busy ? (pending ?? `${typeof children === "string" ? children : "Bezig"}…`) : children}
    </button>
  );
}
