import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MousePointerClick } from "lucide-react";
import { Button } from "../ui/button";
import type { TourChapter, TourStep } from "./tourSteps";
import type { TourInstruction, TourRect } from "./useTourTarget";
import { HOLE_PAD } from "./TourOverlay";

const CARD_WIDTH = 340;
const GAP = 14;
const EDGE = 16;
const PHONE_MAX = 600;

type Arrow = { readonly side: "left" | "top" | "bottom"; readonly offset: number };
export interface CardPlacement {
  readonly left: number;
  readonly width: number;
  readonly top?: number;
  readonly bottom?: number;
  readonly arrow?: Arrow;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

// Where the card goes for a given target (README §1 "Placement"). `cardH` is the measured height.
export function placeCard(rect: TourRect | null, cardH: number, vw: number, vh: number): CardPlacement {
  if (vw < PHONE_MAX) {
    const width = vw - 24;
    const lowerHalf = !!rect && rect.top + rect.height / 2 > vh / 2;
    if (!rect) return { left: 12, width, top: Math.max(12, (vh - cardH) / 2) };
    return lowerHalf ? { left: 12, width, top: 12 } : { left: 12, width, bottom: 16 };
  }
  const width = Math.min(CARD_WIDTH, vw - 24);
  if (!rect) return { left: (vw - width) / 2, width, top: Math.max(EDGE, (vh - cardH) / 2) };

  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const centreX = rect.left + rect.width / 2;
  const centreY = rect.top + rect.height / 2;
  const left = (x: number) => clamp(x, EDGE, vw - width - EDGE);
  const top = (y: number) => clamp(y, EDGE, vh - cardH - EDGE);

  // Narrow sidebar item: the card sits to its right.
  if (rect.width < 320 && rect.left < 260 && right + HOLE_PAD + GAP + width + EDGE <= vw) {
    const t = top(centreY - cardH / 2);
    return { left: right + HOLE_PAD + GAP, width, top: t, arrow: { side: "left", offset: clamp(centreY - t - 6, 16, cardH - 28) } };
  }
  // Taller than ~45% of the screen: tuck the card inside its bottom-right corner.
  if (rect.height > vh * 0.45) {
    return { left: left(right - width - EDGE), width, top: top(bottom - cardH - EDGE) };
  }
  if (bottom + HOLE_PAD + GAP + cardH + EDGE <= vh) {
    const l = left(rect.left);
    return { left: l, width, top: bottom + HOLE_PAD + GAP, arrow: { side: "top", offset: clamp(centreX - l - 6, 16, width - 28) } };
  }
  const l = left(rect.left);
  return { left: l, width, top: top(rect.top - HOLE_PAD - GAP - cardH), arrow: { side: "bottom", offset: clamp(centreX - l - 6, 16, width - 28) } };
}

const ARROW_CLASS: Record<Arrow["side"], string> = {
  left: "-left-1.5 border-b border-l",
  top: "-top-1.5 border-l border-t",
  bottom: "-bottom-1.5 border-b border-r",
};

function Instruction({ instruction }: { readonly instruction: TourInstruction }): ReactNode {
  const b = (text: string) => <strong className="font-bold">{text}</strong>;
  switch (instruction.kind) {
    case "menu":
      return <>Tap the {b("menu")} button to open navigation</>;
    case "hover":
      return <>Hover {b(instruction.group)} in the sidebar, then click {instruction.label}</>;
    case "click":
      return <>Click {b(instruction.label)} in the sidebar</>;
    case "group":
      return <>Open the {b(instruction.group)} group, then click {instruction.label}</>;
    case "fallback":
      return <>Use {b("Take me there")} to jump straight in</>;
  }
}

interface TourCardProps {
  readonly step: Exclude<TourStep, { type: "modal" }>;
  readonly chapters: readonly TourChapter[];
  readonly rect: TourRect | null;
  readonly instruction: TourInstruction | null;
  readonly hasBack: boolean;
  readonly onSkip: () => void;
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly onTakeMeThere: () => void;
}

export function TourCard({ step, chapters, rect, instruction, hasBack, onSkip, onBack, onNext, onTakeMeThere }: TourCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(190);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });

  // Measure the real card height after render instead of assuming one.
  useLayoutEffect(() => {
    if (ref.current) setCardH(ref.current.offsetHeight);
  }, [step.k, instruction?.kind]);
  useLayoutEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const placement = placeCard(rect, cardH, viewport.w, viewport.h);
  const chapter = chapters[step.ch];
  const ChapterIcon = chapter.icon;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Product tour"
      className="pointer-events-auto absolute flex flex-col gap-2.5 rounded-xl border border-card-border bg-card px-4 py-3.5 text-card-foreground shadow-[0_24px_48px_-16px_rgba(10,12,18,0.45)]"
      style={{ left: placement.left, width: placement.width, top: placement.top, bottom: placement.bottom }}
    >
      {placement.arrow && (
        <span
          aria-hidden="true"
          className={`absolute h-3 w-3 rotate-45 border-card-border bg-card ${ARROW_CLASS[placement.arrow.side]}`}
          style={placement.arrow.side === "left" ? { top: placement.arrow.offset } : { left: placement.arrow.offset }}
        />
      )}
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-primary-soft text-primary">
          <ChapterIcon className="h-[13px] w-[13px]" />
        </span>
        <span className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-primary-text">{chapter.name}</span>
        <span className="ml-auto font-mono text-[11.5px] text-muted-foreground">
          {step.ch + 1} / {chapters.length}
        </span>
      </div>
      <div className="flex gap-[3px]" aria-hidden="true">
        {chapters.map((c, n) => (
          <span
            key={c.name}
            className={`h-[3px] flex-1 rounded-[2px] ${n < step.ch ? "bg-primary/45" : n === step.ch ? "bg-primary" : "bg-border"}`}
          />
        ))}
      </div>
      <h2 className="font-display text-base font-semibold leading-[1.3]">{step.title}</h2>
      <p className="text-[13px] leading-normal text-muted-foreground [text-wrap:pretty]">{step.body}</p>
      {step.type === "click" && instruction && (
        <div className="flex items-start gap-2 rounded-lg bg-primary-soft px-[11px] py-[9px] text-[12.5px] text-primary-text">
          <MousePointerClick className="mt-px h-[15px] w-[15px] shrink-0" />
          <span>
            <Instruction instruction={instruction} />
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 whitespace-nowrap">
        <button
          type="button"
          onClick={onSkip}
          className="mr-auto text-xs text-muted-foreground hover:text-foreground max-[599px]:min-h-11"
        >
          Skip tour
        </button>
        {hasBack && (
          <Button variant="outline" size="sm" className="h-8 max-[599px]:h-11" onClick={onBack}>
            Back
          </Button>
        )}
        {step.type === "click" ? (
          <Button variant="outline" size="sm" className="h-8 border-primary text-primary max-[599px]:h-11" onClick={onTakeMeThere}>
            Take me there
          </Button>
        ) : (
          <Button size="sm" className="h-8 max-[599px]:h-11" onClick={onNext}>
            Next →
          </Button>
        )}
      </div>
    </div>
  );
}
