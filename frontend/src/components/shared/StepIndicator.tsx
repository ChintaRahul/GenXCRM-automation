import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
}

// Generic dot/line step indicator — done/current/upcoming states. Mirrors the
// visual pattern used by pages/SignUp.tsx's inline step dots (kept local there
// since it's a one-off 3-step flow) but extracted here since Register now needs
// the same pattern for its 4 steps and a second consumer justifies a shared component.
export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-1.5 mb-6">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = currentStep > n;
        const current = currentStep === n;
        return (
          <div key={label} className={cn("flex items-center gap-1.5", n < steps.length && "flex-1")}>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div
                className={cn(
                  "w-[26px] h-[26px] rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0",
                  done || current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="w-3.5 h-3.5" /> : n}
              </div>
              <span
                className={cn(
                  "text-[12.5px] font-medium whitespace-nowrap",
                  current ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </div>
            {n < steps.length && <div className="flex-1 h-px bg-border mx-0.5" />}
          </div>
        );
      })}
    </div>
  );
}
