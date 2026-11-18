import { useState, type FormEvent } from "react";
import { Button } from "./button";
import { useViewportMode } from "../../hooks/useViewportMode";
import { cn } from "../../lib/utils";

function getPageNumbers(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7)
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  if (page <= 3) return [1, 2, 3, 4, "…", totalPages];
  if (page >= totalPages - 2)
    return [1, "…", totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, "…", page - 1, page, page + 1, "…", totalPages];
}

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  className,
}: PaginationProps) {
  const [jump, setJump] = useState("");
  const phone = useViewportMode() === "drawer";
  if (totalPages <= 1) return null;

  // Typed page numbers are clamped into range, so 0 or 999 land on the first / last page.
  const goToTyped = (event: FormEvent) => {
    event.preventDefault();
    const target = Number(jump);
    if (!Number.isInteger(target)) return;
    onPageChange(Math.min(totalPages, Math.max(1, target)));
    setJump("");
  };

  if (phone) {
    return (
      <div className="flex w-full items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
        >
          Previous
        </Button>
        <form
          onSubmit={goToTyped}
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          Page
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={totalPages}
            value={jump}
            onChange={(e) => setJump(e.target.value)}
            onBlur={() => setJump("")}
            placeholder={String(page)}
            aria-label="Go to page (type a number and press Go)"
            className="h-11 w-16 rounded-md border border-input bg-background px-2 text-center text-base text-foreground"
          />
          of {totalPages}
        </form>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          Next
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page === 1}
      >
        Previous
      </Button>
      {getPageNumbers(page, totalPages).map((p, i) =>
        p === "…" ? (
          <span
            key={`ellipsis-${i}`}
            className="px-1 text-xs text-muted-foreground select-none"
          >
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            className={cn(
              "min-w-[28px] h-[28px] px-2 flex items-center justify-center rounded text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              page === p
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {p}
          </button>
        ),
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
      >
        Next
      </Button>
      <form
        onSubmit={goToTyped}
        className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <label htmlFor="pagination-jump">Go to</label>
        <input
          id="pagination-jump"
          type="number"
          inputMode="numeric"
          min={1}
          max={totalPages}
          value={jump}
          onChange={(e) => setJump(e.target.value)}
          placeholder={`1–${totalPages}`}
          aria-label="Go to page"
          className="h-7 w-16 rounded-md border border-input bg-background px-2 text-xs text-foreground max-[767px]:h-11 max-[767px]:text-base"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={jump === ""}
        >
          Go
        </Button>
      </form>
    </div>
  );
}
