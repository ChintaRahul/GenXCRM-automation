import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, Check } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "../ui/popover";
import { StatusBadge } from "../shared/StatusBadge";
import { cn } from "../../lib/utils";
import type { LeadStage } from "../../types";

const DEFAULT_STAGES: LeadStage[] = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "RINGING_NOT_REACHABLE",
  "FOLLOW_UP_REQUIRED",
  "CALL_BACK",
  "CALL_NOT_RECEIVED",
  "SWITCHED_OFF",
  "WHATSAPP_SENT",
  "DEMO_SCHEDULED",
  "DEMO_ATTENDED",
  "NEGOTIATION",
  "ENROLLMENT_PENDING",
  "ENROLLED",
  "NOT_INTERESTED",
  "DROPPED",
  "CLOSED_WON",
  "CLOSED_LOST",
];

interface StageCellProps {
  value: LeadStage;
  onChange: (s: LeadStage) => Promise<void> | void;
  stages?: LeadStage[];
  label?: string;
  trigger?: ReactNode;
}

export function StageCell({
  value,
  onChange,
  stages = DEFAULT_STAGES,
  label = "Move to stage",
  trigger,
}: StageCellProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = async (s: LeadStage) => {
    setOpen(false);
    await onChange(s);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="inline-flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity"
            title="Click to change stage"
          >
            <StatusBadge status={value} />
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,220px)]">
        <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {stages.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void handleSelect(s)}
            className={cn(
              "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-colors",
              s === value ? "bg-primary/10" : "hover:bg-muted",
            )}
          >
            <StatusBadge status={s} />
            <div className="flex-1" />
            {s === value && (
              <Check
                className="w-3 h-3 text-primary"
                strokeWidth={2.5}
              />
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
