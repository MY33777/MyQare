"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

/*
 * Post-assignment rating.
 *
 * Two deliberate omissions, both from §7.4 of the spec:
 *
 *   - There is no clinical-quality field. A coordinator annoyed about cost is not
 *     qualified to score clinical performance, and inventing a qualified assessor
 *     is out of scope for v1. The dimensions here are things the rater actually
 *     witnessed.
 *
 *   - There is no ±2-from-the-average clamp. The 2021 plan wanted one, but it
 *     makes a rating a statement about the average rather than about the shift,
 *     and the same performance would score differently depending on history. The
 *     shrinkage in lib/ratings.ts solves the problem that clamp was aiming at
 *     without distorting what the rater said.
 */

const DIMENSIONS = [
  { key: "communicatie", label: "Communicatie" },
  { key: "collegialiteit", label: "Collegialiteit" },
  { key: "stiptheid", label: "Stiptheid" },
];

export function RatingForm({
  action,
  assignmentId,
  direction,
  heading,
}: {
  action: (formData: FormData) => void;
  assignmentId: string;
  direction: "facility_to_freelancer" | "freelancer_to_facility";
  heading: string;
}) {
  const [score, setScore] = useState(7);

  return (
    <form action={action} className="card p-5 space-y-4">
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <input type="hidden" name="direction" value={direction} />

      <div>
        <h2 className="font-bold">{heading}</h2>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Alleen zichtbaar als gemiddelde, nooit als losse beoordeling met jouw naam eraan.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="score">
          Algemeen cijfer: <span className="tnum">{score}</span>
        </label>
        {/*
          A slider rather than ten buttons: it fits a phone, and it makes the whole
          0-10 range equally reachable instead of nudging people toward the ends.
        */}
        <input
          id="score"
          name="score"
          type="range"
          min={0}
          max={10}
          step={1}
          value={score}
          onChange={(event) => setScore(Number(event.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-xs" style={{ color: "var(--text-muted)" }}>
          <span>0</span>
          <span>Gemiddeld is 6</span>
          <span>10</span>
        </div>
      </div>

      <fieldset>
        <legend className="label">Waar viel het op?</legend>
        <div className="flex flex-wrap gap-4">
          {DIMENSIONS.map((dimension) => (
            <label key={dimension.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="dimensions" value={dimension.key} />
              {dimension.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label className="label" htmlFor="comment">
          Toelichting
        </label>
        <textarea className="textarea" id="comment" name="comment" rows={2} />
      </div>

      <SubmitButton className="btn btn-primary">
        Beoordeling opslaan
      </SubmitButton>
    </form>
  );
}
