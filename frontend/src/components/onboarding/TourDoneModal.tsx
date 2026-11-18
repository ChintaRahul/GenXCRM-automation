import { Check } from "lucide-react";
import type { TourDefinition } from "./tourSteps";

interface TourDoneModalProps {
  readonly tour: TourDefinition;
  readonly onReplay: () => void;
  readonly onFinish: () => void;
}

export function TourDoneModal({ tour, onReplay, onFinish }: TourDoneModalProps) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center overflow-y-auto bg-[rgba(10,12,18,0.62)] p-3">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-done-title"
        className="w-full max-w-[420px] rounded-[14px] border border-card-border bg-card p-5 text-card-foreground shadow-[0_30px_60px_-20px_rgba(10,12,18,0.55)]"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-success-soft text-success-text">
          <Check className="h-5 w-5" />
        </span>
        <h2 id="tour-done-title" className="mt-3 font-display text-xl font-semibold">
          You&apos;re all set
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-normal text-muted-foreground [text-wrap:pretty]">{tour.doneBody}</p>
        <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2">
          {tour.chapters.map(({ name }) => (
            <li key={name} className="flex min-w-0 items-center gap-2 text-[13px]">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-2.5 w-2.5" />
              </span>
              <span className="truncate" title={name}>
                {name}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onReplay}
            className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-primary hover:bg-primary-soft max-[599px]:min-h-11"
          >
            Replay tour
          </button>
          <button
            type="button"
            onClick={onFinish}
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 max-[599px]:min-h-11"
          >
            Start working
          </button>
        </div>
      </div>
    </div>
  );
}
