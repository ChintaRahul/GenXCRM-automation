import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "../../../lib/utils";

export interface HBarRow {
  key: string;
  label: string;
  value: number;
  color?: string; // tailwind bg-* class, defaults to bg-chart-1
  to?: string; // makes the whole row a link
  right?: ReactNode; // overrides the default right-aligned value display
}

interface HBarChartProps {
  rows: HBarRow[];
  size?: "sm" | "md";
  valueFormatter?: (v: number) => string;
  maxValue?: number;
}

// Replaces the old angled-label Recharts bar chart for the Lead Status report (size "md",
// 22px bars) and the Communication Analytics per-rep chart (size "sm", 18px bars) — plain
// divs, no chart library needed, per the design handoff.
export function HBarChart({ rows, size = "md", valueFormatter, maxValue }: HBarChartProps) {
  const max = maxValue ?? Math.max(...rows.map((r) => r.value), 1);
  const barHeight = size === "sm" ? "h-[18px]" : "h-[22px]";
  const labelWidth = size === "sm" ? "w-[130px]" : "w-[168px]";
  const valueWidth = size === "sm" ? "w-[84px]" : "w-[52px]";

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => {
        const pct = max > 0 ? Math.min(100, (row.value / max) * 100) : 0;
        const rowClass = "flex items-center gap-3";
        const content = (
          <>
            <span
              className={cn("shrink-0 truncate text-xs text-muted-foreground", labelWidth)}
              title={row.label}
            >
              {row.label}
            </span>
            <div className={cn("flex-1 overflow-hidden rounded-[5px] bg-muted", barHeight)}>
              <div
                className={cn("h-full rounded-[5px]", row.color ?? "bg-chart-1")}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={cn("shrink-0 text-right text-xs font-semibold text-foreground tabular-nums", valueWidth)}>
              {row.right ?? (valueFormatter ? valueFormatter(row.value) : row.value)}
            </span>
          </>
        );
        return row.to ? (
          <Link key={row.key} to={row.to} className={cn(rowClass, "rounded hover:bg-muted/50")}>
            {content}
          </Link>
        ) : (
          <div key={row.key} className={rowClass}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
