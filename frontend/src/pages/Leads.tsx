import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useNavigate, useNavigationType, useSearchParams } from "react-router-dom";
import {
  getLeads,
  createLead,
  updateLead,
  reassignLead,
  distributeLeadsRoundRobin,
  autoAssignAllLeads,
  archiveLead,
  archiveLeads,
  archiveAllLeads,
} from "../api/client";
import type { Lead, LeadStage, LeadSource } from "../types";
import { useAuth } from "../context/AuthContext";
import { useLeadStats } from "../context/LeadStatsContext";
import { useNotifications } from "../context/NotificationsContext";
import { useAssignableUsers } from "../hooks/useAssignableUsers";
import { useTeams } from "../hooks/useTeams";
import { useFieldMappings } from "../hooks/useFieldMappings";
import { useCallAlert } from "../hooks/useCallAlert";
import { isNative } from "../lib/platform";
import { Header } from "../components/layout/Header";
import { StatusBadge, statusLabel } from "../components/shared/StatusBadge";
import { WhatsAppIcon } from "../components/shared/WhatsAppIcon";
import { EmptyState } from "../components/shared/EmptyState";
import { StageChipFilter } from "../components/leads/StageChipFilter";
import { BulkActionBar } from "../components/leads/BulkActionBar";
import { StageCell } from "../components/leads/StageCell";
import { OwnerCell } from "../components/leads/OwnerCell";
import { ImportWizardModal } from "../components/leads/ImportWizardModal";
import { Pagination } from "../components/ui/pagination";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Skeleton } from "../components/ui/skeleton";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Tooltip, TooltipTrigger, TooltipContent } from "../components/ui/tooltip";
import {
  Plus,
  Search,
  Flame,
  Phone,
  Mail,
  Users,
  Shuffle,
  Trash2,
  Archive,
  Upload,
  Target,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { ScoreBar } from "../components/leads/ScoreBar";
import { FiltersButton } from "../components/leads/FiltersButton";
import {
  FiltersDrawer,
  emptyLeadFilters,
  type LeadFiltersValue,
} from "../components/leads/FiltersDrawer";
import { ActiveFilterChips } from "../components/leads/ActiveFilterChips";
import { toast } from "sonner";
import { cn, formatDateTime, startOfMonthISO } from "../lib/utils";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import { leadsToCSV } from "../lib/format";
import { saveFile } from "../lib/platform";

const SOURCES: LeadSource[] = [
  "FACEBOOK",
  "GOOGLE_ADS",
  "WEBSITE",
  "INSTAGRAM",
  "WALK_IN",
  "REFERRAL",
  "OUTBOUND_CALL",
  "CHAT",
  "API",
  "OTHER",
];

const EMPTY_LEAD_FORM = {
  name: "",
  phone: "",
  email: "",
  course: "",
  location: "",
  source: "WEBSITE" as LeadSource,
};

function getNameError(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return Messages.leads.nameRequired;
  if (trimmed.length > 100) return Messages.leads.nameTooLong;
  return "";
}

function getPhoneError(phone: string): string {
  return phone.replace(/\D/g, "").length !== 10 ? Messages.leads.invalidPhone : "";
}

// Catches syntactically-"valid" but nonsensical addresses like "a@b.com.com.com" —
// they pass the basic @+dot check but repeat the same domain label consecutively.
function hasRepeatedDomainLabel(email: string): boolean {
  const at = email.indexOf("@");
  if (at === -1) return false;
  const labels = email.slice(at + 1).toLowerCase().split(".");
  return labels.some((label, i) => i > 0 && label !== "" && label === labels[i - 1]);
}

function getEmailError(email: string): string {
  if (!email) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Messages.leads.invalidEmail;
  return hasRepeatedDomainLabel(email) ? Messages.leads.invalidEmail : "";
}

interface ListColumn {
  label: string;
  sortKey?: string;
  cellClass: string;
  cell: (lead: Lead) => React.ReactNode;
}

interface LeadsListState {
  page: number;
  limit: number;
  search: string;
  searchInput: string;
  filters: LeadFiltersValue;
  sort: { by: string; dir: "asc" | "desc" } | null;
  scrollTop: number;
}

// Module-level (outside the component) so it survives a full unmount/remount of
// LeadsPage — React Router unmounts this page entirely when navigating to
// /leads/:id, so any of this state kept in plain component `useState` resets to
// its defaults the moment the rep clicks Back, dropping their filters, sort,
// page, and scroll position (SCRUM-59, SCRUM-62). A plain module variable is
// the simplest fix that survives the round trip: it only needs to live for the
// current SPA session, not across a hard reload, so sessionStorage/URL params
// would be more machinery than this needs.
let leadsListStateCache: LeadsListState | null = null;

export default function LeadsPage() {
  const { user } = useAuth();
  const { refresh: refreshStats } = useLeadStats();
  const { newLeadVersion } = useNotifications();
  const { users } = useAssignableUsers();
  const { teams } = useTeams();
  const { mapping: fieldMapping } = useFieldMappings();
  // Name/phone/email are the fixed first column; every other column follows the order saved
  // in Administration > Field Mapping. Custom values are keyed by the definition's stable id
  // (not its display name) so a rename never orphans data.
  const textCell = (val: string) => (
    <span className="block truncate text-xs text-muted-foreground" title={val || undefined}>
      {val || "—"}
    </span>
  );
  const columnDefs: Record<string, ListColumn> = {
    stage: {
      label: "Stage",
      sortKey: "stage",
      cellClass: "px-4 py-3 whitespace-nowrap",
      cell: (lead) => <StageCell value={lead.stage} onChange={(st) => void changeStage(lead.id, st)} />,
    },
    source: {
      label: "Source",
      sortKey: "source",
      cellClass: "px-4 py-3 whitespace-nowrap",
      cell: (lead) => <StatusBadge status={lead.source} />,
    },
    score: {
      label: "Score",
      sortKey: "score",
      cellClass: "px-4 py-3",
      cell: (lead) => <ScoreBar score={lead.score} />,
    },
    owner: {
      label: "Owner",
      sortKey: "owner",
      cellClass: "px-4 py-3 whitespace-nowrap",
      cell: (lead) => (
        <OwnerCell
          value={lead.assignedTo ?? null}
          onChange={(uid) => void changeOwner(lead.id, uid)}
          users={users}
          readonly={user?.role === "SALES_REP" && lead.assignedTo?.id !== user.id}
        />
      ),
    },
    createdAt: {
      label: "Created",
      sortKey: "createdAt",
      cellClass: "px-4 py-3 whitespace-nowrap",
      cell: (lead) => <span className="text-xs text-muted-foreground">{formatDateTime(lead.createdAt)}</span>,
    },
    altPhone: { label: "Alt phone", cellClass: "px-4 py-3 max-w-[180px]", cell: (l) => textCell(l.altPhone ?? "") },
    altEmail: { label: "Alt email", cellClass: "px-4 py-3 max-w-[180px]", cell: (l) => textCell(l.altEmail ?? "") },
    course: { label: "Course", cellClass: "px-4 py-3 max-w-[180px]", cell: (l) => textCell(l.course ?? "") },
    location: { label: "Location", cellClass: "px-4 py-3 max-w-[180px]", cell: (l) => textCell(l.location ?? "") },
    language: { label: "Language", cellClass: "px-4 py-3 max-w-[180px]", cell: (l) => textCell(l.language ?? "") },
    tags: { label: "Tags", cellClass: "px-4 py-3 max-w-[180px]", cell: (l) => textCell(l.tags.join(", ")) },
  };
  const customDefs = fieldMapping?.customFieldDefs.filter((f) => f.name.trim()) ?? [];
  for (const def of customDefs) {
    columnDefs[def.id] = {
      label: def.name,
      cellClass: "px-4 py-3 max-w-[180px]",
      cell: (l) => textCell(l.customFields?.[def.id] ?? ""),
    };
  }
  const columnOrder = fieldMapping?.fieldOrder ?? [...Object.keys(columnDefs)];
  const listColumns = [
    ...columnOrder.filter((k) => Object.hasOwn(columnDefs, k)),
    ...Object.keys(columnDefs).filter((k) => !columnOrder.includes(k)),
  ].map((key) => ({ key, ...columnDefs[key] }));
  const { triggerCallAlert } = useCallAlert();
  const [fallbackCall, setFallbackCall] = useState<{ name: string; phone: string } | null>(null);
  const handleCallClick = useCallback(
    async (e: React.MouseEvent, lead: { id: string; name: string; phone: string }) => {
      if (isNative()) return; // let the plain tel: href handle it, as today
      e.preventDefault();
      const result = await triggerCallAlert(lead.id);
      if (!result || !result.delivered) {
        setFallbackCall({ name: lead.name, phone: result?.phone ?? lead.phone });
      }
    },
    [triggerCallAlert],
  );
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  // Snapshot the cross-mount cache once, synchronously, so every lazy `useState`
  // initializer below sees the same values (the module var could otherwise be
  // overwritten by this same mount's own unmount-cleanup before some of these
  // run — that can't happen with a stable local snapshot).
  // Only a Back/Forward (POP) navigation restores the previous filters. A fresh visit
  // (sidebar link, Reports/Dashboard card = PUSH) must start clean — otherwise stale filters
  // from an earlier session of this page leak into it.
  const navigationType = useNavigationType();
  const cachedListState = useRef(navigationType === "POP" ? leadsListStateCache : null).current;
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredScrollRef = useRef(false);
  const [page, setPage] = useState(() => {
    const v = Number(searchParams.get("page"));
    if (Number.isFinite(v) && v > 0) return v;
    return cachedListState?.page ?? 1;
  });
  const [limit, setLimit] = useState(() => cachedListState?.limit ?? 20);
  const [searchInput, setSearchInput] = useState(() => cachedListState?.searchInput ?? "");
  const [search, setSearch] = useState(() => cachedListState?.search ?? "");
  // Seed synchronously from the URL (e.g. Dashboard KPI deep links like
  // /leads?createdAfter=...) so the first `load()` call already carries the
  // filter — otherwise it fires an unfiltered fetch that can race with, and
  // overwrite, the filtered one applied by the effect below. Falls back to the
  // cached filters (restored after a round trip to lead detail — SCRUM-59)
  // before finally defaulting, so a real deep link still always wins.
  const [stages, setStages] = useState<string[]>(() => {
    const v = searchParams.get("stage");
    return v ? [v] : (cachedListState?.filters.stages ?? []);
  });
  const [sources, setSources] = useState<string[]>(() => {
    const v = searchParams.get("source");
    return v ? [v] : (cachedListState?.filters.sources ?? []);
  });
  const [unassigned, setUnassigned] = useState(() => {
    const v = searchParams.get("unassigned");
    if (v) return v === "1" || v === "true";
    return cachedListState?.filters.unassigned ?? false;
  });
  // Default to Month-to-Date when arriving without a date filter of our own
  // (e.g. a Dashboard deep link like /leads?createdAfter=... always wins).
  const [createdAfter, setCreatedAfter] = useState(() => {
    const v = searchParams.get("createdAfter");
    if (v) return v;
    // Dashboard "Total leads" (all-time count) deep-links with datePreset=all.
    if (searchParams.get("datePreset") === "all") return "";
    return cachedListState?.filters.createdAfter ?? startOfMonthISO();
  });
  // Net-new filter facets (Filters drawer) — additive alongside the existing
  // single-value stage/source/unassigned/createdAfter state above.
  const [assignedToIds, setAssignedToIds] = useState<string[]>(
    () => cachedListState?.filters.assignedToIds ?? [],
  );
  const [teamIds, setTeamIds] = useState<string[]>(() => cachedListState?.filters.teamIds ?? []);
  const [cities, setCities] = useState<string[]>(() => cachedListState?.filters.cities ?? []);
  const [courses, setCourses] = useState<string[]>(() => cachedListState?.filters.courses ?? []);
  const [scoreMin, setScoreMin] = useState<number | undefined>(
    () => cachedListState?.filters.scoreMin,
  );
  const [scoreMax, setScoreMax] = useState<number | undefined>(
    () => cachedListState?.filters.scoreMax,
  );
  // `null` is a meaningful cached value (custom/deep-linked range), so don't use `??` here —
  // it would turn it back into "mtd" and label a report's custom range as MTD after Back.
  const [datePreset, setDatePreset] = useState<LeadFiltersValue["datePreset"]>(() => {
    if (searchParams.get("createdAfter")) return null;
    if (searchParams.get("datePreset") === "all") return "all";
    return cachedListState ? cachedListState.filters.datePreset : "mtd";
  });
  const [createdBefore, setCreatedBefore] = useState(
    () => searchParams.get("createdBefore") ?? cachedListState?.filters.createdBefore ?? "",
  );
  const [dateField, setDateField] = useState<LeadFiltersValue["dateField"]>(() => {
    const v = searchParams.get("dateField");
    if (v === "created" || v === "updated") return v;
    return cachedListState?.filters.dateField;
  });
  const [hotOnly, setHotOnly] = useState(() => cachedListState?.filters.hotOnly ?? false);
  // Quick filters deep-linked from Reports > Sales Rep Productivity
  const [notEngaged, setNotEngaged] = useState(() => cachedListState?.filters.notEngaged ?? false);
  const [untouched, setUntouched] = useState(() => cachedListState?.filters.untouched ?? false);
  const [followupOverdue, setFollowupOverdue] = useState(
    () => cachedListState?.filters.followupOverdue ?? false,
  );
  const [leaking, setLeaking] = useState(() => cachedListState?.filters.leaking ?? false);
  // Quick filters deep-linked from Reports > Daily Report KPI cards
  const [commsAfter, setCommsAfter] = useState(() => cachedListState?.filters.commsAfter ?? "");
  const [commsBefore, setCommsBefore] = useState(() => cachedListState?.filters.commsBefore ?? "");
  const [pendingFollowup, setPendingFollowup] = useState(
    () => cachedListState?.filters.pendingFollowup ?? false,
  );
  // Saved-view-only quick filter (Filters drawer > Saved views > "Idle 24h+")
  const [idle, setIdle] = useState(() => cachedListState?.filters.idle ?? false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Column sort is opt-in: null until a header is clicked (asc -> desc -> back to null).
  const [sort, setSort] = useState<{ by: string; dir: "asc" | "desc" } | null>(
    () => cachedListState?.sort ?? null,
  );
  const [loading, setLoading] = useState(false);
  // A failed list load must not read as "No leads found".
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [creating, setCreating] = useState(false);
  // Mirrors `creating` synchronously — `creating` itself only updates after React re-renders,
  // which leaves a window where a double-click (or Enter + click) can fire handleCreate twice
  // before the submit button is actually disabled. See handleCreate for details (SCRUM-46).
  const creatingRef = useRef(false);
  const [touched, setTouched] = useState({ name: false, phone: false, email: false });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    confirmLabel: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const canDelete = user?.role !== "SALES_REP";
  const [form, setForm] = useState(EMPTY_LEAD_FORM);

  function resetCreateForm() {
    setForm(EMPTY_LEAD_FORM);
    setTouched({ name: false, phone: false, email: false });
  }

  const nameError = touched.name ? getNameError(form.name) : "";
  const phoneError = touched.phone ? getPhoneError(form.phone) : "";
  const emailError = touched.email ? getEmailError(form.email) : "";

  // Derived view of individual filter state for the Filters drawer/button/chips.
  // Both stage and source are true multi-select.
  const filtersValue: LeadFiltersValue = {
    stages,
    sources,
    assignedToIds,
    teamIds,
    cities,
    courses,
    scoreMin,
    scoreMax,
    datePreset,
    createdAfter,
    createdBefore,
    dateField,
    hotOnly,
    unassigned,
    notEngaged,
    untouched,
    followupOverdue,
    leaking,
    commsAfter,
    commsBefore,
    pendingFollowup,
    idle,
  };

  // Keep a "latest" ref of everything worth restoring, updated on every render
  // (not inside an effect — this is just bookkeeping, not a side effect). The
  // unmount cleanup below reads `.current` at the moment it actually fires, so
  // it always writes back the most recent values regardless of which render
  // last touched this ref (SCRUM-59, SCRUM-62).
  const latestListStateRef = useRef<LeadsListState>({
    page,
    limit,
    search,
    searchInput,
    filters: filtersValue,
    sort,
    scrollTop: 0,
  });
  latestListStateRef.current = {
    page,
    limit,
    search,
    searchInput,
    filters: filtersValue,
    sort,
    scrollTop: latestListStateRef.current.scrollTop,
  };

  // Below the md breakpoint the desktop table (and scrollRef, its own
  // overflow-auto container) is display:none — the mobile card list has no
  // scroll container of its own, so it scrolls via the shared <main> that
  // Layout.tsx mounts around every route (see that file's own comment: "the
  // one scrollable container shared by every route").
  function getListScrollEl(): HTMLElement | null {
    if (window.matchMedia("(min-width: 768px)").matches) return scrollRef.current;
    return document.querySelector<HTMLElement>("main");
  }

  // Track the live scroll offset into latestListStateRef as the user scrolls,
  // rather than reading the DOM only at unmount time: Layout.tsx's own effect
  // resets the shared <main>'s scrollTop to 0 on every route change, and that
  // reset has already run by the time this page's unmount cleanup fires (it's
  // the ancestor's effect, but empirically it runs first) — so reading
  // scrollTop *at* unmount always sees 0, not the position the user actually
  // scrolled to.
  useEffect(() => {
    const el = getListScrollEl();
    if (!el) return;
    const onScroll = () => {
      latestListStateRef.current = { ...latestListStateRef.current, scrollTop: el.scrollTop };
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Runs once, on unmount only (e.g. navigating to /leads/:id) — stash the
  // latest filters/sort/paging/scroll (tracked live above) into the
  // module-level cache so the next mount of this page (the Back navigation)
  // can restore them.
  useEffect(() => {
    return () => {
      leadsListStateCache = latestListStateRef.current;
    };
  }, []);

  // Restore the scroll position once the first post-mount load has finished
  // rendering rows — restoring any earlier (while the table is still empty/
  // skeleton) would just no-op since there's nothing to scroll to yet.
  //
  // Re-applied on every animation frame for a short window rather than set
  // once: Layout.tsx's own effect resets the shared <main>'s scrollTop to 0
  // on every route change (including this Back navigation), and a second,
  // slightly later fetch this page kicks off on mount (e.g. lead stats)
  // re-renders the list and can collapse/reset scrollTop again right after a
  // single restore attempt would have "won" — reapplying for ~1s survives
  // that without needing to know exactly which later render caused it.
  useEffect(() => {
    if (restoredScrollRef.current || loading) return;
    restoredScrollRef.current = true;
    const target = cachedListState?.scrollTop;
    if (!target) return;
    const deadline = Date.now() + 1000;
    const tick = () => {
      const el = getListScrollEl();
      if (el && el.scrollHeight >= target && el.scrollTop !== target) {
        el.scrollTop = target;
      }
      if (Date.now() < deadline) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [loading, cachedListState]);

  function applyFilters(next: LeadFiltersValue) {
    setStages(next.stages);
    setSources(next.sources);
    setAssignedToIds(next.assignedToIds);
    setTeamIds(next.teamIds);
    setCities(next.cities);
    setCourses(next.courses);
    setScoreMin(next.scoreMin);
    setScoreMax(next.scoreMax);
    setDatePreset(next.datePreset);
    setCreatedAfter(next.createdAfter);
    setCreatedBefore(next.createdBefore);
    setDateField(next.dateField);
    setHotOnly(next.hotOnly);
    setUnassigned(next.unassigned);
    setNotEngaged(next.notEngaged);
    setUntouched(next.untouched);
    setFollowupOverdue(next.followupOverdue);
    setLeaking(next.leaking);
    setCommsAfter(next.commsAfter);
    setCommsBefore(next.commsBefore);
    setPendingFollowup(next.pendingFollowup);
    setIdle(next.idle);
    setPage(1);
  }

  function toggleSort(by: string) {
    setSort((cur) =>
      cur?.by !== by ? { by, dir: "asc" } : cur.dir === "asc" ? { by, dir: "desc" } : null,
    );
    setPage(1);
  }

  const buildQuery = useCallback(
    () => ({
      page,
      search: search || undefined,
      stages: stages.length ? stages : undefined,
      sources: sources.length ? sources : undefined,
      unassigned: unassigned || undefined,
      createdAfter: createdAfter || undefined,
      createdBefore: createdBefore || undefined,
      dateField: createdAfter || createdBefore ? dateField : undefined,
      assignedToIds: assignedToIds.length ? assignedToIds : undefined,
      teamIds: teamIds.length ? teamIds : undefined,
      cities: cities.length ? cities : undefined,
      courses: courses.length ? courses : undefined,
      scoreMin,
      scoreMax,
      hotOnly: hotOnly || undefined,
      notEngaged: notEngaged || undefined,
      untouched: untouched || undefined,
      followupOverdue: followupOverdue || undefined,
      leaking: leaking || undefined,
      commsAfter: commsAfter || undefined,
      commsBefore: commsBefore || undefined,
      pendingFollowup: pendingFollowup || undefined,
      idle: idle || undefined,
      sortBy: sort?.by,
      sortOrder: sort?.dir,
      limit,
    }),
    [
      page,
      search,
      stages,
      sources,
      unassigned,
      createdAfter,
      createdBefore,
      dateField,
      assignedToIds,
      teamIds,
      cities,
      courses,
      scoreMin,
      scoreMax,
      hotOnly,
      notEngaged,
      untouched,
      followupOverdue,
      leaking,
      commsAfter,
      commsBefore,
      pendingFollowup,
      idle,
      sort,
      limit,
    ],
  );

  // Deep-link effects (assignedToId, notEngaged, etc.) update filter state right
  // after mount, which fires a second, differently-filtered load() while the
  // unfiltered mount fetch is still in flight. Without ordering, whichever
  // response lands last wins — an unfiltered response can silently overwrite a
  // filtered one even though the filter chip still shows as active. Guard by
  // request sequence so only the most recently *issued* request's response applies.
  const requestIdRef = useRef(0);
  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const res = await getLeads(buildQuery());
      if (requestId !== requestIdRef.current) return; // superseded by a newer load()
      setLoadError(null);
      setLeads(res.data);
      setTotal(res.total);
      // Keep the All/stage chips + sidebar badge in sync with whatever is on
      // screen — re-sync the shared stats on every list load, not just mutations.
      // Pass the other active filters so each chip's count reflects them too;
      // the backend strips stage/stages since these chips are the stage picker.
      void refreshStats(buildQuery());
    } catch (err) {
      if (requestId === requestIdRef.current) setLoadError(apiErrorMessage(err, Messages.load.leads));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [
    buildQuery,
    refreshStats,
    // Re-fetch when the notification bell detects new/updated lead activity, so a
    // resubmitted/reassigned lead surfaces without a manual navigation-away-and-back.
    newLeadVersion,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-assign queues work on the backend and returns before the owners are written,
  // so a single refetch shows stale (still-unassigned) rows. Re-fetch silently a few
  // times with backoff, updating the table live, and stop once assignments settle.
  const pollRefresh = useCallback(async () => {
    const delays = [800, 1200, 1800, 2500, 3500];
    let prevSig = "";
    for (const delay of delays) {
      await new Promise((r) => setTimeout(r, delay));
      try {
        const res = await getLeads(buildQuery());
        setLeads(res.data);
        setTotal(res.total);
        const sig =
          res.data.map((l) => `${l.id}:${l.assignedTo?.id ?? ""}`).join("|") +
          `#${res.total}`;
        if (sig === prevSig) break; // owners stopped changing → settled
        prevSig = sig;
      } catch {
        /* keep polling — a transient error shouldn't abort the refresh */
      }
    }
  }, [buildQuery]);

  // Debounce search input → committed query (avoids an API call per keystroke).
  // Skip the very first run: useEffect always fires once on mount too, and
  // without this guard that unconditionally reset `page` back to 1 on every
  // mount — including a remount from the browser Back button — clobbering
  // the page number just seeded from the URL.
  const isFirstSearchRun = useRef(true);
  useEffect(() => {
    if (isFirstSearchRun.current) {
      isFirstSearchRun.current = false;
      return;
    }
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Open the create dialog when arriving via /leads?new=1 (from the Dashboard)
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setShowCreate(true);
      searchParams.delete("new");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Apply filters passed in via deep link (e.g. from Dashboard KPI cards:
  // /leads?stage=ENROLLED, /leads?createdAfter=...), then strip them from the
  // URL so subsequent client-side filter changes don't fight with stale params.
  useEffect(() => {
    let consumed = false;
    const urlStage = searchParams.get("stage");
    const urlSource = searchParams.get("source");
    const urlUnassigned = searchParams.get("unassigned");
    const urlCreatedAfter = searchParams.get("createdAfter");
    const urlCreatedBefore = searchParams.get("createdBefore");
    const urlAssignedToId = searchParams.get("assignedToId");
    const urlNotEngaged = searchParams.get("notEngaged");
    const urlUntouched = searchParams.get("untouched");
    const urlFollowupOverdue = searchParams.get("followupOverdue");
    const urlLeaking = searchParams.get("leaking");
    const urlCommsAfter = searchParams.get("commsAfter");
    const urlCommsBefore = searchParams.get("commsBefore");
    const urlPendingFollowup = searchParams.get("pendingFollowup");
    if (urlStage) {
      setStages([urlStage]);
      searchParams.delete("stage");
      consumed = true;
    }
    if (urlSource) {
      setSources([urlSource]);
      searchParams.delete("source");
      consumed = true;
    }
    if (urlUnassigned) {
      setUnassigned(urlUnassigned === "1" || urlUnassigned === "true");
      searchParams.delete("unassigned");
      consumed = true;
    }
    if (urlCreatedAfter) {
      setCreatedAfter(urlCreatedAfter);
      searchParams.delete("createdAfter");
      consumed = true;
    }
    if (urlCreatedBefore) {
      setCreatedBefore(urlCreatedBefore);
      searchParams.delete("createdBefore");
      consumed = true;
    }
    if (searchParams.get("dateField")) {
      searchParams.delete("dateField");
      consumed = true;
    }
    if (searchParams.get("datePreset")) {
      searchParams.delete("datePreset");
      consumed = true;
    }
    if (urlAssignedToId) {
      setAssignedToIds([urlAssignedToId]);
      searchParams.delete("assignedToId");
      consumed = true;
    }
    if (urlNotEngaged) {
      setNotEngaged(urlNotEngaged === "1" || urlNotEngaged === "true");
      searchParams.delete("notEngaged");
      consumed = true;
    }
    if (urlUntouched) {
      setUntouched(urlUntouched === "1" || urlUntouched === "true");
      searchParams.delete("untouched");
      consumed = true;
    }
    if (urlFollowupOverdue) {
      setFollowupOverdue(
        urlFollowupOverdue === "1" || urlFollowupOverdue === "true",
      );
      searchParams.delete("followupOverdue");
      consumed = true;
    }
    if (urlCommsAfter) {
      setCommsAfter(urlCommsAfter);
      searchParams.delete("commsAfter");
      consumed = true;
    }
    if (urlCommsBefore) {
      setCommsBefore(urlCommsBefore);
      searchParams.delete("commsBefore");
      consumed = true;
    }
    if (urlLeaking) {
      setLeaking(urlLeaking === "1" || urlLeaking === "true");
      searchParams.delete("leaking");
      consumed = true;
    }
    if (urlPendingFollowup) {
      setPendingFollowup(
        urlPendingFollowup === "1" || urlPendingFollowup === "true",
      );
      searchParams.delete("pendingFollowup");
      consumed = true;
    }
    if (consumed) {
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Two-way sync between `page` state and the URL's `page` param, so each
  // pagination click is itself back-navigable (Back steps page 3 -> page 2 ->
  // page 1 -> away, not straight back to the previous route) while browser
  // Back/Forward also restores the matching `page` state. The Leads route
  // doesn't remount on a search-param-only navigation, so the URL -> state
  // direction is needed in addition to state -> URL; `syncingFromUrlRef`
  // stops that second effect's page update from bouncing straight back into
  // a duplicate history push via the first effect.
  // `lastSyncedPageRef` (rather than a one-shot "is this the first run"
  // flag) guards the push: React 18 StrictMode double-invokes effects on
  // mount in dev, and a flag that only protects the very first call would
  // let the second invocation push a spurious duplicate history entry.
  // Comparing against the last value we actually synced is idempotent no
  // matter how many times the effect fires for the same `page`.
  const lastSyncedPageRef = useRef(page);
  const syncingFromUrlRef = useRef(false);

  useEffect(() => {
    if (syncingFromUrlRef.current) {
      syncingFromUrlRef.current = false;
      lastSyncedPageRef.current = page;
      return;
    }
    if (page === lastSyncedPageRef.current) return;
    lastSyncedPageRef.current = page;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (page > 1) next.set("page", String(page));
      else next.delete("page");
      return next;
    });
  }, [page, setSearchParams]);

  useEffect(() => {
    const v = Number(searchParams.get("page"));
    const urlPage = Number.isFinite(v) && v > 0 ? v : 1;
    setPage((current) => {
      if (current === urlPage) return current;
      syncingFromUrlRef.current = true;
      return urlPage;
    });
  }, [searchParams]);

  // Clear selection when the visible set changes (filter / page change)
  useEffect(() => {
    setSelected(new Set());
  }, [
    stages,
    search,
    sources,
    unassigned,
    createdAfter,
    createdBefore,
    assignedToIds,
    teamIds,
    cities,
    courses,
    scoreMin,
    scoreMax,
    hotOnly,
    notEngaged,
    untouched,
    followupOverdue,
    leaking,
    commsAfter,
    commsBefore,
    pendingFollowup,
    idle,
    page,
  ]);

  const allSelected =
    leads.length > 0 && leads.every((l) => selected.has(l.id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)));
  };

  async function handleMarkClosed() {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      await Promise.all(
        [...selected].map((id) => updateLead(id, { stage: "NOT_INTERESTED" })),
      );
      const n = selected.size;
      setSelected(new Set());
      void load();
      toast.success(Messages.leads.markedNotInterested(n));
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leads.updateManyFailed));
    } finally {
      setBulkLoading(false);
    }
  }

  async function changeStage(id: string, newStage: LeadStage) {
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, stage: newStage } : l)),
    );
    try {
      await updateLead(id, { stage: newStage });
      void refreshStats(buildQuery());
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leads.stageUpdateFailed));
      void load();
    }
  }

  async function changeOwner(id: string, userId: string | null) {
    const found = userId ? users.find((u) => u.id === userId) : null;
    setLeads((prev) =>
      prev.map((l) =>
        l.id === id
          ? {
              ...l,
              assignedTo: found
                ? { id: found.id, name: found.name }
                : undefined,
            }
          : l,
      ),
    );
    try {
      if (userId) {
        await reassignLead(id, userId);
      } else {
        await updateLead(id, { assignedToId: null });
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leads.ownerUpdateFailed));
      void load();
    }
  }

  async function handleBulkAssign(userId: string) {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      await Promise.all([...selected].map((id) => reassignLead(id, userId)));
      const n = selected.size;
      setSelected(new Set());
      void load();
      toast.success(Messages.leads.assigned(n));
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leads.assignFailed));
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleBulkExport() {
    if (selected.size === 0) return;
    const rows = leads.filter((l) => selected.has(l.id));
    const csv = leadsToCSV(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    await saveFile(blob, `leads-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  async function handleBulkAutoAssign() {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      const n = selected.size;
      const { queued } = await distributeLeadsRoundRobin([...selected]);
      setSelected(new Set());
      void pollRefresh();
      if (queued === 0) {
        toast.error(Messages.leads.nothingToAutoAssign);
      } else if (queued < n) {
        toast.success(Messages.leads.autoAssigningSome(queued, n - queued));
      } else {
        toast.success(Messages.leads.autoAssigning(queued));
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leads.autoAssignFailed));
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleAutoAssignAll() {
    setAutoAssigning(true);
    try {
      const { queued, reps } = await autoAssignAllLeads();
      if (reps === 0) {
        toast.error(Messages.leads.noRepAvailable);
      } else if (queued === 0) {
        toast.error(Messages.leads.nothingUnassigned);
      } else {
        void pollRefresh();
        toast.success(Messages.leads.autoAssigning(queued));
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leads.autoAssignFailed));
    } finally {
      setAutoAssigning(false);
    }
  }

  async function handleBulkChangeStage(newStage: LeadStage) {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      await Promise.all(
        [...selected].map((id) => updateLead(id, { stage: newStage })),
      );
      const n = selected.size;
      setSelected(new Set());
      void load();
      toast.success(Messages.leads.movedToStage(n, newStage));
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leads.stageUpdateFailed));
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleBulkArchive() {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      const { archived } = await archiveLeads([...selected]);
      setSelected(new Set());
      void load();
      toast.success(Messages.leads.archived(archived));
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leads.archiveManyFailed));
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleArchiveOne(id: string) {
    setLeads((prev) => prev.filter((l) => l.id !== id));
    try {
      await archiveLead(id);
      void load();
      toast.success(Messages.leads.archivedOne);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leads.archiveFailed));
      void load();
    }
  }

  async function handleArchiveAll() {
    try {
      const { archived } = await archiveAllLeads(buildQuery());
      setSelected(new Set());
      void load();
      toast.success(Messages.leads.archived(archived));
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leads.archiveManyFailed));
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setConfirmLoading(true);
    try {
      await confirm.onConfirm();
    } finally {
      setConfirmLoading(false);
      setConfirm(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    // Guard against a double-submit (double-click, or Enter + click landing before React
    // re-renders the disabled submit button). `creating` state only flips visually after a
    // render, so a second call can slip through while it's still false in that closure. A ref
    // updates synchronously, so this reliably blocks the second call. Without this, two
    // requests for the same lead can both reach the backend — the first creates the lead, the
    // second then correctly gets flagged as a duplicate of it — and whichever response comes
    // back first decides which toast shows, so a "duplicate" error can appear before the
    // "created" success even though only one lead was ever actually created (SCRUM-46).
    if (creatingRef.current) return;
    setTouched({ name: true, phone: true, email: true });
    if (getNameError(form.name) || getPhoneError(form.phone) || getEmailError(form.email)) {
      return;
    }
    const trimmedName = form.name.trim().replace(/\s+/g, " ");
    creatingRef.current = true;
    setCreating(true);
    try {
      await createLead({
        ...form,
        name: trimmedName,
        email: form.email.trim() || undefined,
      } as Record<string, unknown>);
      setShowCreate(false);
      setForm(EMPTY_LEAD_FORM);
      setTouched({ name: false, phone: false, email: false });
      void load();
      toast.success(Messages.leads.created);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.leads.createFailed));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  const totalPages = Math.ceil(total / limit);
  const hasBulk = selected.size > 0;

  return (
    <div className="md:flex md:flex-col md:h-full md:min-h-0">
      <Header
        title="Leads"
        subtitle={`${total} total lead${total !== 1 ? "s" : ""}`}
        actions={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Text hidden below sm (icon + tooltip only) so all three of these fit on
                one row alongside each other on a narrow phone, instead of wrapping past
                Auto Assign/Delete All the way Import used to. */}
            {canDelete && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={autoAssigning}
                onClick={() => void handleAutoAssignAll()}
                title="Distribute all unassigned leads evenly across reps (round robin)"
              >
                <Shuffle className="w-4 h-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Auto Assign</span>
              </Button>
            )}
            {canDelete && total > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setConfirm({
                    title: "Archive all matching leads?",
                    body: `This will archive all ${total} lead${total !== 1 ? "s" : ""} matching the current filters across every page. Archived leads are hidden from the list but can be restored from the database.`,
                    confirmLabel: "Archive all",
                    onConfirm: handleArchiveAll,
                  })
                }
                title="Archive all leads matching the current filters"
              >
                <Archive className="w-4 h-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Archive all</span>
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowImport(true)}
              title="Import leads from a CSV file"
            >
              <Upload className="w-4 h-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Import</span>
            </Button>
            <Button onClick={() => setShowCreate(true)} size="sm">
              <Plus className="w-4 h-4 mr-1.5" />
              Add Lead
            </Button>
          </div>
        }
      />
      <ImportWizardModal
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={() => void load()}
      />
      <div className="p-4 sm:p-6 space-y-4 md:flex md:flex-col md:flex-1 md:min-h-0 md:overflow-hidden">
        {/* Stage chip filter */}
        <StageChipFilter
          activeStage={stages.length === 1 ? stages[0] : ""}
          onChange={(s) => {
            setStages(s ? [s] : []);
            setPage(1);
          }}
        />

        {/* Search + filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search leads…"
              className="pl-9"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <FiltersButton
            filters={filtersValue}
            onClick={() => setFiltersOpen(true)}
          />
          {user?.role !== "SALES_REP" && (
            <Button
              type="button"
              variant={unassigned ? "default" : "outline"}
              size="sm"
              className="w-full sm:w-auto"
              aria-pressed={unassigned}
              onClick={() => {
                setUnassigned((v) => !v);
                setPage(1);
              }}
            >
              <Users className="w-4 h-4 mr-1.5" />
              Unassigned
            </Button>
          )}
        </div>

        <ActiveFilterChips
          filters={filtersValue}
          users={users}
          teams={teams}
          onChange={applyFilters}
          onClearAll={() => applyFilters(emptyLeadFilters())}
        />

        <FiltersDrawer
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          value={filtersValue}
          onChange={applyFilters}
          resultCount={total}
        />

        {/* Bulk action bar + table */}
        <div className="md:flex md:flex-col md:flex-1 md:min-h-0">
          {hasBulk && (
            <BulkActionBar
              count={selected.size}
              loading={bulkLoading}
              users={users}
              onAssign={(userId) => void handleBulkAssign(userId)}
              onAutoAssign={() => void handleBulkAutoAssign()}
              onEnroll={() => toast.info(Messages.leads.enrollComingSoon)}
              onChangeStage={(s) => void handleBulkChangeStage(s)}
              onExport={() => void handleBulkExport()}
              onMarkClosed={() => void handleMarkClosed()}
              onDelete={() =>
                setConfirm({
                  title: "Archive selected leads?",
                  body: `This will archive ${selected.size} selected lead${selected.size !== 1 ? "s" : ""}. Archived leads are hidden from the list but can be restored from the database.`,
                  confirmLabel: "Archive",
                  onConfirm: handleBulkArchive,
                })
              }
              onClear={() => setSelected(new Set())}
            />
          )}

          <div
            className={cn(
              "overflow-hidden md:bg-card md:border md:border-card-border md:flex md:flex-col md:flex-1 md:min-h-0",
              hasBulk
                ? "md:rounded-b-xl md:rounded-t-none md:border-t-0"
                : "md:rounded-xl",
            )}
          >
            <div
              ref={scrollRef}
              className={cn(
                "overflow-auto hidden md:block md:flex-1 md:min-h-0",
                !loading && leads.length === 0 && "md:hidden",
              )}
            >
              <table className="w-full text-sm">
                <thead className="md:sticky md:top-0 md:z-20">
                  <tr className="border-b border-border bg-muted/40 md:bg-muted">
                    <th
                      className="sticky left-0 z-30 w-[360px] min-w-[360px] max-w-[360px] px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide bg-muted border-r border-border shadow-[4px_0_8px_-4px_rgba(20,20,30,0.08)]"
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          className="w-4 h-4 cursor-pointer accent-primary shrink-0"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected;
                          }}
                          onChange={handleSelectAll}
                          aria-label={
                            allSelected ? "Deselect all" : "Select all"
                          }
                        />
                        <span>Lead</span>
                      </div>
                    </th>
                    {(() => {
                      const headers = listColumns;
                      return headers.map(({ key, label, sortKey }) => (
                        <th
                          key={key}
                          className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap max-w-[160px] truncate"
                          title={label || undefined}
                          aria-sort={
                            sortKey && sort?.by === sortKey
                              ? sort.dir === "asc"
                                ? "ascending"
                                : "descending"
                              : undefined
                          }
                        >
                          {sortKey ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(sortKey)}
                              className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground"
                            >
                              {label}
                              {sort?.by === sortKey &&
                                (sort.dir === "asc" ? (
                                  <ArrowUp className="w-3 h-3" />
                                ) : (
                                  <ArrowDown className="w-3 h-3" />
                                ))}
                            </button>
                          ) : (
                            label
                          )}
                        </th>
                      ));
                    })()}
                  </tr>
                </thead>
                <tbody>
                  {loading &&
                    [...Array(6)].map((_, i) => {
                      const colCount = listColumns.length;
                      return (
                        <tr key={i} className="border-b border-border/50">
                          <td className="sticky left-0 z-10 w-[360px] min-w-[360px] max-w-[360px] px-4 py-3 bg-card border-r border-border shadow-[4px_0_8px_-4px_rgba(20,20,30,0.08)]">
                            <Skeleton className="h-4 w-full" />
                          </td>
                          {[...Array(colCount)].map((_, j) => (
                            <td key={j} className="px-4 py-3">
                              <Skeleton className="h-4 w-full" />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  {!loading &&
                    leads.map((lead) => (
                      <tr
                        key={lead.id}
                        className={cn(
                          "group border-b border-border/50 hover:bg-muted/30 transition-colors",
                          selected.has(lead.id) && "bg-primary/[0.04]",
                        )}
                      >
                        <td
                          className={cn(
                            // This column is sticky (pinned during horizontal scroll), so the
                            // Stage/Source/Owner columns physically sit underneath it — any
                            // alpha-transparent background here (e.g. bg-muted/30) lets their
                            // text visibly bleed through on hover. color-mix produces a fully
                            // opaque blended color instead, so nothing shows through.
                            // A fixed width (not just min-w) matters just as much (SCRUM-52):
                            // this row's content (checkbox + avatar + name + up to 5 action
                            // icons) can exceed 360px, and since HTML tables size a column to
                            // the widest cell in it, an unbounded min-w-only column would grow
                            // past its intended footprint on rows with a long name — pinning
                            // "left-0" to a column that's wider than every other row expects
                            // makes it visually spill into/overlap the first scrollable column
                            // as the table is scrolled horizontally. max-w locks the footprint;
                            // the name link and phone text already truncate to fit inside it.
                            "sticky left-0 z-10 w-[360px] min-w-[360px] max-w-[360px] px-4 py-3 border-r border-border shadow-[4px_0_8px_-4px_rgba(20,20,30,0.08)] transition-colors",
                            selected.has(lead.id)
                              ? "bg-[color-mix(in_srgb,hsl(var(--primary))_4%,hsl(var(--card))_96%)]"
                              : "bg-card group-hover:bg-[color-mix(in_srgb,hsl(var(--muted))_30%,hsl(var(--card))_70%)]",
                          )}
                        >
                          <div className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              className="w-4 h-4 cursor-pointer accent-primary shrink-0"
                              checked={selected.has(lead.id)}
                              onChange={() => toggleSelect(lead.id)}
                              aria-label={`Select ${lead.name}`}
                            />
                            <Avatar className="w-7 h-7 shrink-0">
                              <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
                                {lead.name
                                  .split(" ")
                                  .map((n: string) => n[0])
                                  .join("")
                                  .slice(0, 2)
                                  .toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Link
                                      to={`/leads/${lead.id}`}
                                      className="block max-w-[180px] font-medium text-foreground hover:text-primary transition-colors truncate"
                                    >
                                      {lead.name}
                                    </Link>
                                  </TooltipTrigger>
                                  <TooltipContent>{lead.name}</TooltipContent>
                                </Tooltip>
                                {lead.score >= 85 && (
                                  <span
                                    title="Hot lead"
                                    className="inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-bold tracking-wide bg-red-500/15 text-red-500 dark:text-red-400 shrink-0"
                                  >
                                    <Flame className="w-2 h-2" />
                                    HOT
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground truncate">
                                {lead.phone}
                              </p>
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <a
                                href={`tel:${lead.phone}`}
                                onClick={(e) => void handleCallClick(e, lead)}
                                aria-label={`Call ${lead.name}`}
                                title="Call"
                                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                              >
                                <Phone className="w-3.5 h-3.5" />
                              </a>
                              <a
                                href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`WhatsApp ${lead.name}`}
                                title="WhatsApp"
                                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                              >
                                <WhatsAppIcon className="w-3.5 h-3.5" />
                              </a>
                              {lead.email ? (
                                <a
                                  href={`mailto:${lead.email}`}
                                  aria-label={`Email ${lead.name}`}
                                  title="Email"
                                  className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                                >
                                  <Mail className="w-3.5 h-3.5" />
                                </a>
                              ) : (
                                <span
                                  aria-hidden="true"
                                  title="No email on file"
                                  className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground/30"
                                >
                                  <Mail className="w-3.5 h-3.5" />
                                </span>
                              )}
                              {canDelete && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirm({
                                      title: "Archive lead?",
                                      body: `This will archive ${lead.name}. Archived leads are hidden from the list but can be restored from the database.`,
                                      confirmLabel: "Archive",
                                      onConfirm: () => handleArchiveOne(lead.id),
                                    })
                                  }
                                  aria-label={`Archive ${lead.name}`}
                                  title="Archive lead"
                                  className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                        {listColumns.map((c) => (
                          <td key={c.key} className={c.cellClass}>
                            {c.cell(lead)}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>

            </div>

            {/* Mobile card list — same data as the table above */}
            <div className="md:hidden space-y-2">
              {loading &&
                [...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className="bg-card border border-card-border rounded-xl p-4"
                  >
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-1/2 mt-2" />
                  </div>
                ))}
              {!loading &&
                leads.map((lead) => (
                  <div
                    key={lead.id}
                    onClick={() => navigate(`/leads/${lead.id}`)}
                    className={cn(
                      "bg-card border border-card-border rounded-xl p-4 space-y-3 cursor-pointer transition-colors",
                      selected.has(lead.id) && "bg-primary/[0.04]",
                    )}
                  >
                    {/* Row 1: select + name + stage */}
                    <div className="flex items-center gap-3">
                      <label
                        className="-m-3 flex h-11 w-11 flex-shrink-0 cursor-pointer items-center justify-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          className="w-5 h-5 cursor-pointer accent-primary"
                          checked={selected.has(lead.id)}
                          onChange={() => toggleSelect(lead.id)}
                          aria-label={`Select ${lead.name}`}
                        />
                      </label>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="block min-w-0 font-medium text-foreground truncate">
                                {lead.name}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{lead.name}</TooltipContent>
                          </Tooltip>
                          {lead.score >= 85 && (
                            <span
                              title="Hot lead"
                              className="inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-bold tracking-wide bg-red-500/15 text-red-500 dark:text-red-400 shrink-0"
                            >
                              <Flame className="w-2 h-2" />
                              HOT
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {lead.phone}
                        </p>
                      </div>
                      <StatusBadge status={lead.stage} />
                    </div>

                    {/* Row 2: source · score · owner */}
                    <div
                      className="flex items-center gap-3 flex-wrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <StatusBadge status={lead.source} />
                      <div className="flex-1 min-w-[80px]">
                        <ScoreBar score={lead.score} />
                      </div>
                      <OwnerCell
                        value={lead.assignedTo ?? null}
                        onChange={(uid) => void changeOwner(lead.id, uid)}
                        users={users}
                        readonly={
                          user?.role === "SALES_REP" &&
                          lead.assignedTo?.id !== user.id
                        }
                      />
                    </div>

                    {/* Row 3: actions */}
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <a
                        href={`tel:${lead.phone}`}
                        aria-label={`Call ${lead.name}`}
                        title="Call"
                        className="inline-flex items-center justify-center h-11 w-11 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                      >
                        <Phone className="w-4 h-4" />
                      </a>
                      <a
                        href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`WhatsApp ${lead.name}`}
                        title="WhatsApp"
                        className="inline-flex items-center justify-center h-11 w-11 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                      >
                        <WhatsAppIcon className="w-4 h-4" />
                      </a>
                      {lead.email ? (
                        <a
                          href={`mailto:${lead.email}`}
                          aria-label={`Email ${lead.name}`}
                          title="Email"
                          className="inline-flex items-center justify-center h-11 w-11 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                        >
                          <Mail className="w-4 h-4" />
                        </a>
                      ) : (
                        <span
                          aria-hidden="true"
                          title="No email on file"
                          className="inline-flex items-center justify-center h-11 w-11 rounded-md text-muted-foreground/30"
                        >
                          <Mail className="w-4 h-4" />
                        </span>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirm({
                              title: "Archive lead?",
                              body: `This will archive ${lead.name}. Archived leads are hidden from the list but can be restored from the database.`,
                              confirmLabel: "Archive",
                              onConfirm: () => handleArchiveOne(lead.id),
                            });
                          }}
                          aria-label={`Archive ${lead.name}`}
                          title="Archive lead"
                          className="ml-auto inline-flex items-center justify-center h-11 w-11 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      <Link
                        to={`/leads/${lead.id}`}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`View ${lead.name}`}
                        title="View details"
                        className={cn(
                          "inline-flex items-center justify-center h-11 px-3 rounded-md text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors",
                          !canDelete && "ml-auto",
                        )}
                      >
                        View
                      </Link>
                    </div>
                  </div>
                ))}
            </div>

            {!loading && leads.length === 0 && loadError && (
              <EmptyState
                title="Couldn't load leads"
                description={loadError}
                icon={<Target className="w-10 h-10" />}
                action={
                  <Button size="sm" onClick={() => void load()}>
                    Try again
                  </Button>
                }
              />
            )}

            {!loading && leads.length === 0 && !loadError && (
              <EmptyState
                title="No leads found"
                description="Add your first lead or adjust the filters"
                icon={<Target className="w-10 h-10" />}
                action={
                  <Button size="sm" onClick={() => setShowCreate(true)}>
                    <Plus className="w-4 h-4 mr-1" />
                    Add Lead
                  </Button>
                }
              />
            )}

            {totalPages > 1 && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3 border-t border-border md:shrink-0">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    Showing{" "}
                    <span className="font-semibold text-foreground tabular-nums">
                      {(page - 1) * limit + 1}–{Math.min(page * limit, total)}
                    </span>{" "}
                    of <span className="tabular-nums">{total}</span> leads
                  </span>
                  <select
                    value={limit}
                    onChange={(e) => {
                      setLimit(Number(e.target.value));
                      setPage(1);
                    }}
                    aria-label="Rows per page"
                    className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                  >
                    <option value={20}>20 / page</option>
                    <option value={50}>50 / page</option>
                    <option value={100}>100 / page</option>
                  </select>
                </div>
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create Lead Dialog */}
      <Dialog
        open={showCreate}
        onOpenChange={(v) => {
          setShowCreate(v);
          if (!v) resetCreateForm();
        }}
      >
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Lead</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-1.5">
                <Label>
                  Full Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  required
                  maxLength={100}
                  value={form.name}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, name: e.target.value }))
                  }
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  placeholder="Rahul Sharma"
                />
                <p
                  className={
                    nameError || form.name.length >= 100
                      ? "text-xs text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {nameError ||
                    (form.name.length >= 100
                      ? Messages.leads.nameAtLimit
                      : `${form.name.length}/100`)}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>
                  Phone <span className="text-destructive">*</span>
                </Label>
                <Input
                  required
                  value={form.phone}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      phone: e.target.value.replace(/\D/g, "").slice(0, 10),
                    }))
                  }
                  onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                  placeholder="98765 43210"
                />
                {phoneError && (
                  <p className="text-xs text-destructive">{phoneError}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, email: e.target.value }))
                  }
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  placeholder="rahul@example.com"
                />
                {emailError && (
                  <p className="text-xs text-destructive">{emailError}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Course / Program</Label>
                <Input
                  value={form.course}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, course: e.target.value }))
                  }
                  placeholder="e.g. Digital Marketing"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Input
                  value={form.location}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, location: e.target.value }))
                  }
                  placeholder="e.g. Bangalore"
                />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label>
                  Source <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={form.source}
                  onValueChange={(v) =>
                    setForm((p) => ({ ...p, source: v as LeadSource }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {statusLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  resetCreateForm();
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  creating || !!getNameError(form.name) || !!getPhoneError(form.phone)
                }
              >
                {creating ? "Creating…" : "Create Lead"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirm archive dialog (single / bulk / all) */}
      <Dialog
        open={confirm !== null}
        onOpenChange={(v) => {
          if (!v && !confirmLoading) setConfirm(null);
        }}
      >
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{confirm?.body}</p>
          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="outline"
              type="button"
              disabled={confirmLoading}
              onClick={() => setConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={confirmLoading}
              onClick={() => void runConfirm()}
            >
              {confirmLoading ? "Archiving…" : (confirm?.confirmLabel ?? "Archive")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!fallbackCall} onOpenChange={(open) => !open && setFallbackCall(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Couldn't reach your phone</DialogTitle>
          </DialogHeader>
          {fallbackCall && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Dial {fallbackCall.name} directly:
              </p>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <span className="font-mono text-sm">{fallbackCall.phone}</span>
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={() => void navigator.clipboard.writeText(fallbackCall.phone)}
                >
                  Copy
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
