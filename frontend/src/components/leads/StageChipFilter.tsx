import { useLeadStats } from "../../context/LeadStatsContext";
import { cn } from "../../lib/utils";

interface StageChipFilterProps {
  activeStage: string;
  onChange: (stage: string) => void;
}

const STAGE_LABELS: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  INTERESTED: "Interested",
  RINGING_NOT_REACHABLE: "Ringing, not reachable",
  FOLLOW_UP_REQUIRED: "Follow up required",
  CALL_BACK: "Call back",
  CALL_NOT_RECEIVED: "Call not received",
  SWITCHED_OFF: "Switch off",
  WHATSAPP_SENT: "Whatsapp sent",
  DEMO_SCHEDULED: "Demo",
  DEMO_ATTENDED: "Demo attended",
  NEGOTIATION: "Negotiation",
  ENROLLMENT_PENDING: "Enrollment pending",
  ENROLLED: "Enrolled",
  NOT_INTERESTED: "Not interested",
  DROPPED: "Dropped",
  CLOSED_WON: "Won",
  CLOSED_LOST: "Lost",
};

export function StageChipFilter({
  activeStage,
  onChange,
}: StageChipFilterProps) {
  const { stats, total } = useLeadStats();

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0">
      <button
        type="button"
        onClick={() => onChange("")}
        className={cn(
          "flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 max-[767px]:min-h-11 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap",
          activeStage === ""
            ? "bg-primary border-primary text-primary-foreground"
            : "bg-card border-card-border text-foreground hover:bg-muted/60",
        )}
      >
        All
        <span
          className={cn(
            "text-[10px] font-bold px-1.5 py-px rounded",
            activeStage === ""
              ? "bg-white/20 text-primary-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {total}
        </span>
      </button>

      {stats.map((s) => (
        <button
          key={s.stage}
          type="button"
          onClick={() => onChange(s.stage)}
          className={cn(
            "flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 max-[767px]:min-h-11 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap",
            activeStage === s.stage
              ? "bg-primary border-primary text-primary-foreground"
              : "bg-card border-card-border text-foreground hover:bg-muted/60",
          )}
        >
          {STAGE_LABELS[s.stage] ?? s.stage.replace(/_/g, " ")}
          <span
            className={cn(
              "text-[10px] font-bold px-1.5 py-px rounded",
              activeStage === s.stage
                ? "bg-white/20 text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {s._count.stage}
          </span>
        </button>
      ))}
    </div>
  );
}
