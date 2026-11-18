import * as React from "react";
import { cn } from "../../lib/utils";

interface SwitchProps {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly "aria-label"?: string;
  readonly className?: string;
}

// 40×24 track, 18px knob, always bordered so the off state stays visible in both themes.
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, disabled, className, ...aria }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-10 flex-shrink-0 items-center rounded-full border transition-colors after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-primary bg-primary" : "border-input-border bg-input-border",
        className,
      )}
      {...aria}
    >
      <span
        className={cn(
          "inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[2px]",
        )}
      />
    </button>
  ),
);
Switch.displayName = "Switch";
