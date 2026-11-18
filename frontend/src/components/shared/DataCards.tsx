import { cn } from "../../lib/utils";

/**
 * Presentational primitives for the "table on desktop, stacked cards on mobile"
 * pattern. Pages render the existing <table> inside `hidden md:block` and a
 * `md:hidden space-y-2` stack of <MobileCard>s mapped from the same data array.
 * No business logic lives here.
 */

export function MobileCard({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-card border border-card-border rounded-xl p-4 space-y-2",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function MobileCardRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span className="text-xs text-muted-foreground flex-shrink-0">
        {label}
      </span>
      <span className="text-sm font-medium text-foreground min-w-0 truncate text-right">
        {children}
      </span>
    </div>
  );
}
