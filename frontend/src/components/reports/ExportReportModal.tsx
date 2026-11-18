import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Download,
  FileText,
  FileSpreadsheet,
  Table,
  LayoutGrid,
  BarChart3,
  GraduationCap,
  Megaphone,
  Target,
  RectangleVertical,
  RectangleHorizontal,
  Check,
  Loader2,
  CheckCircle2,
  X,
  Sun,
  Moon,
} from "lucide-react";
import { Dialog, DialogPortal, DialogOverlay } from "../ui/dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { saveFile } from "../../lib/platform";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../lib/theme";
import {
  exportDailyReport,
  type DailyReportFilter,
  type DailySummary,
  type StatusReportRow,
  type EnrollmentReport,
  type CampaignPerformanceRow,
} from "../../api/client";

type ExportFormat = "pdf" | "excel" | "csv";
type SectionKey =
  | "summary"
  | "status"
  | "enrollment"
  | "campaign"
  | "sources"
  | "dashboard"
  | "adsets"
  | "ads";
type SectionFlags = Record<SectionKey, boolean>;

interface ExportOptions {
  format: ExportFormat;
  includeCharts: boolean;
  includeCover: boolean;
  orientation: "portrait" | "landscape";
  sections: SectionFlags;
}

const DEFAULT_SECTIONS: SectionFlags = {
  summary: true,
  status: true,
  enrollment: true,
  campaign: true,
  sources: false,
  dashboard: true,
  adsets: true,
  ads: true,
};

const DEFAULT_OPTIONS: ExportOptions = {
  format: "pdf",
  includeCharts: true,
  includeCover: true,
  orientation: "portrait",
  sections: DEFAULT_SECTIONS,
};

const FORMATS: {
  key: ExportFormat;
  name: string;
  desc: string;
  icon: typeof FileText;
  recommended?: boolean;
}[] = [
  {
    key: "pdf",
    name: "PDF",
    desc: "Best for sharing — includes charts, styled layout",
    icon: FileText,
    recommended: true,
  },
  {
    key: "excel",
    name: "Excel",
    desc: "Full raw data across all sections, pivot-ready",
    icon: FileSpreadsheet,
  },
  {
    key: "csv",
    name: "CSV",
    desc: "Plain data export, no formatting",
    icon: Table,
  },
];

const SECTIONS: {
  key: SectionKey;
  name: string;
  icon: typeof LayoutGrid;
  chart?: boolean;
}[] = [
  { key: "summary", name: "Lead Summary KPIs", icon: LayoutGrid },
  { key: "status", name: "Lead Status Report", icon: BarChart3, chart: true },
  {
    key: "enrollment",
    name: "Enrollment & Communication",
    icon: GraduationCap,
  },
  {
    key: "campaign",
    name: "Campaign Performance",
    icon: Megaphone,
    chart: true,
  },
  { key: "adsets", name: "Ad Set Performance", icon: Megaphone },
  { key: "ads", name: "Ad Performance", icon: Megaphone },
  { key: "sources", name: "Lead Source Tracking", icon: Target },
  { key: "dashboard", name: "Daily Dashboard", icon: LayoutGrid },
];

const ORIENTATIONS = [
  { key: "portrait" as const, name: "Portrait", icon: RectangleVertical },
  { key: "landscape" as const, name: "Landscape", icon: RectangleHorizontal },
];

const CHART_BAR_COLORS = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
];

// The thumbnail strip renders the exact same page markup as the main preview, scaled down
// via CSS transform — PREVIEW_PAGE_WIDTH matches the main preview's max-w-[300px] so the
// scale factor (THUMBNAIL_WIDTH / PREVIEW_PAGE_WIDTH) lines up with its own w-[52px].
const PREVIEW_PAGE_WIDTH = 300;
const THUMBNAIL_WIDTH = 52;

const SECTION_LABELS: Record<SectionKey, string> = Object.fromEntries(
  SECTIONS.map((s) => [s.key, s.name]),
) as Record<SectionKey, string>;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type PreviewPage =
  | { type: "cover" }
  | { type: "content"; sections: SectionKey[] };

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-9 h-5 rounded-full transition-colors shrink-0",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}

function PreviewEmptyNote({ text, dark }: { text: string; dark?: boolean }) {
  return (
    <div
      className={cn(
        "flex-1 flex items-center justify-center text-[5.5px] text-center px-2",
        dark ? "text-[#8D95A5]" : "text-neutral-400",
      )}
    >
      {text}
    </div>
  );
}

function PreviewTableHeader({
  labels,
  dark,
}: {
  labels: [string, string, string];
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-3 gap-1 text-[5px] font-bold uppercase pb-0.5 border-b",
        dark
          ? "text-[#8D95A5] border-[#252A37]"
          : "text-neutral-400 border-neutral-100",
      )}
    >
      {labels.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </div>
  );
}

interface ExportReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: DailyReportFilter;
  summary?: DailySummary;
  status?: StatusReportRow[];
  enrollment?: EnrollmentReport;
  campaigns?: CampaignPerformanceRow[];
  /** Preselects the format tab, e.g. from the Export section's "Excel" / "CSV" / "PDF" buttons. */
  initialFormat?: ExportFormat;
}

export function ExportReportModal({
  open,
  onOpenChange,
  filters,
  summary,
  status,
  enrollment,
  campaigns,
  initialFormat,
}: ExportReportModalProps) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const orgName = user?.org?.name ?? "GenX CRM";
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_OPTIONS);
  const [compareMode, setCompareMode] = useState<"charts" | "table">("charts");
  const [selectedThumbnail, setSelectedThumbnail] = useState(0);
  // Only the PDF export is theme-aware — this defaults to the app's current theme but can be
  // flipped independently, so a user can preview (and export) the other theme without having
  // to leave the modal and toggle the whole app.
  const [previewTheme, setPreviewTheme] = useState<"light" | "dark">(theme);
  const [exportState, setExportState] = useState<
    "idle" | "exporting" | "success" | "error"
  >("idle");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset only on the closed→open transition, so a reopened modal never shows a stale
  // success banner or carries over the previous session's selections.
  useEffect(() => {
    if (open) {
      setOptions({
        ...DEFAULT_OPTIONS,
        format: initialFormat ?? DEFAULT_OPTIONS.format,
      });
      setExportState("idle");
      setSelectedThumbnail(0);
      setPreviewTheme(theme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the preview's compare toggle in sync with the real "include charts" switch —
  // the user can still flip it manually afterward to preview the other mode.
  useEffect(() => {
    setCompareMode(options.includeCharts ? "charts" : "table");
  }, [options.includeCharts]);

  const isPdf = options.format === "pdf";
  const isCsv = options.format === "csv";

  const selectedSectionKeys = (
    Object.entries(options.sections) as [SectionKey, boolean][]
  )
    .filter(([, checked]) => checked)
    .map(([key]) => key);

  const contentChunks = chunk(selectedSectionKeys, 2);
  const previewPages: PreviewPage[] = isPdf
    ? [
        ...(options.includeCover ? [{ type: "cover" as const }] : []),
        ...(contentChunks.length > 0
          ? contentChunks.map((sections) => ({
              type: "content" as const,
              sections,
            }))
          : [{ type: "content" as const, sections: [] }]),
      ]
    : [];
  const pageCount = previewPages.length;
  const activePageIndex = Math.min(
    selectedThumbnail,
    Math.max(pageCount - 1, 0),
  );
  const activePage = previewPages[activePageIndex];

  // Keep the selected thumbnail in range as sections are toggled — otherwise a page
  // selected while more sections were checked could point past the end of a shorter list.
  useEffect(() => {
    setSelectedThumbnail((t) => Math.min(t, Math.max(pageCount - 1, 0)));
  }, [pageCount]);

  const handleSectionToggle = (key: SectionKey) => {
    if (isCsv) return;
    setOptions((prev) => ({
      ...prev,
      sections: { ...prev.sections, [key]: !prev.sections[key] },
    }));
  };

  const handleExport = async () => {
    setExportState("exporting");
    try {
      const blob = await exportDailyReport(filters, {
        format: options.format,
        includeCharts: options.includeCharts,
        includeCover: options.includeCover,
        orientation: options.orientation,
        // Only PDF actually renders theme-aware colors — Excel/CSV are plain data, so there's
        // nothing for a theme to apply to.
        ...(isPdf && { theme: previewTheme }),
        sections: selectedSectionKeys,
      });
      if (!mountedRef.current) return;
      const ext = options.format === "excel" ? "xlsx" : options.format;
      await saveFile(blob, `daily-report-${filters.from ?? "today"}.${ext}`);
      setExportState("success");
    } catch {
      if (mountedRef.current) setExportState("error");
    }
  };

  const dateRangeLabel =
    filters.from && filters.to ? `${filters.from}–${filters.to}` : "Today";
  const statusData = status ?? [];
  const maxStatus = Math.max(...statusData.map((s) => s.count), 1);

  // The preview mimics an actual page, so it deliberately doesn't follow bg-card/text-
  // foreground — it needs its own light/dark "paper" palette, matching the real PDF's
  // theme-aware colors in reports.service.ts.
  const isDarkPreview = previewTheme === "dark";
  const previewText = isDarkPreview ? "text-[#E8EAEE]" : "text-neutral-900";
  const previewMuted = isDarkPreview ? "text-[#8D95A5]" : "text-neutral-400";
  const previewBody = isDarkPreview ? "text-[#B8BFCB]" : "text-neutral-600";
  const previewBorder = isDarkPreview
    ? "border-[#252A37]"
    : "border-neutral-100";
  const previewTileBg = isDarkPreview ? "bg-[#161A24]" : "bg-neutral-100";

  // Mini per-section preview bodies, using whatever real data the parent already fetched
  // for the screen — sections without data passed to this modal fall back to a generic note.
  function renderSectionPreview(key: SectionKey) {
    if (key === "summary") {
      return (
        <div className="grid grid-cols-4 gap-1">
          {[
            { label: "Total Leads", value: summary?.generated ?? 0 },
            { label: "New", value: summary?.newLeads ?? 0 },
            { label: "Contacted", value: summary?.contacted ?? 0 },
            { label: "Pending", value: summary?.pending ?? 0 },
          ].map((k) => (
            <div key={k.label} className={cn("rounded p-1", previewTileBg)}>
              <div className={cn("text-[5.4px] mb-0.5", previewMuted)}>
                {k.label}
              </div>
              <div className={cn("text-[9px] font-bold", previewText)}>
                {k.value}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (key === "status") {
      return compareMode === "charts" ? (
        <div className="flex-1 flex items-end gap-1 min-h-0">
          {statusData.map((row, i) => (
            <div
              key={row.stage}
              className={cn(
                "flex-1 rounded-t-sm",
                CHART_BAR_COLORS[i % CHART_BAR_COLORS.length],
              )}
              style={{ height: `${(row.count / maxStatus) * 100}%` }}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          <PreviewTableHeader
            labels={["Stage", "Count", "%"]}
            dark={isDarkPreview}
          />
          {statusData.map((row) => (
            <div
              key={row.stage}
              className={cn(
                "grid grid-cols-3 gap-1 text-[5.5px] py-0.5",
                previewBody,
              )}
            >
              <span className="truncate">{row.stage}</span>
              <span>{row.count}</span>
              <span>
                {summary?.generated
                  ? ((row.count / summary.generated) * 100).toFixed(0)
                  : 0}
                %
              </span>
            </div>
          ))}
        </div>
      );
    }

    if (key === "enrollment") {
      const rows = (enrollment?.perRep ?? []).slice(0, 3);
      return rows.length === 0 ? (
        <PreviewEmptyNote
          text="No enrollment activity yet."
          dark={isDarkPreview}
        />
      ) : (
        <div className="flex flex-col gap-0.5">
          <PreviewTableHeader
            labels={["Rep", "Enrolled", "Revenue"]}
            dark={isDarkPreview}
          />
          {rows.map((r) => (
            <div
              key={r.repId}
              className={cn(
                "grid grid-cols-3 gap-1 text-[5.5px] py-0.5",
                previewBody,
              )}
            >
              <span className="truncate">{r.repName}</span>
              <span>{r.enrolled}</span>
              <span>{r.revenue.toLocaleString("en-IN")}</span>
            </div>
          ))}
        </div>
      );
    }

    if (key === "campaign") {
      const rows = (campaigns ?? []).slice(0, 3);
      return rows.length === 0 ? (
        <PreviewEmptyNote
          text="No campaign data for this range."
          dark={isDarkPreview}
        />
      ) : (
        <div className="flex flex-col gap-0.5">
          <PreviewTableHeader
            labels={["Campaign", "Leads", "Conv."]}
            dark={isDarkPreview}
          />
          {rows.map((c) => (
            <div
              key={c.campaignId}
              className={cn(
                "grid grid-cols-3 gap-1 text-[5.5px] py-0.5",
                previewBody,
              )}
            >
              <span className="truncate">{c.campaignName}</span>
              <span>{c.leads}</span>
              <span>{c.conversionRate.toFixed(0)}%</span>
            </div>
          ))}
        </div>
      );
    }

    return (
      <PreviewEmptyNote
        text="Included in export — see downloaded file for full detail."
        dark={isDarkPreview}
      />
    );
  }

  // Shared by the main preview and each thumbnail (the thumbnails just render this at a
  // smaller CSS scale) so the strip always shows a real, up-to-date miniature of every page.
  function renderPageContent(page: PreviewPage | undefined) {
    if (page?.type === "cover") {
      return (
        <div className="w-full h-full p-[6%] flex flex-col items-center justify-center text-center gap-2">
          <img src="/logo-mark.png" alt="" className="w-7 h-7 object-contain" />
          <span
            className={cn("text-[7px] font-bold tracking-wide", previewMuted)}
          >
            {orgName.toUpperCase()}
          </span>
          <span
            className={cn(
              "text-[9px] font-bold leading-tight px-2",
              previewText,
            )}
          >
            Daily Sales &amp; Lead Management Report
          </span>
          <span className="text-[6px] text-primary bg-primary/10 rounded-full px-2 py-0.5">
            {dateRangeLabel}
          </span>
          <span
            className={cn(
              "mt-auto text-[5px] pt-1 border-t w-full text-center",
              isDarkPreview ? "text-[#5b6270]" : "text-neutral-300",
              previewBorder,
            )}
          >
            Confidential — internal distribution only
          </span>
        </div>
      );
    }

    return (
      <div className="w-full h-full p-[6%] flex flex-col gap-[4%] text-[6.5px]">
        <div
          className={cn(
            "flex items-center justify-between pb-[3%] border-b",
            previewBorder,
          )}
        >
          <div
            className={cn(
              "flex items-center gap-1 font-bold text-[9px]",
              previewText,
            )}
          >
            <img
              src="/logo-mark.png"
              alt=""
              className="w-3.5 h-3.5 object-contain"
            />
            {orgName}
          </div>
          <div
            className={cn("text-right leading-tight text-[6px]", previewMuted)}
          >
            Daily Sales Report
            <br />
            {dateRangeLabel}
          </div>
        </div>
        {(page?.sections.length ?? 0) === 0 ? (
          <div
            className={cn(
              "flex-1 flex items-center justify-center text-[6px] text-center",
              previewMuted,
            )}
          >
            No sections selected for this page.
          </div>
        ) : (
          page?.sections.map((key) => (
            <div key={key} className="flex-1 min-h-0 flex flex-col">
              <div className={cn("text-[7px] font-bold mb-0.5", previewText)}>
                {SECTION_LABELS[key]}
              </div>
              <div className="flex-1 min-h-0 flex flex-col">
                {renderSectionPreview(key)}
              </div>
            </div>
          ))
        )}
        <div
          className={cn(
            "mt-auto text-[5px] text-center pt-1 border-t",
            isDarkPreview ? "text-[#5b6270]" : "text-neutral-300",
            previewBorder,
          )}
        >
          Confidential — internal distribution only
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-50 w-[calc(100vw-2rem)] max-w-[980px] translate-x-[-50%] translate-y-[-50%]",
            "bg-popover border border-popover-border rounded-2xl shadow-2xl",
            "flex flex-col max-h-[88vh]",
            "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
            "data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-popover-border flex-shrink-0">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold text-foreground">
                Export report
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-xs text-muted-foreground mt-0.5">
                Daily Sales &amp; Lead Management Report · {dateRangeLabel}
              </DialogPrimitive.Description>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="w-[30px] h-[30px] rounded-lg flex items-center justify-center bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2">
            {/* Left column — options */}
            <div className="p-5 flex flex-col gap-5 md:border-r border-popover-border">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                  Format
                </p>
                <div className="flex gap-2.5">
                  {FORMATS.map((f) => {
                    const selected = options.format === f.key;
                    const Icon = f.icon;
                    return (
                      <button
                        type="button"
                        key={f.key}
                        onClick={() =>
                          setOptions((prev) => ({ ...prev, format: f.key }))
                        }
                        className={cn(
                          "relative flex-1 text-left rounded-xl border-[1.5px] p-3 flex flex-col gap-2 transition-colors",
                          selected
                            ? "border-primary bg-primary/[.07]"
                            : "border-card-border bg-card hover:border-primary/50",
                        )}
                      >
                        {f.recommended && (
                          <Badge className="absolute -top-2 right-2.5 text-[9px] px-1.5 py-0.5 uppercase tracking-wide">
                            Recommended
                          </Badge>
                        )}
                        <span
                          className={cn(
                            "absolute top-2.5 right-2.5 w-4 h-4 rounded-full border-[1.5px] flex items-center justify-center",
                            selected
                              ? "bg-primary border-primary"
                              : "border-input bg-card",
                          )}
                        >
                          {selected && (
                            <Check className="w-2.5 h-2.5 text-white" />
                          )}
                        </span>
                        <span
                          className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center",
                            f.key === "pdf" &&
                              "bg-destructive/15 text-destructive",
                            f.key === "excel" &&
                              "bg-green-500/15 text-green-600 dark:text-green-400",
                            f.key === "csv" && "bg-muted text-muted-foreground",
                          )}
                        >
                          <Icon className="w-4 h-4" />
                        </span>
                        <span className="text-[13px] font-semibold text-foreground">
                          {f.name}
                        </span>
                        <span className="text-[10.5px] leading-tight text-muted-foreground">
                          {f.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {isPdf && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                    Content
                  </p>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-lg bg-primary/[.08] border border-primary/25">
                      <div className="flex items-center gap-2.5">
                        <span className="w-[26px] h-[26px] rounded-md bg-primary/[.14] text-primary flex items-center justify-center flex-shrink-0">
                          <BarChart3 className="w-3.5 h-3.5" />
                        </span>
                        <div>
                          <p className="text-xs font-semibold text-foreground">
                            Include charts &amp; visuals
                          </p>
                          <p className="text-[10.5px] text-muted-foreground">
                            Adds bar charts to the status &amp; campaign
                            sections
                          </p>
                        </div>
                      </div>
                      <ToggleSwitch
                        checked={options.includeCharts}
                        onChange={(v) =>
                          setOptions((prev) => ({ ...prev, includeCharts: v }))
                        }
                        label="Include charts & visuals"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-lg">
                      <div className="flex items-center gap-2.5">
                        <span className="w-[26px] h-[26px] rounded-md bg-primary/[.14] text-primary flex items-center justify-center flex-shrink-0">
                          <FileText className="w-3.5 h-3.5" />
                        </span>
                        <div>
                          <p className="text-xs font-semibold text-foreground">
                            Cover page
                          </p>
                          <p className="text-[10.5px] text-muted-foreground">
                            Logo, report title &amp; date range on page 1
                          </p>
                        </div>
                      </div>
                      <ToggleSwitch
                        checked={options.includeCover}
                        onChange={(v) =>
                          setOptions((prev) => ({ ...prev, includeCover: v }))
                        }
                        label="Cover page"
                      />
                    </div>
                  </div>
                </div>
              )}

              {isPdf && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                    Page orientation
                  </p>
                  <div className="flex gap-2">
                    {ORIENTATIONS.map((o) => {
                      const selected = options.orientation === o.key;
                      const Icon = o.icon;
                      return (
                        <button
                          type="button"
                          key={o.key}
                          onClick={() =>
                            setOptions((prev) => ({
                              ...prev,
                              orientation: o.key,
                            }))
                          }
                          className={cn(
                            "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-[1.5px] text-xs font-medium transition-colors",
                            selected
                              ? "border-primary bg-primary/[.08] text-primary"
                              : "border-card-border text-foreground hover:border-primary/50",
                          )}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {o.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                  Sections to include
                </p>
                <div
                  className={cn("flex flex-col gap-0.5", isCsv && "opacity-50")}
                >
                  {SECTIONS.map((s) => {
                    const Icon = s.icon;
                    const checked = isCsv
                      ? s.key === "summary"
                      : options.sections[s.key];
                    return (
                      <label
                        key={s.key}
                        className={cn(
                          "flex items-center gap-2.5 px-2 py-1.5 rounded-lg",
                          isCsv
                            ? "pointer-events-none"
                            : "hover:bg-muted cursor-pointer",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isCsv}
                          onChange={() => handleSectionToggle(s.key)}
                          className="accent-primary w-3.5 h-3.5"
                        />
                        <span className="w-[22px] h-[22px] rounded-md bg-muted text-muted-foreground flex items-center justify-center flex-shrink-0">
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        <span className="flex-1 text-xs font-medium text-foreground">
                          {s.name}
                        </span>
                        {s.chart && isPdf && options.includeCharts && (
                          <span className="text-[9.5px] font-bold uppercase tracking-wide text-primary bg-primary/[.12] px-1.5 py-0.5 rounded">
                            Chart
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right column — live preview */}
            <div className="p-5 flex flex-col gap-3.5 bg-muted/[.35]">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Preview
                </p>
                {isPdf && (
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewTheme((t) =>
                              t === "dark" ? "light" : "dark",
                            )
                          }
                          aria-label={
                            isDarkPreview
                              ? "Switch preview to light theme"
                              : "Switch preview to dark theme"
                          }
                          className="w-7 h-7 rounded-full flex items-center justify-center border border-card-border bg-card text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                        >
                          {isDarkPreview ? (
                            <Sun className="w-3.5 h-3.5" />
                          ) : (
                            <Moon className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {isDarkPreview
                          ? "Switch to light theme"
                          : "Switch to dark theme"}
                      </TooltipContent>
                    </Tooltip>
                    <div className="inline-flex bg-card border border-card-border rounded-full p-0.5 text-[10.5px] font-semibold">
                      <button
                        type="button"
                        onClick={() => setCompareMode("charts")}
                        className={cn(
                          "px-2.5 py-1 rounded-full transition-colors",
                          compareMode === "charts"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        With charts
                      </button>
                      <button
                        type="button"
                        onClick={() => setCompareMode("table")}
                        className={cn(
                          "px-2.5 py-1 rounded-full transition-colors",
                          compareMode === "table"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        Table only
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {isPdf ? (
                <>
                  <div
                    className={cn(
                      "border border-card-border rounded-lg shadow-lg overflow-hidden mx-auto w-full max-w-[300px] max-h-[420px]",
                      isDarkPreview ? "bg-[#0C0F17]" : "bg-white",
                      previewText,
                      options.orientation === "landscape"
                        ? "aspect-[297/210]"
                        : "aspect-[210/297]",
                    )}
                  >
                    {renderPageContent(activePage)}
                  </div>
                  <div className="flex gap-2 justify-center flex-wrap">
                    {previewPages.map((page, i) => {
                      const pageHeight =
                        options.orientation === "landscape"
                          ? (PREVIEW_PAGE_WIDTH * 210) / 297
                          : (PREVIEW_PAGE_WIDTH * 297) / 210;
                      return (
                        <button
                          type="button"
                          key={i}
                          onClick={() => setSelectedThumbnail(i)}
                          className={cn(
                            "w-[52px] rounded-md border-[1.5px] relative overflow-hidden flex-shrink-0",
                            isDarkPreview ? "bg-[#0C0F17]" : "bg-white",
                            options.orientation === "landscape"
                              ? "aspect-[297/210]"
                              : "aspect-[210/297]",
                            activePageIndex === i
                              ? "border-primary"
                              : "border-card-border",
                          )}
                          title={
                            page.type === "cover"
                              ? "Cover"
                              : page.sections
                                  .map((k) => SECTION_LABELS[k])
                                  .join(", ")
                          }
                        >
                          <div
                            className="absolute top-0 left-0 pointer-events-none"
                            aria-hidden="true"
                            style={{
                              width: PREVIEW_PAGE_WIDTH,
                              height: pageHeight,
                              transform: `scale(${THUMBNAIL_WIDTH / PREVIEW_PAGE_WIDTH})`,
                              transformOrigin: "top left",
                            }}
                          >
                            {renderPageContent(page)}
                          </div>
                          <span className="absolute bottom-0.5 right-1 text-[8px] font-bold text-white [text-shadow:0_0_2px_rgba(0,0,0,0.8)]">
                            {i + 1}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground text-center py-10">
                  <span>
                    {options.format === "excel"
                      ? "Excel export includes one worksheet per selected section."
                      : "CSV export includes the Summary sheet only."}
                  </span>
                  {options.format === "excel" && (
                    <span className="text-[11px]">
                      {enrollment?.perRep.length ?? 0} enrollment rows ·{" "}
                      {campaigns?.length ?? 0} campaigns in this range
                    </span>
                  )}
                </div>
              )}

              {exportState === "success" && (
                <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-success/[.12] border border-success/35 text-success text-xs font-semibold">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  Export ready — download started
                </div>
              )}
              {exportState === "error" && (
                <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-destructive/[.12] border border-destructive/35 text-destructive text-xs font-semibold">
                  Export failed — please try again
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3.5 px-5 py-3.5 border-t border-popover-border flex-shrink-0">
            <span className="text-[11.5px] text-muted-foreground">
              <b className="text-foreground">{options.format.toUpperCase()}</b>
              {" · "}
              {isPdf
                ? `${pageCount} pages`
                : `${selectedSectionKeys.length} sections`}
              {" · "}
              {dateRangeLabel}
            </span>
            <div className="flex gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={exportState === "exporting"}
                onClick={() => void handleExport()}
              >
                {exportState === "exporting" ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Exporting…
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    Export {options.format.toUpperCase()}
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
