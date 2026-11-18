import { useState } from "react";
import {
  Check,
  Users,
  Shuffle,
  Zap,
  Edit2,
  Download,
  X,
  Search,
  Trash2,
} from "lucide-react";
import { cn, initials } from "../../lib/utils";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";
import { Input } from "../ui/input";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { StatusBadge } from "../shared/StatusBadge";
import type { LeadStage } from "../../types";
import type { AssignableUser } from "../../hooks/useAssignableUsers";

const STAGES: LeadStage[] = [
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

interface BulkActionBarProps {
  count: number;
  loading?: boolean;
  users: AssignableUser[];
  onAssign: (userId: string) => void;
  onAutoAssign: () => void;
  onEnroll: () => void;
  onChangeStage: (stage: LeadStage) => void;
  onExport: () => void;
  onMarkClosed: () => void;
  onDelete: () => void;
  onClear: () => void;
}

const ACTION_CLS =
  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export function BulkActionBar({
  count,
  loading,
  users,
  onAssign,
  onAutoAssign,
  onEnroll,
  onChangeStage,
  onExport,
  onMarkClosed,
  onDelete,
  onClear,
}: BulkActionBarProps) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = users.filter((u) =>
    u.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl md:rounded-b-none bg-primary/[0.07] border border-primary/20 md:border-b-0 text-xs flex-wrap">
      <div className="w-4 h-4 rounded bg-primary flex items-center justify-center flex-shrink-0">
        <Check
          className="w-2.5 h-2.5 text-primary-foreground"
          strokeWidth={3}
        />
      </div>
      <span className="font-semibold text-primary whitespace-nowrap tabular-nums">
        {count} selected
      </span>
      <span className="text-muted-foreground">·</span>

      <div className="flex items-center gap-0.5 flex-wrap">
        {/* Assign popover */}
        <Popover
          open={assignOpen}
          onOpenChange={(o) => {
            setAssignOpen(o);
            if (!o) setQuery("");
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={loading}
              aria-label="Assign selected leads to a rep"
              className={cn(ACTION_CLS, "text-primary hover:bg-primary/10")}
            >
              <Users className="w-3 h-3" />
              Assign
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(92vw,250px)]">
            <div className="flex items-center gap-2 bg-muted rounded-md px-2.5 py-1.5 mb-1.5">
              <Search className="w-3 h-3 text-muted-foreground shrink-0" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Assign selected to…"
                className="border-0 bg-transparent p-0 h-auto text-xs focus-visible:ring-0 shadow-none"
              />
            </div>
            <div className="max-h-[220px] overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-2 py-3 text-[11px] text-muted-foreground text-center">
                  No match
                </p>
              ) : (
                filtered.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      onAssign(u.id);
                      setAssignOpen(false);
                      setQuery("");
                    }}
                    className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md hover:bg-muted text-left transition-colors"
                  >
                    <Avatar className="w-6 h-6 shrink-0">
                      <AvatarFallback className="text-[9px] bg-primary/10 text-primary font-semibold">
                        {initials(u.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground truncate">
                        {u.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {u.role}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={onAutoAssign}
          disabled={loading}
          title="Distribute selected leads evenly across each team's reps (round robin)"
          className={cn(ACTION_CLS, "text-primary hover:bg-primary/10")}
        >
          <Shuffle className="w-3 h-3" />
          Auto-assign
        </button>

        <button
          type="button"
          onClick={onEnroll}
          disabled
          title="Coming soon"
          className={cn(ACTION_CLS, "text-muted-foreground")}
        >
          <Zap className="w-3 h-3" />
          Enroll in sequence
          <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground px-1 py-px rounded">
            Soon
          </span>
        </button>

        {/* Change stage popover */}
        <Popover open={stageOpen} onOpenChange={setStageOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={loading}
              aria-label="Change stage for selected leads"
              className={cn(ACTION_CLS, "text-primary hover:bg-primary/10")}
            >
              <Edit2 className="w-3 h-3" />
              Change stage
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(92vw,220px)]">
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Move selected to
            </p>
            {STAGES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  onChangeStage(s);
                  setStageOpen(false);
                }}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-muted text-left transition-colors"
              >
                <StatusBadge status={s} />
              </button>
            ))}
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={onExport}
          disabled={loading}
          className={cn(ACTION_CLS, "text-foreground hover:bg-muted")}
        >
          <Download className="w-3 h-3" />
          Export
        </button>
        <button
          type="button"
          onClick={onMarkClosed}
          disabled={loading}
          className={cn(
            ACTION_CLS,
            "text-destructive hover:bg-destructive/10",
          )}
        >
          <X className="w-3 h-3" />
          Mark closed
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={loading}
          title="Archive selected leads"
          className={cn(ACTION_CLS, "text-destructive hover:bg-destructive/10")}
        >
          <Trash2 className="w-3 h-3" />
          Delete
        </button>
      </div>

      <div className="flex-1" />
      <button
        type="button"
        onClick={onClear}
        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
      >
        Clear selection
      </button>
    </div>
  );
}
