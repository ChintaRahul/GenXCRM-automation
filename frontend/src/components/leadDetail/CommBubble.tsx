import { StatusBadge } from "../shared/StatusBadge";
import type { TimelineEvent } from "../../lib/timeline";

type CommEvent = Extract<TimelineEvent, { kind: "communication" }>;

export function CommBubble({ event }: { event: CommEvent }) {
  return (
    <div className="mt-1.5 pl-3 border-l-2 border-primary/30 bg-primary/[0.04] rounded-r-md py-1.5 pr-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        <StatusBadge status={event.commType} />
        <StatusBadge status={event.status} title={event.status === "failed" ? event.error : undefined} />
      </div>
      {event.subject && (
        <p className="text-xs font-medium text-foreground">{event.subject}</p>
      )}
      {event.body && (
        <p className="text-xs text-muted-foreground italic mt-0.5 line-clamp-3">
          "{event.body}"
        </p>
      )}
      {event.status === "failed" && event.error && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{event.error}</p>
      )}
    </div>
  );
}
