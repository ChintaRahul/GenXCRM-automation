import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

// Flows longer than this only label the previous / current / next steps.
const COMPACT_THRESHOLD = 7;

export type StepState = "done" | "current" | "upcoming";

export interface StageStepperState {
  readonly steps: readonly { label: string; state: StepState; showLabel: boolean }[];
  readonly compact: boolean;
  readonly heading: string;
  readonly next: string | null;
  // Share of the flow reached, e.g. "40%"; null when the status is outside the flow.
  readonly percent: string | null;
}

// Pure so the Won / not-in-flow / long-flow rules can be unit-tested without rendering.
export const getStageStepperState = (flow: readonly string[], status: string): StageStepperState => {
  const count = flow.length;
  const compact = count > COMPACT_THRESHOLD;
  const index = flow.indexOf(status);
  const won = status === "Won";
  const outOfFlow = index === -1 && !won;

  const steps = flow.map((label, i) => {
    const state: StepState = won || (!outOfFlow && i < index) ? "done" : i === index ? "current" : "upcoming";
    const showLabel = !compact || (!outOfFlow && !won && Math.abs(i - index) <= 1);
    return { label, state, showLabel };
  });

  if (won) return { steps, compact, heading: `Stage ${index === -1 ? count : index + 1} of ${count} · Won`, next: null, percent: "100%" };
  if (outOfFlow) return { steps, compact, heading: `Status: ${status}`, next: null, percent: null };
  return {
    steps,
    compact,
    heading: `Stage ${index + 1} of ${count} · ${status}`,
    next: flow[index + 1] ?? null,
    percent: `${Math.round(((index + 1) / count) * 100)}%`,
  };
};

interface StageStepperProps {
  readonly flow: readonly string[];
  readonly status: string;
}

export const StageStepper = ({ flow, status }: StageStepperProps) => {
  const { steps, compact, heading, next, percent } = getStageStepperState(flow, status);
  const allDone = status === "Won";
  const circle = compact ? "h-[22px] w-[22px]" : "h-[26px] w-[26px]";

  return (
    <div data-testid="status-progress-bar" className="rounded-xl border border-border bg-card-subtle px-4 py-3.5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12.5px]">
        <span className="whitespace-nowrap font-semibold text-foreground">
          {heading}
          {percent && <span className="ml-1.5 font-normal text-muted-foreground">· {percent}</span>}
        </span>
        {allDone && <span className="whitespace-nowrap text-muted-foreground">All stages complete</span>}
        {next && (
          <span className="min-w-0 truncate whitespace-nowrap text-muted-foreground">
            Next: <strong className="font-semibold text-foreground">{next}</strong>
          </span>
        )}
      </div>

      <ol className="flex">
        {steps.map(({ label, state, showLabel }, i) => {
          const first = i === 0;
          const last = i === steps.length - 1;
          const reached = state !== "upcoming";
          const passed = state === "done";
          return (
            <li
              key={label}
              data-testid="status-step"
              data-current={state === "current" ? "true" : undefined}
              data-state={state}
              title={label}
              className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
            >
              <div className="flex w-full items-center">
                <span className={cn("h-0.5 flex-1", first ? "bg-transparent" : reached ? "bg-primary" : "bg-border")} />
                <span
                  className={cn(
                    "flex flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                    circle,
                    state === "done" && "bg-primary text-primary-foreground",
                    state === "current" && "border-2 border-primary bg-card text-primary-text ring-4 ring-primary-soft",
                    state === "upcoming" && "border-[1.5px] border-input-border bg-card text-muted-foreground",
                  )}
                >
                  {state === "done" ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> : i + 1}
                </span>
                <span className={cn("h-0.5 flex-1", last ? "bg-transparent" : passed ? "bg-primary" : "bg-border")} />
              </div>
              {showLabel && (
                <span
                  className={cn(
                    "w-full truncate px-0.5 text-center text-xs",
                    // Per-step labels need room: long flows only get them from md up, short flows
                    // keep just the current label on phones (the header names current + next anyway).
                    compact ? "hidden md:block" : state === "current" ? "block" : "hidden sm:block",
                    state === "current" ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
};
