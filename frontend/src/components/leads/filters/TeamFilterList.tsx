import { SearchableFilterList } from "../../filters/SearchableFilterList";
import { FilterSectionHeader } from "../../filters/FilterSectionHeader";
import type { Team } from "../../../types";

interface TeamFilterListProps {
  teams: Team[];
  value: string[];
  onChange: (next: string[]) => void;
}

export function TeamFilterList({ teams, value, onChange }: TeamFilterListProps) {
  return (
    <div>
      <FilterSectionHeader title="Team" onReset={() => onChange([])} />
      <SearchableFilterList
        items={teams.map((t) => ({ id: t.id, label: t.name }))}
        value={value}
        onChange={onChange}
        searchPlaceholder="Search teams…"
        emptyMessage={(query) => `No team matches "${query}"`}
      />
    </div>
  );
}
