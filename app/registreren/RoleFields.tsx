"use client";

import { useState } from "react";

type Role = "facility_admin" | "freelancer";

/**
 * Role picker, plus the organisation name field that only a facility needs.
 *
 * Radio cards rather than a <select> because this is the one choice that decides
 * what the whole account can do, and it is worth spelling out both options in
 * full rather than hiding one behind a dropdown.
 */
export function RoleFields({
  defaultRole,
  defaultOrgName,
}: {
  /*
   * Carried back after a validation redirect, which otherwise empties the whole
   * form — including which of the two accounts somebody had chosen, on the very
   * first screen of the product. See lib/formDraft.ts.
   */
  defaultRole?: string;
  defaultOrgName?: string;
} = {}) {
  /*
   * Narrowed, not asserted. defaultRole arrives from a cookie this component does
   * not control, and an unrecognised value dropped straight into state would
   * check neither radio and leave the fieldset in a state the form cannot submit.
   */
  const initialRole: Role | "" =
    defaultRole === "facility_admin" || defaultRole === "freelancer" ? defaultRole : "";

  const [role, setRole] = useState<Role | "">(initialRole);

  const options: { value: Role; title: string; body: string }[] = [
    {
      value: "facility_admin",
      title: "Zorginstelling",
      body: "Ik plaats diensten en huur zelfstandige zorgprofessionals in.",
    },
    {
      value: "freelancer",
      title: "Zelfstandig zorgprofessional",
      body: "Ik werk als zzp'er en neem diensten aan.",
    },
  ];

  return (
    <>
      <fieldset>
        <legend className="label">Ik ben een…</legend>
        <div className="space-y-2">
          {options.map((option) => {
            const selected = role === option.value;
            return (
              <label
                key={option.value}
                className="flex gap-3 p-3 cursor-pointer"
                style={{
                  border: `1px solid ${selected ? "var(--brand)" : "var(--border-strong)"}`,
                  background: selected ? "var(--brand-subtle)" : "var(--surface)",
                  borderRadius: 8,
                }}
              >
                {/*
                  self-start matters: in a flex row the default align-items:stretch
                  blows the input's box up to the full height of the card (13×56px
                  measured), so its hit area becomes a thin vertical strip beside
                  the text. The glyph still draws at natural size, which is why it
                  looks fine and misses anyway.

                  The whole card is inside the <label>, so tapping the text selects
                  the option too — which is the target a thumb actually finds.
                */}
                <input
                  type="radio"
                  name="role"
                  value={option.value}
                  checked={selected}
                  onChange={() => setRole(option.value)}
                  required
                  className="mt-1 self-start flex-none"
                />
                <span>
                  <span className="block font-semibold text-sm">{option.title}</span>
                  <span className="block text-sm" style={{ color: "var(--text-muted)" }}>
                    {option.body}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {role === "facility_admin" ? (
        <div>
          <label className="label" htmlFor="org_name">
            Naam zorginstelling
          </label>
          <input
            className="input"
            id="org_name"
            name="org_name"
            type="text"
            defaultValue={defaultOrgName ?? ""}
            required
          />
          <p className="hint">
            We controleren je KvK-inschrijving voordat je diensten kunt plaatsen.
          </p>
        </div>
      ) : null}
    </>
  );
}
