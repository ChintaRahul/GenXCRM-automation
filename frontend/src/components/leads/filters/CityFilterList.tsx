import { FilterDropdown } from "../../filters/FilterDropdown";
import { FilterSectionHeader } from "../../filters/FilterSectionHeader";
import { SearchableFilterList } from "../../filters/SearchableFilterList";

interface CityFilterListProps {
  cities: string[];
  value: string[];
  onChange: (next: string[]) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function triggerLabel(value: string[]): string {
  if (value.length === 0) return "Any city";
  if (value.length === 1) return value[0];
  return `${value.length} cities selected`;
}

export function CityFilterList({
  cities,
  value,
  onChange,
  open,
  onToggle,
  onClose,
}: CityFilterListProps) {
  return (
    <div>
      <FilterSectionHeader title="City" onReset={() => onChange([])} />
      <FilterDropdown
        triggerLabel={triggerLabel(value)}
        open={open}
        onToggle={onToggle}
        onClose={onClose}
      >
        <SearchableFilterList
          items={cities.map((c) => ({ id: c, label: c }))}
          value={value}
          onChange={onChange}
          searchPlaceholder="Search cities…"
          emptyMessage={(query) => `No city matches "${query}"`}
        />
      </FilterDropdown>
    </div>
  );
}
