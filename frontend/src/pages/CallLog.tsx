import { Phone, PhoneIncoming, PhoneOutgoing, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Header } from "../components/layout/Header";
import { EmptyState } from "../components/shared/EmptyState";
import { useCallLog } from "../hooks/useCallLog";
import { initials, timeAgo } from "../lib/utils";

function formatDuration(sec: number | null): string {
  if (!sec) return "0:00";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function CallLogPage() {
  const { calls, loading, error } = useCallLog();
  const navigate = useNavigate();

  return (
    <>
      <Header title="Calls" subtitle="Recent call activity" />
      <div className="p-4 sm:p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : calls.length === 0 ? (
          <EmptyState
            icon={<Phone className="w-8 h-8" />}
            title="No calls yet."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {calls.map((call) => {
              const recorded = call.callRecording?.status === "UPLOADED";
              const DirIcon = call.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
              return (
                <li key={call.id}>
                  <div
                    onClick={recorded ? () => navigate(`/leads/${call.lead.id}`) : undefined}
                    className={`flex items-center gap-3 rounded-xl border border-card-border bg-card px-3.5 py-3 ${recorded ? "cursor-pointer hover:bg-accent transition-colors" : ""}`}
                  >
                    <Avatar className="w-9 h-9 flex-shrink-0">
                      <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                        {initials(call.lead.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <DirIcon
                          className={`w-3 h-3 flex-shrink-0 ${call.callOutcome === "NOT_CONNECTED" ? "text-destructive" : "text-primary"}`}
                        />
                        <p className="text-sm font-semibold text-foreground truncate">
                          {call.lead.name}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground truncate font-mono">
                        {call.lead.phone}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {timeAgo(call.sentAt)}
                      </span>
                      {recorded ? (
                        <span className="flex items-center gap-1 text-xs font-mono font-semibold text-primary bg-primary/10 rounded-md px-1.5 py-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {formatDuration(call.durationSec)}
                        </span>
                      ) : call.callOutcome === "NOT_CONNECTED" ? (
                        <span className="text-xs font-medium text-destructive">Not answered</span>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
