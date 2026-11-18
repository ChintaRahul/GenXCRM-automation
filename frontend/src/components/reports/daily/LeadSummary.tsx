import { Link } from "react-router-dom";
import type { DailySummary } from "../../../api/client";
import { SectionHeader } from "./SectionHeader";
import { cn } from "../../../lib/utils";
import { Skeleton } from "../../ui/skeleton";

interface LeadSummaryProps {
  summary: { data: DailySummary | null; loading: boolean };
  leadsLink: (params: Record<string, string>) => string;
  // Date range as ISO days (kept for tile param builders that need it).
  range: { from: string; to: string };
}

const TILES: {
  key: "generated" | "newLeads" | "contacted" | "pending";
  label: string;
  barColor: string;
  params: (range: { from: string; to: string }) => Record<string, string>;
}[] = [
  { key: "generated", label: "Total leads generated", barColor: "bg-primary", params: () => ({}) },
  { key: "newLeads", label: "New leads", barColor: "bg-chart-1", params: () => ({ stage: "NEW" }) },
  { key: "contacted", label: "Contacted leads", barColor: "bg-chart-2", params: () => ({ stage: "CONTACTED" }) },
  { key: "pending", label: "Pending leads", barColor: "bg-warning", params: () => ({ pendingFollowup: "1" }) },
];

export function LeadSummary({ summary, leadsLink, range }: LeadSummaryProps) {
  const data = summary.data;
  const total = data?.generated ?? 0;

  return (
    <section>
      <SectionHeader number="01" title="Lead summary" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {TILES.map((tile) => {
          const value = data ? data[tile.key] : 0;
          const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
          return (
            <Link
              key={tile.key}
              to={leadsLink(tile.params(range))}
              className="bg-card border border-card-border rounded-xl p-5 hover:shadow-md transition-shadow cursor-pointer"
            >
              <p className="text-xs text-muted-foreground">{tile.label}</p>
              {summary.loading ? (
                <Skeleton className="h-7 w-16 mt-1" />
              ) : (
                <p className="font-display text-[26px] font-bold text-foreground mt-1 tabular-nums tracking-tight">
                  {value}
                </p>
              )}
              <div className="h-1 rounded-full bg-muted overflow-hidden mt-2">
                <div className={cn("h-full rounded-full", tile.barColor)} style={{ width: `${pct}%` }} />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
