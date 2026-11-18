import { ArrowUp, ArrowDown } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/skeleton";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: { value: string; up: boolean };
  subtitle?: string;
  loading?: boolean;
  accentColor?: string;
  to?: string;
  /** 3px top accent border, e.g. "border-t-primary" — used by the Daily Report KPI tiles.
   *  Its presence switches the card into "KPI tile" layout: no icon row, tighter label. */
  topBorderColor?: string;
  /** Muted/success/destructive delta line under the value, e.g. "▲ 12.4% vs yesterday". */
  delta?: { text: string; tone: "positive" | "negative" | "neutral" };
  /** "xl" is the Daily Report dashboard's 30px Space Grotesk figure; "lg" (default) keeps
   *  every other StatCard consumer's existing 2xl mono value unchanged. */
  valueSize?: "lg" | "xl";
  /** Thin rounded progress bar under the value, e.g. Team Performance's KPI strip.
   *  `colorClass` is a Tailwind background utility, e.g. "bg-primary". */
  progress?: { pct: number; colorClass: string };
}

const DELTA_TONE_CLASSES: Record<NonNullable<StatCardProps["delta"]>["tone"], string> = {
  positive: "text-success",
  negative: "text-destructive",
  neutral: "text-muted-foreground",
};

export function StatCard({
  title,
  value,
  icon,
  trend,
  subtitle,
  loading,
  accentColor = "bg-primary/10",
  to,
  topBorderColor,
  delta,
  valueSize = "lg",
  progress,
}: StatCardProps) {
  const kpiTile = Boolean(topBorderColor);

  if (loading) {
    return (
      <div
        className={cn(
          "bg-card border border-card-border rounded-xl p-5",
          kpiTile && ["border-t-[3px]", topBorderColor],
        )}
      >
        <Skeleton className="h-8 w-8 rounded-lg mb-3" />
        <Skeleton className="h-3 w-20 mb-2" />
        <Skeleton className="h-7 w-16 mb-2" />
        <Skeleton className="h-3 w-24" />
      </div>
    );
  }

  const content = (
    <>
      {!kpiTile && (
        <div className="flex items-start justify-between mb-3">
          <div className={cn("p-2.5 rounded-lg", accentColor)}>{icon}</div>
          {trend && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold",
                trend.up
                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : "bg-red-500/10 text-red-600 dark:text-red-400",
              )}
            >
              {trend.up ? (
                <ArrowUp className="w-2.5 h-2.5" />
              ) : (
                <ArrowDown className="w-2.5 h-2.5" />
              )}
              {trend.value}
            </span>
          )}
        </div>
      )}
      <p
        className={cn(
          "text-muted-foreground",
          kpiTile
            ? "text-[11px] font-semibold uppercase tracking-[.07em]"
            : "text-xs font-medium uppercase tracking-wide",
        )}
      >
        {title}
      </p>
      <p
        className={cn(
          "text-foreground mt-1 tabular-nums tracking-tight",
          valueSize === "xl"
            ? "font-display font-bold text-[30px]"
            : "font-mono text-2xl font-semibold",
        )}
      >
        {value}
      </p>
      {delta && (
        <p className={cn("text-xs font-semibold mt-1", DELTA_TONE_CLASSES[delta.tone])}>{delta.text}</p>
      )}
      {progress && (
        <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-2.5">
          <div
            className={cn("h-full rounded-full transition-all", progress.colorClass)}
            style={{ width: `${Math.min(Math.max(progress.pct, 0), 100)}%` }}
          />
        </div>
      )}
      {subtitle && (
        <p className="text-[11px] text-muted-foreground mt-1">{subtitle}</p>
      )}
    </>
  );

  const cardClass = cn(
    "block bg-card border border-card-border rounded-xl p-5 hover:shadow-md transition-shadow",
    kpiTile && ["border-t-[3px]", topBorderColor],
  );

  if (to) {
    return (
      <Link to={to} className={cn(cardClass, "cursor-pointer")}>
        {content}
      </Link>
    );
  }

  return <div className={cardClass}>{content}</div>;
}
