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
export function RoleFields() {
  const [role, setRole] = useState<Role | "">("");

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
                <input
                  type="radio"
                  name="role"
                  value={option.value}
                  checked={selected}
                  onChange={() => setRole(option.value)}
                  required
                  className="mt-1"
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
          <input className="input" id="org_name" name="org_name" type="text" required />
          <p className="hint">
            We controleren je KvK-inschrijving voordat je diensten kunt plaatsen.
          </p>
        </div>
      ) : null}
    </>
  );
}
