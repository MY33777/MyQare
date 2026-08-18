import { qualificationsByCategory } from "@/lib/qualifications";

/**
 * The qualification picker.
 *
 * A grouped native <select> rather than a search-as-you-type combobox, because
 * the list is a few dozen entries and a coordinator posting a shift already knows
 * exactly which one they want. Native also means it works on a phone, with a
 * keyboard, and with a screen reader without any of it being my problem.
 *
 * If the taxonomy is ever empty the field degrades to a text input rather than
 * rendering an unusable empty dropdown — a shift with a typed qualification is
 * recoverable; a form that cannot be submitted is not.
 */
export function QualificationSelect({
  name = "qualification",
  id = "qualification",
  defaultValue,
  required = true,
  includeAny = false,
}: {
  name?: string;
  id?: string;
  defaultValue?: string;
  required?: boolean;
  /** Adds an "any qualification" option, for filters rather than for posting. */
  includeAny?: boolean;
}) {
  const groups = qualificationsByCategory();

  if (groups.length === 0) {
    return (
      <input
        className="input"
        id={id}
        name={name}
        type="text"
        defaultValue={defaultValue}
        required={required}
        placeholder="bijv. Verzorgende IG"
      />
    );
  }

  return (
    <select className="select" id={id} name={name} defaultValue={defaultValue ?? ""} required={required}>
      <option value="" disabled={required}>
        {includeAny ? "Alle kwalificaties" : "Kies een kwalificatie…"}
      </option>
      {groups.map((group) => (
        <optgroup key={group.category} label={group.label}>
          {group.items.map((qualification) => (
            <option key={qualification.slug} value={qualification.slug}>
              {qualification.shortNl}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
