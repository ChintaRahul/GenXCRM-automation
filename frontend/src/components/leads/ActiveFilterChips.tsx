import { X } from "lucide-react";
import { DATE_PRESET_LABELS } from "./filters/DateRangeSection";
import type { LeadFiltersValue } from "./FiltersDrawer";
import type { AssignableUser } from "../../hooks/useAssignableUsers";
import type { Team } from "../../types";

interface Chip {
  key: string;
  label: string;
  onRemove: () => void;
}

function buildChips(
  filters: LeadFiltersValue,
  users: AssignableUser[],
  teams: Team[],
  onChange: (next: LeadFiltersValue) => void,
): Chip[] {
  const chips: Chip[] = [];

  for (const stage of filters.stages) {
    chips.push({
      key: `stage-${stage}`,
      label: stage.replace(/_/g, " "),
      onRemove: () =>
        onChange({ ...filters, stages: filters.stages.filter((s) => s !== stage) }),
    });
  }
  for (const source of filters.sources) {
    chips.push({
      key: `source-${source}`,
      label: source.replace(/_/g, " "),
      onRemove: () =>
        onChange({ ...filters, sources: filters.sources.filter((s) => s !== source) }),
    });
  }
  for (const id of filters.assignedToIds) {
    const name = users.find((u) => u.id === id)?.name ?? id;
    chips.push({
      key: `owner-${id}`,
      label: name,
      onRemove: () =>
        onChange({
          ...filters,
          assignedToIds: filters.assignedToIds.filter((a) => a !== id),
        }),
    });
  }
  for (const id of filters.teamIds) {
    const name = teams.find((t) => t.id === id)?.name ?? id;
    chips.push({
      key: `team-${id}`,
      label: name,
      onRemove: () =>
        onChange({ ...filters, teamIds: filters.teamIds.filter((t) => t !== id) }),
    });
  }
  for (const city of filters.cities) {
    chips.push({
      key: `city-${city}`,
      label: city,
      onRemove: () =>
        onChange({ ...filters, cities: filters.cities.filter((c) => c !== city) }),
    });
  }
  for (const course of filters.courses) {
    chips.push({
      key: `course-${course}`,
      label: course,
      onRemove: () =>
        onChange({ ...filters, courses: filters.courses.filter((c) => c !== course) }),
    });
  }
  if (filters.scoreMin !== undefined || filters.scoreMax !== undefined) {
    chips.push({
      key: "score",
      label: `Score ${filters.scoreMin ?? 0}–${filters.scoreMax ?? 100}`,
      onRemove: () => onChange({ ...filters, scoreMin: undefined, scoreMax: undefined }),
    });
  }
  if (filters.datePreset || filters.createdAfter || filters.createdBefore) {
    chips.push({
      key: "date",
      label: filters.datePreset
        ? DATE_PRESET_LABELS[filters.datePreset]
        : filters.dateField === "created"
          ? "Created in range"
          : filters.dateField === "updated"
            ? "Updated in range"
            : "Custom date range",
      onRemove: () =>
        onChange({
          ...filters,
          datePreset: null,
          createdAfter: "",
          createdBefore: "",
          dateField: undefined,
        }),
    });
  }
  if (filters.hotOnly) {
    chips.push({
      key: "hot",
      label: "Hot leads only",
      onRemove: () => onChange({ ...filters, hotOnly: false }),
    });
  }
  if (filters.unassigned) {
    chips.push({
      key: "unassigned",
      label: "Unassigned only",
      onRemove: () => onChange({ ...filters, unassigned: false }),
    });
  }
  if (filters.notEngaged) {
    chips.push({
      key: "notEngaged",
      label: "Not engaged",
      onRemove: () => onChange({ ...filters, notEngaged: false }),
    });
  }
  if (filters.untouched) {
    chips.push({
      key: "untouched",
      label: "Untouched",
      onRemove: () => onChange({ ...filters, untouched: false }),
    });
  }
  if (filters.followupOverdue) {
    chips.push({
      key: "followupOverdue",
      label: "Followup overdue",
      onRemove: () => onChange({ ...filters, followupOverdue: false }),
    });
  }
  if (filters.leaking) {
    chips.push({
      key: "leaking",
      label: "Leaking",
      onRemove: () => onChange({ ...filters, leaking: false }),
    });
  }
  if (filters.commsAfter || filters.commsBefore) {
    chips.push({
      key: "comms",
      label: "Contacted in range",
      onRemove: () => onChange({ ...filters, commsAfter: "", commsBefore: "" }),
    });
  }
  if (filters.pendingFollowup) {
    chips.push({
      key: "pendingFollowup",
      label: "Pending follow-up",
      onRemove: () => onChange({ ...filters, pendingFollowup: false }),
    });
  }
  if (filters.idle) {
    chips.push({
      key: "idle",
      label: "Idle 24h+",
      onRemove: () => onChange({ ...filters, idle: false }),
    });
  }

  return chips;
}

interface ActiveFilterChipsProps {
  filters: LeadFiltersValue;
  users: AssignableUser[];
  teams: Team[];
  onChange: (next: LeadFiltersValue) => void;
  onClearAll: () => void;
}

export function ActiveFilterChips({
  filters,
  users,
  teams,
  onChange,
  onClearAll,
}: ActiveFilterChipsProps) {
  const chips = buildChips(filters, users, teams, onChange);
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            className="rounded-full hover:bg-primary/20 p-0.5 max-[767px]:p-2 max-[767px]:-my-1"
            aria-label={`Remove ${chip.label} filter`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1 max-[767px]:py-2.5"
      >
        Clear all
      </button>
    </div>
  );
}
