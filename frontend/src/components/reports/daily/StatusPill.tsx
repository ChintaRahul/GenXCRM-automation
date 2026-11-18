import { cn } from "../../../lib/utils";

export type PillTone = "success" | "warning" | "primary" | "destructive" | "muted";

const TONE_CLASSES: Record<PillTone, string> = {
  success: "bg-success/[.12] text-success",
  warning: "bg-warning/[.14] text-warning",
  primary: "bg-primary/[.12] text-primary",
  destructive: "bg-destructive/[.12] text-destructive",
  muted: "bg-muted text-muted-foreground",
};

export function StatusPill({ label, tone }: { label: string; tone: PillTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        TONE_CLASSES[tone],
      )}
    >
      {label}
    </span>
  );
}
