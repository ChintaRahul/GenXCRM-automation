import { useEffect, useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "../ui/sheet";
import { Button } from "../ui/button";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Switch } from "../ui/switch";
import { FilterSectionHeader } from "../filters/FilterSectionHeader";
import { MultiSelectDropdown } from "../filters/MultiSelectDropdown";
import { SearchableFilterList, type FilterListItem } from "../filters/SearchableFilterList";
import { DateRangeSelect } from "../filters/DateRangeSelect";
import { NumberRangeInputs } from "../filters/NumberRangeInputs";
import { SavedViewsPicker, type ViewChip } from "../filters/SavedViewsPicker";
import {
  TONE_DOT,
  dateFieldOf,
  facetFieldsOf,
  hasSla,
  valueFieldOf,
  type ModuleFilters,
} from "../../lib/moduleFilters";
import { cn, initials } from "../../lib/utils";
import { useAuth } from "../../context/AuthContext";
import { useViewportMode } from "../../hooks/useViewportMode";
import type { ModuleFacets } from "../../api/modules";
import type { ModuleDef } from "../../modules/registry";

interface FiltersSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly moduleDef: ModuleDef;
  readonly facets: ModuleFacets;
  readonly filters: ModuleFilters;
  readonly onChange: (next: ModuleFilters) => void;
  readonly onClearAll: () => void;
  // Records matching the current filters.
  readonly resultCount: number;
  readonly views: readonly ViewChip[];
  readonly onSaveView: (name: string) => void;
}

// A bordered block holding one filter section, as in the design.
const Block = ({ children }: { children: ReactNode }) => (
  <section className="rounded-lg border border-card-border p-3">{children}</section>
);

const QuickView = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    className={cn(
      "h-8 max-[767px]:h-11 px-3 rounded-full text-xs font-medium border",
      active ? "bg-foreground text-background border-foreground" : "bg-background border-border",
    )}
  >
    {label}
  </button>
);

// Few options stay expanded; long lists collapse into a dropdown (with search when very long).
const EXPANDED_MAX = 5;
const SEARCHABLE_MIN = 8;

export function FiltersSheet({
  open,
  onOpenChange,
  moduleDef,
  facets,
  filters,
  onChange,
  onClearAll,
  resultCount,
  views,
  onSaveView,
}: FiltersSheetProps) {
  const { user } = useAuth();
  // Phones get a bottom sheet; everything else a right-hand panel.
  const bottom = useViewportMode() === "drawer";
  // Only one dropdown is open at a time.
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  useEffect(() => {
    if (!open) setOpenDropdown(null);
  }, [open]);

  const patch = (partial: Partial<ModuleFilters>) => onChange({ ...filters, ...partial });
  const dropdown = (id: string) => ({
    open: openDropdown === id,
    onToggle: () => setOpenDropdown((cur) => (cur === id ? null : id)),
    onClose: () => setOpenDropdown((cur) => (cur === id ? null : cur)),
  });

  const { capabilities } = facets;
  const statusItems: FilterListItem[] = moduleDef.statuses.map((s) => ({
    id: s.value,
    label: s.value,
    meta: String(facets.status[s.value] ?? 0),
    dotClassName: TONE_DOT[s.tone] ?? TONE_DOT.gray,
  }));
  const ownerItems: FilterListItem[] = facets.owners.map((o) => ({
    id: o.id,
    label: o.name,
    meta: String(o.count),
    leading: (
      <Avatar className="h-5 w-5">
        <AvatarFallback className="text-[9px]">{initials(o.name)}</AvatarFallback>
      </Avatar>
    ),
  }));
  const facetFields = facetFieldsOf(moduleDef, Object.keys(facets.facets));
  const valueField = valueFieldOf(moduleDef);
  const showSla = capabilities.sla && hasSla(moduleDef);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={bottom ? "bottom" : "right"}
        className={cn(bottom ? "max-h-[88vh] rounded-t-2xl" : "w-[min(400px,92vw)] sm:max-w-none", "p-0")}
      >
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription className="sr-only">Narrow the {moduleDef.title.toLowerCase()} list.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 space-y-3">
          {(capabilities.owner || showSla) && (
            <Block>
              <FilterSectionHeader title="Quick views" uppercase />
              <div className="flex flex-wrap gap-2">
                {capabilities.owner && user && (
                  <QuickView
                    label="My records"
                    active={filters.ownerId.length === 1 && filters.ownerId[0] === user.id}
                    onClick={() => patch({ ownerId: filters.ownerId.length === 1 && filters.ownerId[0] === user.id ? [] : [user.id] })}
                  />
                )}
                {showSla && (
                  <QuickView label="SLA at risk" active={filters.slaRisk} onClick={() => patch({ slaRisk: !filters.slaRisk })} />
                )}
              </div>
            </Block>
          )}

          {capabilities.date && dateFieldOf(moduleDef) && (
            <Block>
              <DateRangeSelect value={filters.date} onChange={(date) => patch({ date })} />
            </Block>
          )}

          {views.length > 0 && (
            <Block>
              <SavedViewsPicker views={views} onSave={onSaveView} />
            </Block>
          )}

          <Block>
            <FilterSectionHeader title="Status" uppercase onReset={filters.status.length ? () => patch({ status: [] }) : undefined} />
            <div className="flex flex-wrap gap-2">
              {statusItems.map((item) => {
                const on = filters.status.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => patch({ status: on ? filters.status.filter((v) => v !== item.id) : [...filters.status, item.id] })}
                    className={cn(
                      "inline-flex items-center gap-1.5 h-8 max-[767px]:h-11 px-3 rounded-full text-xs font-medium border",
                      on ? "bg-foreground text-background border-foreground" : "bg-background border-border",
                    )}
                  >
                    <span className={cn("h-2 w-2 rounded-full", item.dotClassName)} />
                    {item.label}
                    <span className="font-mono opacity-70">{item.meta}</span>
                  </button>
                );
              })}
            </div>
          </Block>

          {capabilities.owner && ownerItems.length > 0 && (
            <Block>
              <FilterSectionHeader title="Owner" uppercase onReset={filters.ownerId.length ? () => patch({ ownerId: [] }) : undefined} />
              <SearchableFilterList
                items={ownerItems}
                value={filters.ownerId}
                onChange={(ownerId) => patch({ ownerId })}
                searchable={ownerItems.length > SEARCHABLE_MIN}
              />
            </Block>
          )}

          {facetFields.map((field) => {
            const options = field.options ?? [];
            const items: FilterListItem[] = options.map((o) => ({
              id: o,
              label: o,
              meta: String(facets.facets[field.key]?.[o] ?? 0),
            }));
            const value = filters.facets[field.key] ?? [];
            const setValue = (next: string[]) => patch({ facets: { ...filters.facets, [field.key]: next } });
            return (
              <Block key={field.key}>
                <FilterSectionHeader title={field.label} uppercase onReset={value.length ? () => setValue([]) : undefined} />
                {options.length <= EXPANDED_MAX ? (
                  <SearchableFilterList items={items} value={value} onChange={setValue} searchable={false} />
                ) : (
                  <MultiSelectDropdown
                    anyLabel={`Any ${field.label.toLowerCase()}`}
                    pluralNoun="selected"
                    items={items}
                    value={value}
                    onChange={setValue}
                    searchable={options.length > SEARCHABLE_MIN}
                    {...dropdown(`facet:${field.key}`)}
                  />
                )}
              </Block>
            );
          })}

          {capabilities.value && valueField && (
            <Block>
              <NumberRangeInputs
                title={valueField.label}
                unit="₹ lakh"
                min={filters.valueMin}
                max={filters.valueMax}
                onChange={({ min, max }) => patch({ valueMin: min, valueMax: max })}
              />
            </Block>
          )}

          {showSla && (
            <Block>
              <FilterSectionHeader title="Flags" uppercase />
              <label className="flex items-center justify-between gap-3 min-h-9 cursor-pointer">
                <span className="text-xs text-foreground">
                  SLA at risk or breached only
                  <span className="ml-1.5 font-mono text-muted-foreground/70">{facets.slaRiskCount}</span>
                </span>
                <Switch checked={filters.slaRisk} onCheckedChange={(slaRisk) => patch({ slaRisk })} aria-label="SLA at risk or breached only" />
              </label>
            </Block>
          )}
        </div>

        <SheetFooter className="flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onClearAll}>
            Clear all
          </Button>
          <Button size="sm" className="ml-auto" onClick={() => onOpenChange(false)}>
            Show {resultCount} {resultCount === 1 ? "result" : "results"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
