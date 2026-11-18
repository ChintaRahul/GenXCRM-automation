import type { AdPerformanceRow } from "../../../api/client";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";
import { cn } from "../../../lib/utils";
import { Skeleton } from "../../ui/skeleton";

interface AdPerformanceTableProps {
  ads: { data: AdPerformanceRow[] | null; loading: boolean };
}

const HEADERS = ["Ad", "Leads", "Int.", "Conv.", "CTR", "Conv. rate"];
const ROW_PAD = "py-[11px] px-3.5";

export function AdPerformanceTable({ ads }: AdPerformanceTableProps) {
  const rows = ads.data ?? [];

  return (
    <div>
      <SectionHeader number="08" title="Ad performance" />
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60">
                {HEADERS.map((h, i) => (
                  <th
                    key={h}
                    className={cn(
                      "text-[11px] font-semibold text-muted-foreground uppercase tracking-[.06em]",
                      i === 0 ? "text-left" : "text-right",
                      ROW_PAD,
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ads.loading &&
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {HEADERS.map((h) => (
                      <td key={h} className={ROW_PAD}>
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!ads.loading && rows.length === 0 && (
                <tr>
                  <td colSpan={HEADERS.length} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No ad data for this range.
                  </td>
                </tr>
              )}
              {!ads.loading &&
                rows.map((a) => (
                  <tr key={a.adId} className="border-b border-border hover:bg-muted/55 transition-colors">
                    <td
                      className={cn("font-semibold text-foreground truncate max-w-[220px]", ROW_PAD)}
                      title={a.adName}
                    >
                      {a.adName}
                    </td>
                    <td className={cn("text-right tabular-nums", ROW_PAD)}>{a.leads}</td>
                    <td className={cn("text-right tabular-nums", ROW_PAD)}>{a.interested}</td>
                    <td className={cn("text-right tabular-nums", ROW_PAD)}>{a.enrollments}</td>
                    <td
                      className={cn(
                        "text-right tabular-nums",
                        a.ctr !== null && a.ctr < 1 ? "text-destructive" : "text-foreground",
                        ROW_PAD,
                      )}
                      title={a.ctr === null ? "No data — this ad isn't in the connected Facebook ad account" : undefined}
                    >
                      {a.ctr === null ? "—" : `${a.ctr.toFixed(2)}%`}
                    </td>
                    <td className={cn("text-right", ROW_PAD)}>
                      <StatusPill
                        label={`${a.conversionRate.toFixed(1)}%`}
                        tone={a.conversionRate >= 5 ? "success" : "warning"}
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
