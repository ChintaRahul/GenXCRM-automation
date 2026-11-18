import { Link } from "react-router-dom";
import type { LeadSourceTrackingResult } from "../../../api/client";
import { SectionHeader } from "./SectionHeader";
import { cn } from "../../../lib/utils";
import { Skeleton } from "../../ui/skeleton";

interface LeadSourceTrackingProps {
  leadSources: { data: LeadSourceTrackingResult | null; loading: boolean };
  page: number;
  onPageChange: (page: number) => void;
}

const HEADERS = ["Lead", "Source", "Campaign", "Ad set", "Ad", "Lead owner", "Current status", "Enrollment"];
const ROW_PAD = "py-[11px] px-3.5";

function humanizeStage(stage: string): string {
  return stage
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function pageWindow(current: number, total: number): number[] {
  const start = Math.max(1, Math.min(current - 2, total - 4));
  const end = Math.min(total, Math.max(current + 2, 5));
  const pages: number[] = [];
  for (let p = Math.max(1, start); p <= end; p++) pages.push(p);
  return pages;
}

export function LeadSourceTracking({ leadSources, page, onPageChange }: LeadSourceTrackingProps) {
  const result = leadSources.data;
  const rows = result?.data ?? [];
  const totalPages = result?.pages ?? 1;

  return (
    <div>
      <SectionHeader number="09" title="Lead source tracking" />
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60">
                {HEADERS.map((h) => (
                  <th
                    key={h}
                    className={cn(
                      "text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-[.06em]",
                      ROW_PAD,
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leadSources.loading &&
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {HEADERS.map((h) => (
                      <td key={h} className={ROW_PAD}>
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!leadSources.loading && rows.length === 0 && (
                <tr>
                  <td colSpan={HEADERS.length} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No leads in this range
                  </td>
                </tr>
              )}
              {!leadSources.loading &&
                rows.map((l) => (
                  <tr key={l.leadId} className="border-b border-border hover:bg-muted/55 transition-colors">
                    <td className={ROW_PAD}>
                      <Link
                        to={`/leads/${l.leadId}`}
                        className="font-semibold text-foreground hover:text-primary hover:underline truncate block max-w-[160px]"
                        title={l.name}
                      >
                        {l.name}
                      </Link>
                    </td>
                    <td className={cn("text-muted-foreground truncate max-w-[120px]", ROW_PAD)} title={l.source}>
                      {humanizeStage(l.source)}
                    </td>
                    <td
                      className={cn("text-muted-foreground truncate max-w-[140px]", ROW_PAD)}
                      title={l.campaign ?? ""}
                    >
                      {l.campaign ?? "—"}
                    </td>
                    <td
                      className={cn("text-muted-foreground truncate max-w-[140px]", ROW_PAD)}
                      title={l.adSet ?? ""}
                    >
                      {l.adSet ?? "—"}
                    </td>
                    <td
                      className={cn("text-muted-foreground truncate max-w-[140px]", ROW_PAD)}
                      title={l.ad ?? ""}
                    >
                      {l.ad ?? "—"}
                    </td>
                    <td className={ROW_PAD}>{l.owner ?? "Unassigned"}</td>
                    <td className={ROW_PAD}>{humanizeStage(l.stage)}</td>
                    <td
                      className={cn(
                        "font-semibold",
                        l.enrollmentStatus === "enrolled" ? "text-success" : "text-muted-foreground",
                        ROW_PAD,
                      )}
                    >
                      {l.enrollmentStatus === "enrolled" ? "Enrolled" : "Not enrolled"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!leadSources.loading && result && result.total > 0 && (
          <div className="flex items-center justify-between px-3.5 py-3 border-t border-border bg-muted/60">
            <span className="text-xs text-muted-foreground">
              Showing {rows.length} of {result.total} leads
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
                className="px-2.5 py-1 max-[767px]:min-h-11 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
              >
                Previous
              </button>
              {pageWindow(page, totalPages).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPageChange(p)}
                  className={cn(
                    "w-7 h-7 max-[767px]:h-11 max-[767px]:w-11 rounded-md text-xs font-medium",
                    p === page
                      ? "bg-primary text-primary-foreground border border-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p}
                </button>
              ))}
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
                className="px-2.5 py-1 max-[767px]:min-h-11 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
