import { useEffect, useState } from "react";
import { getModuleTable } from "../../api/modules";

interface PlantSelectProps {
  readonly id: string;
  readonly accountId: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly invalid?: boolean;
}

// Only the chosen account's own plants can be picked, so a contact never points at a plant
// of another customer.
export function PlantSelect({ id, accountId, value, onChange, invalid }: PlantSelectProps) {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setNames([]);
    if (!accountId) return;
    void getModuleTable("accounts", accountId, "plants")
      .then((table) => {
        if (!cancelled) setNames(table.rows.map((r) => String(r.name ?? "")).filter(Boolean));
      })
      .catch(() => {
        if (!cancelled) setNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return (
    <select
      id={id}
      value={value}
      disabled={!accountId}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full h-9 max-[767px]:h-11 max-[767px]:text-base rounded-md border bg-background px-3 text-sm disabled:opacity-60 ${invalid ? "border-destructive" : "border-input"}`}
    >
      <option value="">{accountId ? (names.length ? "Select plant…" : "No plants on this account") : "Choose an account first"}</option>
      {value && !names.includes(value) && <option value={value}>{value}</option>}
      {names.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}
