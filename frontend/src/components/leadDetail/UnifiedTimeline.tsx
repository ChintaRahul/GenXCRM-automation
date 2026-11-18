import { FileText, Send, CreditCard, Phone } from "lucide-react";
import { CommBubble } from "./CommBubble";
import { CallWaveform } from "./CallWaveform";
import { timeAgo } from "../../lib/utils";
import type { TimelineEvent } from "../../lib/timeline";

const DOT_STYLES: Record<TimelineEvent["kind"], string> = {
  activity: "bg-chart-1/15 text-chart-1",
  communication: "bg-chart-2/15 text-chart-2",
  payment: "bg-chart-3/15 text-chart-3",
  callRecording: "bg-chart-4/15 text-chart-4",
};

const DOT_ICONS: Record<TimelineEvent["kind"], typeof FileText> = {
  activity: FileText,
  communication: Send,
  payment: CreditCard,
  callRecording: Phone,
};

function eventLabel(event: TimelineEvent): string {
  switch (event.kind) {
    case "activity":
      return event.activityType
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/^\w/, (c) => c.toUpperCase());
    case "communication":
      return `${event.commType.charAt(0)}${event.commType.slice(1).toLowerCase()} sent`;
    case "payment":
      return `Payment ${event.status.toLowerCase()}`;
    case "callRecording":
      return "Call recorded";
  }
}

function eventSubline(event: TimelineEvent): string | undefined {
  if (event.kind === "activity") return event.userName;
  if (event.kind === "payment")
    return `₹${event.amount.toLocaleString("en-IN")} · ${event.gateway}`;
  return undefined;
}

interface UnifiedTimelineProps {
  events: TimelineEvent[];
}

export function UnifiedTimeline({ events }: UnifiedTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="bg-card border border-card-border rounded-xl p-8 text-center text-sm text-muted-foreground">
        No activity yet
      </div>
    );
  }

  return (
    <div className="bg-card border border-card-border rounded-xl p-4">
      <p className="text-sm font-semibold text-foreground mb-4">
        Activity timeline
      </p>
      <div className="relative pl-8">
        <div className="absolute left-[13px] top-1 bottom-1 w-px bg-card-border" />
        <div className="space-y-4">
          {events.map((event) => {
            const Icon = DOT_ICONS[event.kind];
            const subline = eventSubline(event);
            return (
              <div key={`${event.kind}-${event.id}`} className="relative">
                <div
                  className={`absolute -left-8 w-[26px] h-[26px] rounded-full flex items-center justify-center ${DOT_STYLES[event.kind]}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-medium text-foreground">
                    {eventLabel(event)}
                  </p>
                  <span className="text-[10px] text-muted-foreground/70 flex-shrink-0">
                    {timeAgo(event.at)}
                  </span>
                </div>
                {subline && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {subline}
                  </p>
                )}
                {event.kind === "activity" && event.note && (
                  <div className="mt-1.5 pl-3 border-l-2 border-card-border">
                    <p className="text-xs text-foreground">{event.note}</p>
                  </div>
                )}
                {event.kind === "communication" && <CommBubble event={event} />}
                {event.kind === "callRecording" && (
                  <CallWaveform
                    id={event.id}
                    durationSec={event.durationSec}
                    recordingId={event.recordingId}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
