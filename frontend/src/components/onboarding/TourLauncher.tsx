import { Compass } from "lucide-react";

interface TourLauncherProps {
  readonly progress: "never" | "paused" | "finished";
  readonly chaptersDone: number;
  readonly total: number;
  readonly onClick: () => void;
}

export function TourLauncher({ progress, chaptersDone, total, onClick }: TourLauncherProps) {
  const label = progress === "never" ? "Take the tour" : progress === "paused" ? "Resume tour" : "Replay tour";
  const sub =
    progress === "never"
      ? `2 min · ${total} topics`
      : progress === "paused"
        ? `${chaptersDone} of ${total} done`
        : `All ${total} topics done`;
  const pct = progress === "finished" ? 100 : (chaptersDone / total) * 100;

  return (
    <button
      type="button"
      onClick={onClick}
      // Phones: bottom-left and above the pagination bar, so it never covers the New (+) button
      // or a record page's sticky action bar.
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 flex min-h-[46px] items-center gap-2.5 rounded-full border border-card-border bg-card py-1.5 pl-2 pr-4 text-left text-card-foreground shadow-lg transition-colors hover:border-primary max-[767px]:bottom-[calc(env(safe-area-inset-bottom)+5rem)] max-[767px]:left-4 max-[767px]:right-auto"
    >
      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Compass className="h-4 w-4" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold leading-none">{label}</span>
        <span aria-hidden="true" className="h-[3px] w-11 overflow-hidden rounded-sm bg-border">
          <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
        </span>
        <span className="text-[11px] leading-none text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}
