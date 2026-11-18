import { LoadError } from "../shared/LoadError";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useLeads } from "../../hooks/useLeads";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { StatusBadge } from "../shared/StatusBadge";
import { ScoreBar } from "../leads/ScoreBar";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { timeAgo } from "../../lib/utils";

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const COLS = ["Lead", "Stage", "Source", "Score", "Owner", ""];

export function RecentLeadsCard() {
  const { leads, loading, error, refetch } = useLeads({ limit: 6 });

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-card-border">
        <div>
          <p className="text-sm font-semibold text-foreground">Recent leads</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Live · auto-refreshing
          </p>
        </div>
        <Link
          to="/leads"
          className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline max-[767px]:py-2.5 max-[767px]:-my-2.5"
        >
          View all <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {loading ? (
        <div className="p-5 space-y-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? (
        <LoadError message={error} onRetry={refetch} className="py-12" />
      ) : leads.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No leads yet
        </div>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-card-border">
              {COLS.map((h, i) => (
                <th
                  key={h}
                  className={`${i >= 2 && i <= 4 ? "hidden md:table-cell " : ""}text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide whitespace-nowrap`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr
                key={lead.id}
                className="border-b border-card-border last:border-0 hover:bg-muted/40 transition-colors"
              >
                <td className="px-4 py-2.5 max-w-[150px] md:min-w-[200px] md:max-w-[240px]">
                  <div className="flex items-center gap-2.5">
                    <Avatar className="h-7 w-7 flex-shrink-0">
                      <AvatarFallback className="text-[10px]">
                        {initials(lead.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="max-w-[120px] md:max-w-[200px] font-medium text-foreground truncate">
                            {lead.name}
                          </p>
                        </TooltipTrigger>
                        <TooltipContent>{lead.name}</TooltipContent>
                      </Tooltip>
                      {lead.course && (
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {lead.course}
                        </p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <StatusBadge status={lead.stage} />
                </td>
                <td className="hidden md:table-cell px-4 py-2.5 whitespace-nowrap">
                  <StatusBadge status={lead.source} />
                </td>
                <td className="hidden md:table-cell px-4 py-2.5">
                  <ScoreBar score={lead.score} />
                </td>
                <td className="hidden md:table-cell px-4 py-2.5 whitespace-nowrap">
                  {lead.assignedTo ? (
                    <div className="flex items-center gap-1.5">
                      <Avatar className="h-5 w-5 flex-shrink-0">
                        <AvatarFallback className="text-[9px]">
                          {initials(lead.assignedTo.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs text-foreground truncate max-w-[80px]">
                        {lead.assignedTo.name.split(" ")[0]}
                      </span>
                    </div>
                  ) : (
                    <StatusBadge status="UNASSIGNED" />
                  )}
                </td>
                <td className="px-4 py-2.5 text-right text-[11px] text-muted-foreground/60 whitespace-nowrap tabular-nums">
                  {timeAgo(lead.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
