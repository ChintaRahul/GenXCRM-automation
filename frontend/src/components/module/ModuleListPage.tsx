import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Plus, Search, Columns3, UserCog, X } from "lucide-react";
import { Header } from "../layout/Header";
import { Input } from "../ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../ui/table";
import { Pagination } from "../ui/pagination";
import { Button } from "../ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { cn } from "../../lib/utils";
import { renderCell } from "../../lib/moduleCells";
import { useModuleList, DEFAULT_PAGE_SIZE } from "../../hooks/useModuleList";
import { useFitRows } from "../../hooks/useFitRows";
import { useColumnPrefs } from "../../hooks/useColumnPrefs";
import { useModuleFacets } from "../../hooks/useModuleFacets";
import { useModuleViews } from "../../hooks/useModuleViews";
import { useModuleExport } from "../../hooks/useModuleExport";
import { ModuleImportButton } from "./ModuleImportButton";
import { REGISTRY } from "../../modules/registry";
import type { ModuleRecord } from "../../api/modules";
import { FiltersTrigger } from "../filters/FiltersTrigger";
import { ActiveFilterStrip } from "../filters/ActiveFilterStrip";
import type { ViewChip } from "../filters/SavedViewsPicker";
import {
  builtInViews,
  describeFilters,
  emptyModuleFilters,
  sameFilters,
  type ModuleFilters,
} from "../../lib/moduleFilters";
import { ModuleBoard } from "./ModuleBoard";
import { FiltersSheet } from "./FiltersSheet";
import { ModuleCardList } from "./ModuleCardList";
import { selectedToCsv } from "../../lib/moduleCsv";
import { updateModuleRecord } from "../../api/modules";
import { useViewportMode } from "../../hooks/useViewportMode";

// Table rows are a fixed height so the number that fit the screen can be computed.
const ROW_HEIGHT = 52;
const HEADER_HEIGHT = 40;

interface ModuleListPageProps {
  moduleKey: string;
  onRowClick: (record: ModuleRecord) => void;
  onNew?: () => void;
  hasModuleAccess?: boolean;
  initialFilters?: ModuleFilters;
  restoreState?: boolean;
  // Inside another page (an Administration tab): no page header of its own and a normal page size instead of filling the screen.
  embedded?: boolean;
}

export function ModuleListPage({
  moduleKey,
  onRowClick,
  onNew,
  hasModuleAccess = true,
  initialFilters,
  restoreState,
  embedded = false,
}: ModuleListPageProps) {
  const moduleDef = REGISTRY[moduleKey];
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<"list" | "board">("list");
  const asCards = useViewportMode() === "drawer";
  // A table page holds exactly the rows that fit the screen; cards just scroll, so use a fixed page.
  const fitRows = useFitRows(bodyEl, ROW_HEIGHT, HEADER_HEIGHT);
  const pageSize =
    embedded || asCards || view === "board" ? DEFAULT_PAGE_SIZE : fitRows;
  const {
    pageSize: rowsPerPage,
    records,
    total,
    page,
    setPage,
    search,
    setSearch,
    filters,
    filterParams,
    setFilters,
    sort,
    setSort,
    loading,
    error,
    forbidden,
    refresh,
  } = useModuleList(moduleKey, initialFilters, pageSize, restoreState);
  const [searchInput, setSearchInput] = useState(search);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { visibleKeys, toggleColumn } = useColumnPrefs(
    moduleKey,
    moduleDef.cols,
  );
  const { facets } = useModuleFacets(moduleKey, search);
  const {
    views: savedViews,
    save: saveView,
    remove: removeView,
  } = useModuleViews(moduleKey);
  const { exporting, exportNow } = useModuleExport(moduleKey);
  const visibleCols = moduleDef.cols.filter((c) => visibleKeys.includes(c.key));
  const hasBoard =
    moduleDef.kanban === true || (moduleDef.flow?.length ?? 0) >= 4;
  const canReassign = moduleDef.fields.some((f) => f.key === "ownerId");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [reassigning, setReassigning] = useState(false);
  const pageIds = useMemo(() => records.map((r) => r.id), [records]);
  const allSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  // A new page / filter / search shows different rows, so any selection no longer applies.
  // Keyed on the query, not `records`: selecting a row shows the bulk bar, which resizes the table,
  // which changes the fitted page size and refetches — that must not wipe the selection.
  useEffect(
    () => setSelected(new Set()),
    [moduleKey, page, search, filterParams, sort],
  );

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(pageIds));

  async function reassignSelected(ownerId: string) {
    setReassigning(true);
    const results = await Promise.allSettled(
      [...selected].map((id) => updateModuleRecord(moduleKey, id, { ownerId })),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0)
      toast.error(`Couldn't reassign ${failed} of ${results.length}.`);
    else
      toast.success(
        `Reassigned ${results.length} ${results.length === 1 ? "record" : "records"}.`,
      );
    setReassigning(false);
    setSelected(new Set());
    refresh();
  }

  function exportSelected() {
    const blob = new Blob(
      [
        selectedToCsv(
          records.filter((r) => selected.has(r.id)),
          visibleCols,
        ),
      ],
      { type: "text/csv" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${moduleKey}-selected.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const statusCounts = facets?.status ?? {};
  const ownerName = (id: string) =>
    facets?.owners.find((o) => o.id === id)?.name ?? id;
  const entries = describeFilters(filters, ownerName);
  const clearAll = () => setFilters(emptyModuleFilters());

  async function handleSaveView(name: string) {
    try {
      await saveView(name, filters);
    } catch {
      toast.error("Couldn't save that view.");
    }
  }

  async function handleDeleteView(id: string, name: string) {
    if (!window.confirm(`Delete saved view "${name}"?`)) return;
    try {
      await removeView(id);
    } catch {
      toast.error("Couldn't delete that view.");
    }
  }

  // Built-in views combine with whatever else is set; a user's view replaces the whole filter set.
  const viewChips: ViewChip[] = facets
    ? [
        ...builtInViews(moduleDef, facets.capabilities).map((v) => {
          const active = v.isActive(filters);
          return {
            id: v.key,
            label: v.label,
            active,
            onToggle: () =>
              setFilters(active ? v.clear(filters) : v.apply(filters)),
          };
        }),
        ...savedViews.map((v) => {
          const active = sameFilters(filters, v.filters);
          return {
            id: v.id,
            label: v.name,
            active,
            onToggle: () =>
              setFilters(active ? emptyModuleFilters() : v.filters),
            onDelete: () => void handleDeleteView(v.id, v.name),
          };
        }),
      ]
    : [];

  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
  // The table scrolls inside its own box (header pinned); every other body just scrolls.
  const showsTable =
    view === "list" &&
    !asCards &&
    !forbidden &&
    !error &&
    (loading || records.length > 0);

  if (moduleDef.restricted && !hasModuleAccess) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          {moduleDef.title} is restricted.
        </div>
      </div>
    );
  }

  const headerActions = (
    <>
      {view === "list" && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              aria-label="Choose columns"
              className="max-[767px]:min-w-11 shrink-0"
            >
              <Columns3 className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56">
            <div className="space-y-1">
              {moduleDef.cols.map((col) => (
                <label
                  key={col.key}
                  className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-muted cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={visibleKeys.includes(col.key)}
                    onChange={() => toggleColumn(col.key)}
                  />
                  {col.label}
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={exporting}
        onClick={() =>
          void exportNow({
            page: 1,
            limit: total || rowsPerPage,
            search: search || undefined,
            sort: sort || undefined,
            ...filterParams,
          })
        }
      >
        <Download className="w-4 h-4 mr-1.5" /> Export
      </Button>
      {moduleDef.importable && onNew && !asCards && <ModuleImportButton moduleKey={moduleKey} onImported={refresh} />}
      {!moduleDef.noCreate && onNew && !asCards && (
        <Button size="sm" data-tour="new" onClick={onNew}>
          <Plus className="w-4 h-4 mr-1.5" /> New {moduleDef.singular}
        </Button>
      )}
    </>
  );

  return (
    <div className={cn("flex flex-col", !embedded && "h-full")}>
      {embedded ? (
        <div className="flex flex-wrap items-center justify-end gap-2 pb-3">
          {headerActions}
        </div>
      ) : (
        <Header
          title={moduleDef.title}
          subtitle={moduleDef.desc}
          actions={headerActions}
          tourId="list-header"
        />
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 bg-background px-[clamp(14px,3.5vw,24px)] pt-3 pb-2 space-y-3 border-b border-border">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            {
              <div className="relative max-w-[360px] flex-1 min-w-[160px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={`Search ${moduleDef.title.toLowerCase()}…`}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-9"
                />
              </div>
            }
            {facets && (
              <FiltersTrigger
                count={entries.length}
                onClick={() => setFiltersOpen(true)}
              />
            )}
            {hasBoard && (
              <div data-tour="views" className="flex items-center rounded-md border border-input overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setView("list")}
                  className={cn(
                    "px-3 h-8 max-[767px]:h-11",
                    view === "list"
                      ? "bg-foreground text-background"
                      : "bg-background",
                  )}
                >
                  List
                </button>
                <button
                  type="button"
                  onClick={() => setView("board")}
                  className={cn(
                    "px-3 h-8 max-[767px]:h-11",
                    view === "board"
                      ? "bg-foreground text-background"
                      : "bg-background",
                  )}
                >
                  Board
                </button>
              </div>
            )}
            <span
              className="text-xs text-muted-foreground ml-auto rounded-full bg-muted px-2 py-0.5"
              data-testid="count-chip"
            >
              {records.length} of {total}
            </span>
          </div>

          {
            <ActiveFilterStrip
              chips={entries.map((e) => ({
                key: e.key,
                label: e.label,
                onRemove: () => setFilters(e.remove(filters)),
              }))}
              onClearAll={clearAll}
            />
          }

          {view === "list" && (
            <div data-tour="chips" className="flex items-center gap-2 overflow-x-auto sm:flex-wrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={() => setFilters({ ...filters, status: [] })}
                className={cn(
                  "h-7 px-3 rounded-full text-xs font-medium border shrink-0 max-[767px]:h-11",
                  filters.status.length === 0
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background border-border",
                )}
              >
                All
              </button>
              {moduleDef.statuses.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setFilters({ ...filters, status: [s.value] })}
                  className={cn(
                    "h-7 px-3 rounded-full text-xs font-medium border shrink-0 max-[767px]:h-11",
                    filters.status.length === 1 && filters.status[0] === s.value
                      ? "bg-foreground text-background border-foreground"
                      : "bg-background border-border",
                  )}
                >
                  {s.value}
                  {facets ? ` (${statusCounts[s.value] ?? 0})` : ""}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col gap-3 px-[clamp(14px,3.5vw,24px)] pt-3">
          {selected.size > 0 && !asCards && (
            <div
              role="region"
              aria-label="Bulk actions"
              className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm"
            >
              <span className="font-medium">{selected.size} selected</span>
              {canReassign && facets && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" disabled={reassigning}>
                      <UserCog className="w-4 h-4 mr-1.5" /> Reassign
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 max-h-[300px] overflow-y-auto">
                    {facets.owners.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        title={o.name}
                        onClick={() => void reassignSelected(o.id)}
                        className="block w-full truncate text-left text-sm px-2 py-1.5 rounded hover:bg-muted"
                      >
                        {o.name}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
              <Button variant="outline" size="sm" onClick={exportSelected}>
                <Download className="w-4 h-4 mr-1.5" /> Export
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setSelected(new Set())}
              >
                <X className="w-4 h-4 mr-1" /> Clear
              </Button>
            </div>
          )}

          <div
            ref={setBodyEl}
            data-tour="records"
            className={cn("min-h-0 flex-1", !showsTable && "overflow-y-auto")}
          >
            {view === "board" ? (
              <ModuleBoard
                moduleKey={moduleKey}
                onRowClick={onRowClick}
                search={search}
                filterParams={filterParams}
              />
            ) : forbidden ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                You don&apos;t have access to {moduleDef.title.toLowerCase()}.
                Ask your admin if you need it.
              </p>
            ) : error ? (
              <p className="text-sm text-destructive py-8 text-center">
                Couldn&apos;t load {moduleDef.title.toLowerCase()}.
              </p>
            ) : !loading && records.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {search || Object.values(filterParams).some((v) => v !== undefined)
                  ? `No ${moduleDef.title.toLowerCase()} match these filters.`
                  : `No ${moduleDef.title.toLowerCase()} yet.`}
              </p>
            ) : asCards ? (
              <ModuleCardList
                records={records}
                columns={visibleCols}
                moduleDef={moduleDef}
                onRowClick={onRowClick}
              />
            ) : (
              <Table wrapperClassName="max-h-full overflow-y-hidden">
                <TableHeader className="bg-muted">
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={allSelected}
                        onChange={toggleAll}
                      />
                    </TableHead>
                    {visibleCols.map((col) => (
                      <TableHead
                        key={col.key}
                        onClick={() => setSort(col.key)}
                        className={cn(
                          "cursor-pointer select-none",
                          col.type === "money" && "text-right",
                        )}
                      >
                        {col.label}
                        {sort === col.key && " ▲"}
                        {sort === `-${col.key}` && " ▼"}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((record) => (
                    <TableRow
                      key={record.id}
                      className="h-[52px] cursor-pointer"
                      onClick={() => onRowClick(record)}
                    >
                      <TableCell
                        className="w-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select ${String(record[moduleDef.label ?? "id"] ?? record.id)}`}
                          checked={selected.has(record.id)}
                          onChange={() => toggleRow(record.id)}
                        />
                      </TableCell>
                      {visibleCols.map((col) => (
                        <TableCell
                          key={col.key}
                          className="py-1.5 whitespace-nowrap max-w-[260px] overflow-hidden text-ellipsis"
                          title={typeof record[col.key] === "string" ? String(record[col.key]) : undefined}
                        >
                          {renderCell(col, record, moduleDef)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
        {view === "list" && (
          <div className="shrink-0 border-t border-border bg-background px-[clamp(14px,3.5vw,24px)] pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      {asCards && !moduleDef.noCreate && onNew && (
        <Button
          size="icon"
          aria-label={`New ${moduleDef.singular ?? "record"}`}
          data-tour="new"
          onClick={onNew}
          className={cn(
            "fixed right-4 z-30 h-14 w-14 rounded-full shadow-lg",
            view === "list"
              ? "bottom-[calc(env(safe-area-inset-bottom)+5rem)]"
              : "bottom-[max(1rem,env(safe-area-inset-bottom))]",
          )}
        >
          <Plus className="w-6 h-6" />
        </Button>
      )}

      {facets && (
        <FiltersSheet
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          moduleDef={moduleDef}
          facets={facets}
          filters={filters}
          onChange={setFilters}
          onClearAll={clearAll}
          resultCount={total}
          views={viewChips}
          onSaveView={(name) => void handleSaveView(name)}
        />
      )}
    </div>
  );
}
