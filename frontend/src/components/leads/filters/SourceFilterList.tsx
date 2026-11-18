import { SearchableFilterList } from "../../filters/SearchableFilterList";
import { FilterSectionHeader } from "../../filters/FilterSectionHeader";
import { statusDotClassName, statusLabel } from "../../shared/StatusBadge";
import type { LeadFacets } from "../../../types";

interface SourceFilterListProps {
  facets: LeadFacets["sources"];
  value: string[];
  onChange: (next: string[]) => void;
}

export function SourceFilterList({
  facets,
  value,
  onChange,
}: SourceFilterListProps) {
  return (
    <div>
      <FilterSectionHeader title="Source" onReset={() => onChange([])} />
      <SearchableFilterList
        searchable={false}
        items={facets.map((f) => ({
          id: f.value,
          label: statusLabel(f.value),
          meta: String(f.count),
          dotClassName: statusDotClassName(f.value),
        }))}
        value={value}
        onChange={onChange}
        emptyMessage={(query) => `No source matches "${query}"`}
      />
    </div>
  );
}
