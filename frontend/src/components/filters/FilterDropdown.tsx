import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface FilterDropdownProps {
  triggerLabel: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}

// Shared trigger-button + positioned-panel pattern for Stage/Owner/City
// filters: a single control that opens a checklist panel below it, closes on
// an outside click, and lets the parent enforce "only one open at a time" by
// owning `open`/`onToggle`/`onClose` rather than local state here.
export function FilterDropdown({
  triggerLabel,
  open,
  onToggle,
  onClose,
  children,
}: FilterDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onClose]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 text-xs font-medium px-3 py-2 max-[767px]:min-h-11 rounded-md border border-input bg-background text-foreground hover:bg-muted transition-colors"
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div className="absolute top-[calc(100%+6px)] left-0 right-0 z-20 bg-popover border border-border rounded-md shadow-lg p-2">
          {children}
        </div>
      )}
    </div>
  );
}
