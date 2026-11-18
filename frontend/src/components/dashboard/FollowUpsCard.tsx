import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Clock } from "lucide-react";
import { Skeleton } from "../ui/skeleton";
import { Button } from "../ui/button";
import { LoadError } from "../shared/LoadError";
import { cn, formatDateTime } from "../../lib/utils";
import { groupFollowUps, type FollowUpBucket } from "../../lib/followUps";
import type { FollowUpLead } from "../../api/client";

const TABS: { key: FollowUpBucket; label: string; tone: string }[] = [
  { key: "overdue", label: "Overdue", tone: "text-destructive" },
  { key: "today", label: "Due today", tone: "text-warning-text" },
  { key: "upcoming", label: "Next 7 days", tone: "text-foreground" },
];

interface FollowUpsCardProps {
  items: FollowUpLead[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onDone: (id: string) => void;
  onSnooze: (id: string) => void;
}

export function FollowUpsCard({ items, loading, error, onRetry, onDone, onSnooze }: FollowUpsCardProps) {
  const groups = useMemo(() => groupFollowUps(items), [items]);
  const [picked, setPicked] = useState<FollowUpBucket | null>(null);
  // Open on the most urgent group that has something in it.
  const tab = picked ?? TABS.find((t) => groups[t.key].length > 0)?.key ?? "today";
  const rows = groups[tab];

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-card-border">
        <p className="text-sm font-semibold text-foreground">Follow-up actions</p>
        <div className="flex flex-wrap gap-1.5 mt-2.5" role="tablist" aria-label="Follow-up groups">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setPicked(t.key)}
              className={cn(
                "px-3 py-1.5 rounded-full border text-xs font-medium max-[767px]:min-h-[44px]",
                tab === t.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-card-border text-muted-foreground hover:bg-muted/40",
              )}
            >
              {t.label}{" "}
              <span className={cn("tabular-nums font-semibold", tab === t.key ? "" : t.tone)}>
                {loading ? "–" : groups[t.key].length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="p-5 space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? (
        <LoadError message={error} onRetry={onRetry} className="py-10" />
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          {items.length === 0
            ? "No follow-ups scheduled. Set one from a lead's page."
            : "Nothing here. You are all caught up."}
        </div>
      ) : (
        <ul>
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 border-b border-card-border last:border-0"
            >
              <div className="min-w-0 flex-1 basis-48">
                <Link
                  to={`/leads/${row.id}`}
                  title={row.name}
                  className="block truncate text-sm font-semibold text-foreground hover:underline"
                >
                  {row.name}
                </Link>
                <p
                  title={row.followUpNote ?? undefined}
                  className="truncate text-xs text-muted-foreground"
                >
                  {row.followUpNote ?? "Follow up"}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
                <Clock className="w-3.5 h-3.5" />
                <span className={cn(tab === "overdue" && "text-destructive font-medium")}>
                  {formatDateTime(row.followUpAt)}
                </span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => onSnooze(row.id)} className="max-[767px]:min-h-[44px]">
                  Snooze
                </Button>
                <Button size="sm" onClick={() => onDone(row.id)} className="max-[767px]:min-h-[44px]">
                  <Check className="w-3.5 h-3.5 mr-1" />
                  Done
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
