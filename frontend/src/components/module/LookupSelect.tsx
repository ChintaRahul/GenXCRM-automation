import { useLookupName, useLookupOptions } from "../../lib/lookupNames";

interface LookupSelectProps {
  readonly id: string;
  // "owner" for users, otherwise the referenced module key (e.g. "accounts").
  readonly source: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly invalid?: boolean;
}

// Dropdown for owner / reference fields, so only real record ids can be chosen (a typed value
// would fail the foreign key on save).
export function LookupSelect({
  id,
  source,
  value,
  onChange,
  placeholder,
  invalid,
}: LookupSelectProps) {
  const { options, loading } = useLookupOptions(source);
  // Keep an already-saved value selectable even if it isn't in the first page of records.
  const known = options.some((o) => o.id === value);
  const valueName = useLookupName(source, value);
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full h-9 max-[767px]:h-11 max-[767px]:text-base rounded-md border bg-background px-3 text-sm ${invalid ? "border-destructive" : "border-input"}`}
    >
      <option value="">{loading ? "Loading…" : options.length === 0 ? "None available yet — create one first" : placeholder}</option>
      {value && !known && <option value={value}>{valueName}</option>}
      {options
        .filter((o) => !o.inactive || o.id === value)
        .map((o) => (
          <option key={o.id} value={o.id} title={o.label}>
            {o.label}
          </option>
        ))}
    </select>
  );
}
