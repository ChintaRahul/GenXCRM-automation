import { SearchableFilterList } from "../../filters/SearchableFilterList";
import { FilterSectionHeader } from "../../filters/FilterSectionHeader";

interface CourseFilterListProps {
  courses: string[];
  value: string[];
  onChange: (next: string[]) => void;
}

export function CourseFilterList({
  courses,
  value,
  onChange,
}: CourseFilterListProps) {
  return (
    <div>
      <FilterSectionHeader title="Course" onReset={() => onChange([])} />
      <SearchableFilterList
        searchable={false}
        items={courses.map((c) => ({ id: c, label: c }))}
        value={value}
        onChange={onChange}
        emptyMessage={(query) => `No course matches "${query}"`}
      />
    </div>
  );
}
