import { FiltersTrigger } from "../filters/FiltersTrigger";
import type { LeadFiltersValue } from "./FiltersDrawer";

export function countActiveFacets(f: LeadFiltersValue): number {
  return (
    f.stages.length +
    f.sources.length +
    f.assignedToIds.length +
    f.teamIds.length +
    f.cities.length +
    f.courses.length +
    (f.scoreMin !== undefined || f.scoreMax !== undefined ? 1 : 0) +
    (f.datePreset || f.createdAfter || f.createdBefore ? 1 : 0) +
    (f.hotOnly ? 1 : 0) +
    (f.unassigned ? 1 : 0) +
    (f.idle ? 1 : 0)
  );
}

interface FiltersButtonProps {
  filters: LeadFiltersValue;
  onClick: () => void;
}

export function FiltersButton({ filters, onClick }: FiltersButtonProps) {
  return <FiltersTrigger count={countActiveFacets(filters)} onClick={onClick} />;
}
