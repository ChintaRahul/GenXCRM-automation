import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface SettingsCardProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  // Primary action(s), right-aligned in a footer bar.
  readonly footer?: ReactNode;
  // Red-tinted header for destructive zones (e.g. right to erasure).
  readonly danger?: boolean;
  readonly children: ReactNode;
}

export const SettingsCard = ({ title, description, footer, danger, children }: SettingsCardProps) => (
  <section className={cn("overflow-hidden rounded-xl border bg-card", danger ? "border-destructive-border" : "border-border")}>
    <header className={cn("border-b px-4 py-4 sm:px-5", danger ? "border-destructive-border bg-destructive-soft" : "border-border")}>
      <h2 className={cn("text-[15px] font-semibold", danger ? "text-destructive" : "text-foreground")}>{title}</h2>
      {description && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>}
    </header>
    <div className="divide-y divide-border">{children}</div>
    {footer && <footer className="flex justify-end gap-2 border-t border-border bg-card-subtle px-4 py-3 sm:px-5">{footer}</footer>}
  </section>
);
