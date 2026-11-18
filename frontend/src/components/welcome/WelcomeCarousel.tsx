import { useCarousel } from "../../hooks/useCarousel";
import { WELCOME_SLIDES } from "./WelcomeSlides";

interface WelcomeCarouselProps {
  // Sign in / Create account call this so the carousel stops moving once the user acts.
  readonly children: (stop: () => void) => React.ReactNode;
}

// Swipeable 4-slide feature tour with dots, plus the call-to-action block rendered below it.
export function WelcomeCarousel({ children }: WelcomeCarouselProps) {
  const { index, goTo, stop, swipeHandlers } = useCarousel(WELCOME_SLIDES.length);

  return (
    <>
      <div className="min-h-0 flex-1 cursor-grab touch-pan-y overflow-hidden" {...swipeHandlers}>
        <div
          className="flex h-full transition-transform duration-[380ms] ease-[cubic-bezier(.2,.7,.2,1)]"
          style={{ transform: `translateX(${-index * 100}%)` }}
        >
          {WELCOME_SLIDES.map(({ title, body, Visual }, n) => (
            <div key={title} className="flex h-full min-w-0 flex-[0_0_100%] flex-col px-5 pt-1" aria-hidden={n !== index}>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center gap-2 overflow-hidden rounded-[20px] border border-muted bg-muted/60 p-3.5">
                <Visual />
              </div>
              <div className="px-1 pt-4">
                <h2 className="font-display text-2xl font-semibold leading-[1.15] tracking-[-0.01em]">{title}</h2>
                <p className="mt-[7px] text-sm leading-normal text-muted-foreground [text-wrap:pretty]">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-[5px] px-6 pt-3">
        {WELCOME_SLIDES.map(({ title }, n) => (
          <button
            key={title}
            type="button"
            aria-label={`Slide ${n + 1}`}
            aria-current={n === index}
            onClick={() => goTo(n)}
            className={`h-1.5 rounded-[3px] p-0 transition-[width,background-color] duration-[250ms] ${n === index ? "w-5 bg-primary" : "w-1.5 bg-border"}`}
          />
        ))}
      </div>

      {children(stop)}
    </>
  );
}
