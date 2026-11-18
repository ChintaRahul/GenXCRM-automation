import type { StatusReportRow } from "../../../api/client";
import { SectionHeader } from "./SectionHeader";
import { HBarChart } from "./HBarChart";
import { Skeleton } from "../../ui/skeleton";

interface LeadStatusReportProps {
  status: { data: StatusReportRow[] | null; loading: boolean };
  leadsLink: (params: Record<string, string>) => string;
}

const STAGE_COLORS: Record<string, string> = {
  INTERESTED: "bg-chart-2",
  FOLLOW_UP_REQUIRED: "bg-chart-3",
  RINGING_NOT_REACHABLE: "bg-muted-foreground",
  NOT_INTERESTED: "bg-chart-5",
  DEMO_SCHEDULED: "bg-chart-1",
  DEMO_ATTENDED: "bg-chart-1",
  ENROLLMENT_PENDING: "bg-primary",
};
const DEFAULT_STAGE_COLOR = "bg-chart-1";

function humanizeStage(stage: string): string {
  return stage
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function LeadStatusReport({ status, leadsLink }: LeadStatusReportProps) {
  const rows = [...(status.data ?? [])].sort((a, b) => b.count - a.count);

  return (
    <div className="bg-card border border-card-border rounded-xl h-full p-5">
      <SectionHeader number="03" title="Lead status report" />
      {status.loading ? (
        <Skeleton className="h-52 w-full" />
      ) : rows.length > 0 ? (
        <HBarChart
          size="md"
          rows={rows.map((r) => ({
            key: r.stage,
            label: humanizeStage(r.stage),
            value: r.count,
            to: leadsLink({ stage: r.stage }),
            color: STAGE_COLORS[r.stage] ?? DEFAULT_STAGE_COLOR,
          }))}
        />
      ) : (
        <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">
          No status data yet
        </div>
      )}
    </div>
  );
}
