import type { AdSetPerformanceRow } from "../../../api/client";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";
import { cn } from "../../../lib/utils";
import { Skeleton } from "../../ui/skeleton";

interface AdSetPerformanceTableProps {
  adSets: { data: AdSetPerformanceRow[] | null; loading: boolean };
}

const HEADERS = ["Ad set", "Leads", "Int.", "Converted students", "Conv. rate"];
const ROW_PAD = "py-[11px] px-3.5";

export function AdSetPerformanceTable({ adSets }: AdSetPerformanceTableProps) {
  const rows = adSets.data ?? [];

  return (
    <div>
      <SectionHeader number="07" title="Ad set performance" />
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
              {adSets.loading &&
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {HEADERS.map((h) => (
                      <td key={h} className={ROW_PAD}>
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!adSets.loading && rows.length === 0 && (
                <tr>
                  <td colSpan={HEADERS.length} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No ad set data for this range.
                  </td>
                </tr>
              )}
              {!adSets.loading &&
                rows.map((a) => (
                  <tr key={a.adSetId} className="border-b border-border hover:bg-muted/55 transition-colors">
                    <td
                      className={cn("font-semibold text-foreground truncate max-w-[220px]", ROW_PAD)}
                      title={a.adSetName}
                    >
                      {a.adSetName}
                    </td>
                    <td className={cn("text-right tabular-nums", ROW_PAD)}>{a.leads}</td>
                    <td className={cn("text-right tabular-nums", ROW_PAD)}>{a.interested}</td>
                    <td className={cn("text-right tabular-nums", ROW_PAD)}>{a.enrollments}</td>
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
