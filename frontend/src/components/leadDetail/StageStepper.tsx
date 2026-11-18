import { Check, MoreHorizontal } from "lucide-react";
import { StageCell } from "../leads/StageCell";
import { StatusBadge } from "../shared/StatusBadge";
import { cn } from "../../lib/utils";
import type { LeadStage } from "../../types";

const LINEAR_STAGES: { stage: LeadStage; label: string }[] = [
  { stage: "NEW", label: "New" },
  { stage: "CONTACTED", label: "Contacted" },
  { stage: "INTERESTED", label: "Interested" },
  { stage: "DEMO_SCHEDULED", label: "Demo" },
  { stage: "NEGOTIATION", label: "Negotiation" },
  { stage: "ENROLLED", label: "Enrolled" },
];

const OVERFLOW_STAGES: LeadStage[] = [
  "RINGING_NOT_REACHABLE",
  "FOLLOW_UP_REQUIRED",
  "CALL_BACK",
  "CALL_NOT_RECEIVED",
  "SWITCHED_OFF",
  "WHATSAPP_SENT",
  "DEMO_ATTENDED",
  "ENROLLMENT_PENDING",
  "NOT_INTERESTED",
  "DROPPED",
  "CLOSED_WON",
  "CLOSED_LOST",
];

interface StageStepperProps {
  currentStage: LeadStage;
  onChange: (s: LeadStage) => Promise<void> | void;
}

export function StageStepper({ currentStage, onChange }: StageStepperProps) {
  const currentIndex = LINEAR_STAGES.findIndex((s) => s.stage === currentStage);
  const isOffPath = currentIndex === -1;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-card border border-card-border rounded-xl px-4 py-3">
      <div className="flex items-center min-w-0 sm:flex-1 overflow-x-auto">
        <div className="flex items-center min-w-max flex-1">
          {LINEAR_STAGES.map((s, i) => {
            const done = !isOffPath && i < currentIndex;
            const active = !isOffPath && i === currentIndex;
            const clickable = !active;
            return (
              <div
                key={s.stage}
                className="flex items-center flex-1 last:flex-initial"
              >
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => {
                    if (clickable) void onChange(s.stage);
                  }}
                  title={active ? s.label : `Move to ${s.label}`}
                  className={cn(
                    "flex flex-col items-center gap-1 transition-opacity",
                    clickable
                      ? "cursor-pointer hover:opacity-80"
                      : "cursor-default",
                  )}
                >
                  <div
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 flex-shrink-0",
                      done && "bg-chart-2 border-chart-2 text-white",
                      active &&
                        "bg-chart-3/20 border-chart-3 text-chart-3 ring-2 ring-chart-3/30",
                      !done &&
                        !active &&
                        "bg-muted border-card-border text-muted-foreground",
                    )}
                  >
                    {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                  </div>
                  <span
                    className={cn(
                      "text-[10px] whitespace-nowrap",
                      active
                        ? "text-foreground font-semibold"
                        : "text-muted-foreground",
                    )}
                  >
                    {s.label}
                  </span>
                </button>
                {i < LINEAR_STAGES.length - 1 && (
                  <div
                    className={cn(
                      "h-0.5 flex-1 mx-1.5 rounded-full",
                      done ? "bg-chart-2" : "bg-muted",
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:flex-shrink-0">
        {isOffPath && <StatusBadge status={currentStage} className="flex-shrink-0" />}

        <StageCell
          value={currentStage}
          onChange={onChange}
          stages={OVERFLOW_STAGES}
          label="More stages"
          trigger={
            <button
              type="button"
              className="p-1.5 rounded-md hover:bg-muted transition-colors flex-shrink-0"
              title="More stages"
            >
              <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
            </button>
          }
        />

        <button
          type="button"
          disabled={currentStage === "ENROLLED"}
          onClick={() => void onChange("ENROLLED")}
          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:pointer-events-none flex-shrink-0"
        >
          Mark enrolled
        </button>
      </div>
    </div>
  );
}
