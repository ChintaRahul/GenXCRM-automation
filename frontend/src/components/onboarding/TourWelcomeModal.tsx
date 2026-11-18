import type { TourDefinition } from "./tourSteps";

interface TourWelcomeModalProps {
  readonly tour: TourDefinition;
  readonly firstName: string;
  readonly onNotNow: () => void;
  readonly onStart: () => void;
}

export function TourWelcomeModal({ tour, firstName, onNotNow, onStart }: TourWelcomeModalProps) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center overflow-y-auto bg-[rgba(10,12,18,0.62)] p-3">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-welcome-title"
        className="flex max-h-full w-full max-w-[460px] flex-col overflow-hidden rounded-[14px] border border-card-border bg-card text-card-foreground shadow-[0_30px_60px_-20px_rgba(10,12,18,0.55)]"
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <img src="/logo-mark.png" alt="" className="h-10 w-10" />
          <h2 id="tour-welcome-title" className="mt-3 font-display text-xl font-semibold">
            {firstName ? `Welcome to GenX CRM, ${firstName}` : "Welcome to GenX CRM"}
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-normal text-muted-foreground [text-wrap:pretty]">{tour.welcomeBody}</p>
          <ul className="mt-4 space-y-2.5">
            {tour.chapters.map(({ name, icon: Icon, blurb }, n) => (
              <li key={name} className="flex items-center gap-3">
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold" title={name}>
                    {name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground" title={blurb}>
                    {blurb}
                  </span>
                </span>
                <span className="font-mono text-xs text-muted-foreground/70">{String(n + 1).padStart(2, "0")}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <p className="min-w-[160px] flex-1 text-xs text-muted-foreground">Replay any time from the Take the tour button.</p>
          <button
            type="button"
            onClick={onNotNow}
            className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted max-[599px]:min-h-11"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onStart}
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 max-[599px]:min-h-11"
          >
            Start the tour →
          </button>
        </div>
      </div>
    </div>
  );
}
