interface SectionHeaderProps {
  number?: string; // legacy prop, no longer shown
  title: string;
  hint?: string;
}

export function SectionHeader({ title, hint }: SectionHeaderProps) {
  return (
    <div className="flex items-baseline gap-2.5 mb-3">
      <h3 className="font-display text-[15px] font-semibold text-foreground">{title}</h3>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}
