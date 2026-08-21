import { regionsByProvince } from "@/lib/regions";

/**
 * Picks one region, or several.
 *
 * Forty options is a lot for a bare select, so they are grouped by province —
 * somebody looks for their province first and finds their own area under it.
 * The option label carries the main towns, because "Groot-Rijnmond" means
 * nothing to a nurse in Schiedam and "Rotterdam, Schiedam, Vlaardingen" does.
 *
 * `multiple` is used on the freelancer side, where one commuting area rarely
 * describes where somebody will work, and not on the shift form, where the shift
 * happens in one place.
 *
 * A plain <select>, so this stays a Server Component and the form works without
 * JavaScript. A multi-select is not the prettiest control ever made; it is the
 * one that needs no client bundle and that every screen reader already handles.
 */
export function RegionSelect({
  name,
  id,
  defaultValue,
  multiple,
  required,
}: {
  name: string;
  id?: string;
  /** A code, or codes when `multiple`. */
  defaultValue?: string | string[] | null;
  multiple?: boolean;
  required?: boolean;
}) {
  const selected = new Set(
    Array.isArray(defaultValue) ? defaultValue : defaultValue ? [defaultValue] : [],
  );

  return (
    <select
      className="select"
      id={id ?? name}
      name={name}
      multiple={multiple}
      required={required}
      // Tall enough that several provinces are visible at once; a multi-select
      // showing four rows is where people fail to notice they can pick more.
      size={multiple ? 10 : undefined}
      defaultValue={
        multiple ? [...selected] : ([...selected][0] ?? "")
      }
    >
      {!multiple ? <option value="">Kies een regio</option> : null}

      {regionsByProvince().map(({ province, regions }) => (
        <optgroup key={province} label={province}>
          {regions.map((region) => (
            <option key={region.code} value={region.code}>
              {region.label} — {region.places.slice(0, 3).join(", ")}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
