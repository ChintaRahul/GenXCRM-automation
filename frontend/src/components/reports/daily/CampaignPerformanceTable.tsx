import type { CampaignPerformanceRow } from "../../../api/client";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";
import { cn } from "../../../lib/utils";
import { Skeleton } from "../../ui/skeleton";

interface CampaignPerformanceTableProps {
  campaigns: { data: CampaignPerformanceRow[] | null; loading: boolean };
}

const HEADERS = ["Campaign", "Leads", "Interested", "Follow-up", "Demo Sched.", "Enroll.", "Conv. rate"];
const ROW_PAD = "py-[11px] px-3.5";

export function CampaignPerformanceTable({ campaigns }: CampaignPerformanceTableProps) {
  const rows = campaigns.data ?? [];
  const totals = rows.reduce(
    (acc, r) => ({
      leads: acc.leads + r.leads,
      interested: acc.interested + r.interested,
      followUp: acc.followUp + r.followUp,
      demoScheduled: acc.demoScheduled + r.demoScheduled,
      enrollments: acc.enrollments + r.enrollments,
    }),
    { leads: 0, interested: 0, followUp: 0, demoScheduled: 0, enrollments: 0 },
  );
  const totalConvRate = totals.leads > 0 ? (totals.enrollments / totals.leads) * 100 : 0;

  return (
    <div>
      <SectionHeader number="06" title="Campaign performance" />
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
              {campaigns.loading &&
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {HEADERS.map((h) => (
                      <td key={h} className={ROW_PAD}>
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!campaigns.loading && rows.length === 0 && (
                <tr>
                  <td colSpan={HEADERS.length} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No campaign data for this range.
                  </td>
                </tr>
              )}
              {!campaigns.loading &&
                rows.map((c) => (
                  <tr key={c.campaignId} className="border-b border-border hover:bg-muted/55 transition-colors">
                    <td
                      className={cn("font-semibold text-foreground truncate max-w-[200px]", ROW_PAD)}
                      title={c.campaignName}
                    >
                      {c.campaignName}
                    </td>
                    <td className={cn("text-right tabular-nums", ROW_PAD)}>{c.leads}</td>
                    <td className={cn("text-right tabular-nums", ROW_PAD)}>{c.interested}</td>
                    <td className={cn("text-right tabular-nums", ROW_PAD)}>{c.followUp}</td>
                    <td className={cn("text-right tabular-nums", ROW_PAD)}>{c.demoScheduled}</td>
                    <td className={cn("text-right tabular-nums", ROW_PAD)}>{c.enrollments}</td>
                    <td className={cn("text-right", ROW_PAD)}>
                      <StatusPill
                        label={`${c.conversionRate.toFixed(1)}%`}
                        tone={c.conversionRate >= 5 ? "success" : "warning"}
                      />
                    </td>
                  </tr>
                ))}
              {!campaigns.loading && rows.length > 0 && (
                <tr className="bg-muted/60 font-bold">
                  <td className={cn("text-foreground", ROW_PAD)}>All campaigns</td>
                  <td className={cn("text-right tabular-nums", ROW_PAD)}>{totals.leads}</td>
                  <td className={cn("text-right tabular-nums", ROW_PAD)}>{totals.interested}</td>
                  <td className={cn("text-right tabular-nums", ROW_PAD)}>{totals.followUp}</td>
                  <td className={cn("text-right tabular-nums", ROW_PAD)}>{totals.demoScheduled}</td>
                  <td className={cn("text-right tabular-nums", ROW_PAD)}>{totals.enrollments}</td>
                  <td className={cn("text-right tabular-nums", ROW_PAD)}>{totalConvRate.toFixed(1)}%</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
