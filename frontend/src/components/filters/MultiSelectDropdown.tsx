import { FilterDropdown } from "./FilterDropdown";
import { SearchableFilterList, type FilterListItem } from "./SearchableFilterList";

interface MultiSelectDropdownProps {
  // Shown when nothing is selected, e.g. "Any status".
  anyLabel: string;
  // Plural noun for the multi-select summary, e.g. "statuses" -> "3 statuses selected".
  pluralNoun: string;
  items: FilterListItem[];
  value: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function summary(anyLabel: string, pluralNoun: string, items: FilterListItem[], value: string[]): string {
  if (value.length === 0) return anyLabel;
  if (value.length === 1) return items.find((i) => i.id === value[0])?.label ?? value[0];
  return `${value.length} ${pluralNoun} selected`;
}

// Trigger + checklist panel. Multi-select, so picking an option leaves the panel open; the
// parent owns open/onToggle/onClose so only one dropdown is open at a time.
export function MultiSelectDropdown({
  anyLabel,
  pluralNoun,
  items,
  value,
  onChange,
  searchable = false,
  open,
  onToggle,
  onClose,
}: MultiSelectDropdownProps) {
  return (
    <FilterDropdown
      triggerLabel={summary(anyLabel, pluralNoun, items, value)}
      open={open}
      onToggle={onToggle}
      onClose={onClose}
    >
      <SearchableFilterList items={items} value={value} onChange={onChange} searchable={searchable} />
    </FilterDropdown>
  );
}
