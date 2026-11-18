import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "../ui/sheet";
import { Button } from "../ui/button";
import { useLeadFilterFacets } from "../../hooks/useLeadFilterFacets";
import { useAssignableUsers } from "../../hooks/useAssignableUsers";
import { useTeams } from "../../hooks/useTeams";
import { useSavedViews } from "../../hooks/useSavedViews";
import { useAuth } from "../../context/AuthContext";
import { DateRangeSection, type DatePreset } from "./filters/DateRangeSection";
import { SavedViewsRow } from "./filters/SavedViewsRow";
import { StageFilterChips } from "./filters/StageFilterChips";
import { SourceFilterList } from "./filters/SourceFilterList";
import { OwnerFilterList } from "./filters/OwnerFilterList";
import { TeamFilterList } from "./filters/TeamFilterList";
import { CourseFilterList } from "./filters/CourseFilterList";
import { CityFilterList } from "./filters/CityFilterList";
import { ScoreRangeSlider } from "./filters/ScoreRangeSlider";

export interface LeadFiltersValue {
  stages: string[];
  sources: string[];
  assignedToIds: string[];
  teamIds: string[];
  cities: string[];
  courses: string[];
  scoreMin?: number;
  scoreMax?: number;
  datePreset: DatePreset | null;
  createdAfter: string;
  createdBefore: string;
  // Which timestamp the range applies to. Undefined = created OR updated. Only set by
  // Reports/Dashboard deep links so the list matches the card's own definition; picking a
  // range in the drawer clears it.
  dateField?: "created" | "updated";
  hotOnly: boolean;
  unassigned: boolean;
  // Quick filters mirroring Reports > Sales Rep Productivity metrics — deep-link
  // only, no drawer UI, same treatment as `unassigned` above.
  notEngaged: boolean;
  untouched: boolean;
  followupOverdue: boolean;
  leaking: boolean;
  // Quick filters mirroring Reports > Daily Report KPI cards — deep-link only.
  commsAfter: string;
  commsBefore: string;
  pendingFollowup: boolean;
  // Saved-view-only quick filter (Leads > Filters drawer > Saved views > "Idle 24h+")
  // — no dedicated toggle in the drawer, same treatment as the Reports deep-links above.
  idle: boolean;
}

export function emptyLeadFilters(): LeadFiltersValue {
  return {
    stages: [],
    sources: [],
    assignedToIds: [],
    teamIds: [],
    cities: [],
    courses: [],
    scoreMin: undefined,
    scoreMax: undefined,
    datePreset: null,
    createdAfter: "",
    createdBefore: "",
    hotOnly: false,
    unassigned: false,
    notEngaged: false,
    untouched: false,
    followupOverdue: false,
    leaking: false,
    commsAfter: "",
    commsBefore: "",
    pendingFollowup: false,
    idle: false,
  };
}

interface FiltersDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: LeadFiltersValue;
  onChange: (next: LeadFiltersValue) => void;
  resultCount: number;
}

export function FiltersDrawer({
  open,
  onOpenChange,
  value,
  onChange,
  resultCount,
}: FiltersDrawerProps) {
  const { user } = useAuth();
  const { facets } = useLeadFilterFacets();
  const { users } = useAssignableUsers();
  const { teams } = useTeams();
  const { views, saveView, deleteView } = useSavedViews();
  const isRep = user?.role === "SALES_REP";
  // Team filter mirrors the backend: only DIRECTOR can filter across teams —
  // MANAGER/SALES_REP are already scoped to their own team/leads.
  const isDirector = user?.role === "DIRECTOR";

  // Edits stay local until Apply is clicked — selecting a chip/checkbox must
  // not hit the API on every click. Re-sync the draft to the currently applied
  // filters each time the drawer opens, discarding any unapplied edits from a
  // previous session (closing via X / overlay / Esc never applies).
  const [draft, setDraft] = useState<LeadFiltersValue>(value);
  useEffect(() => {
    if (open) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Stage/Owner/City are dropdown triggers, not always-expanded lists — only
  // one panel may be open at a time, mirroring a native <select>.
  const [openDropdown, setOpenDropdown] = useState<"stage" | "owner" | "city" | null>(null);
  useEffect(() => {
    if (!open) setOpenDropdown(null);
  }, [open]);

  const patch = (partial: Partial<LeadFiltersValue>) =>
    setDraft((prev) => ({ ...prev, ...partial }));

  const handleSaveCurrent = () => {
    const name = window.prompt("Name this view");
    if (name?.trim()) saveView(name.trim(), draft as unknown as Record<string, unknown>);
  };

  const handleDeleteView = (id: string) => {
    const name = views.find((v) => v.id === id)?.name ?? "this view";
    if (window.confirm(`Delete saved view "${name}"?`)) deleteView(id);
  };

  const handleApplySavedView =(filters: Record<string, unknown>) => {
    const next = { ...emptyLeadFilters(), ...filters } as LeadFiltersValue;
    setDraft(next);
    onChange(next);
    onOpenChange(false);
  };

  const handleApply = () => {
    onChange(draft);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] p-0">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <DateRangeSection
            preset={draft.datePreset}
            createdAfter={draft.createdAfter}
            createdBefore={draft.createdBefore}
            onChange={({ preset, createdAfter, createdBefore }) =>
              patch({ datePreset: preset, createdAfter, createdBefore, dateField: undefined })
            }
          />

          <SavedViewsRow
            views={views}
            activeFilters={value as unknown as Record<string, unknown>}
            onApply={handleApplySavedView}
            onSaveCurrent={handleSaveCurrent}
            onDelete={handleDeleteView}
          />

          {facets && (
            <StageFilterChips
              facets={facets.stages}
              value={draft.stages}
              onChange={(stages) => patch({ stages })}
              open={openDropdown === "stage"}
              onToggle={() => setOpenDropdown((prev) => (prev === "stage" ? null : "stage"))}
              onClose={() => setOpenDropdown((prev) => (prev === "stage" ? null : prev))}
            />
          )}

          {facets && (
            <SourceFilterList
              facets={facets.sources}
              value={draft.sources}
              onChange={(sources) => patch({ sources })}
            />
          )}

          {!isRep && (
            <OwnerFilterList
              users={users}
              value={draft.assignedToIds}
              onChange={(assignedToIds) => patch({ assignedToIds })}
              open={openDropdown === "owner"}
              onToggle={() => setOpenDropdown((prev) => (prev === "owner" ? null : "owner"))}
              onClose={() => setOpenDropdown((prev) => (prev === "owner" ? null : prev))}
            />
          )}

          {isDirector && (
            <TeamFilterList
              teams={teams}
              value={draft.teamIds}
              onChange={(teamIds) => patch({ teamIds })}
            />
          )}

          {facets && (
            <CourseFilterList
              courses={facets.courses}
              value={draft.courses}
              onChange={(courses) => patch({ courses })}
            />
          )}

          {facets && (
            <CityFilterList
              cities={facets.cities}
              value={draft.cities}
              onChange={(cities) => patch({ cities })}
              open={openDropdown === "city"}
              onToggle={() => setOpenDropdown((prev) => (prev === "city" ? null : "city"))}
              onClose={() => setOpenDropdown((prev) => (prev === "city" ? null : prev))}
            />
          )}

          <ScoreRangeSlider
            min={draft.scoreMin ?? 0}
            max={draft.scoreMax ?? 100}
            onChange={(scoreMin, scoreMax) => patch({ scoreMin, scoreMax })}
          />

          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Tags</p>
            <label className="flex items-center justify-between py-1.5 cursor-pointer">
              <span className="text-xs text-foreground">Hot leads only</span>
              <input
                type="checkbox"
                checked={draft.hotOnly}
                onChange={(e) => patch({ hotOnly: e.target.checked })}
                className="accent-primary w-3.5 h-3.5"
              />
            </label>
            {!isRep && (
              <label className="flex items-center justify-between py-1.5 cursor-pointer">
                <span className="text-xs text-foreground">Unassigned only</span>
                <input
                  type="checkbox"
                  checked={draft.unassigned}
                  onChange={(e) => patch({ unassigned: e.target.checked })}
                  className="accent-primary w-3.5 h-3.5"
                />
              </label>
            )}
          </div>
        </div>
        <SheetFooter>
          <span className="text-xs text-muted-foreground">
            Showing {resultCount} leads
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const cleared = emptyLeadFilters();
                setDraft(cleared);
                onChange(cleared);
                onOpenChange(false);
              }}
            >
              Clear all
            </Button>
            <Button size="sm" onClick={handleApply}>
              Apply
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
