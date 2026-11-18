import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import type { ProductTourState } from "../../hooks/useProductTour";
import { TourOverlay } from "../onboarding/TourOverlay";
import { TourCard } from "../onboarding/TourCard";
import { TourWelcomeModal } from "../onboarding/TourWelcomeModal";
import { TourDoneModal } from "../onboarding/TourDoneModal";
import { TourLauncher } from "../onboarding/TourLauncher";
import { useTourTarget } from "../onboarding/useTourTarget";
import { useViewportMode } from "../../hooks/useViewportMode";

interface Props {
  readonly tour: ProductTourState;
  // Whether the mobile navigation drawer is open (click steps point at the menu button until it is).
  readonly navOpen: boolean;
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

// Guided tour: welcome modal → click-the-real-sidebar-item steps with info steps in between →
// done modal. State and navigation live in useProductTour; this only renders it.
export function ProductTour({ tour, navOpen }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // On a phone the floating launcher would sit over a record page's forms (e.g. the line items' Add row).
  const hideLauncher = useViewportMode() === "drawer" && /^\/[^/]+\/[0-9a-f-]{36}$/i.test(pathname);
  const { open, step, tour: def, hasBack, next, back, pause, finish, start } = tour;
  const spotlight = open && !!step && step.type !== "modal";
  const target = useTourTarget(step, navOpen, spotlight);
  const fresh = !!step && target.k === step.k;

  // An info step whose target never appears (role- or data-dependent) is skipped.
  useEffect(() => {
    if (spotlight && fresh && target.missing) next();
  }, [spotlight, fresh, target.missing, next]);

  useEffect(() => {
    if (!open || !step) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === "Escape") {
        if (step.k === "done") finish();
        else pause();
      } else if (e.key === "ArrowRight" && step.type === "info") next();
      else if (e.key === "ArrowLeft" && hasBack) back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, hasBack, next, back, pause, finish]);

  if (!open || !step) {
    if (!tour.showLauncher || hideLauncher) return null;
    return (
      <TourLauncher progress={tour.progress} chaptersDone={tour.chaptersDone} total={def.chapters.length} onClick={tour.launch} />
    );
  }

  const rect = fresh ? target.rect : null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[100]">
      {step.type === "modal" ? (
        step.k === "welcome" ? (
          <TourWelcomeModal tour={def} firstName={tour.firstName} onNotNow={pause} onStart={start} />
        ) : (
          <TourDoneModal tour={def} onReplay={start} onFinish={finish} />
        )
      ) : (
        <>
          <TourOverlay rect={rect} clickable={step.type === "click"} />
          {(step.type === "click" || rect) && (
            <TourCard
              step={step}
              chapters={def.chapters}
              rect={rect}
              instruction={fresh ? target.instruction : null}
              hasBack={hasBack}
              onSkip={pause}
              onBack={back}
              onNext={next}
              onTakeMeThere={() => navigate(step.type === "click" ? step.route : "/")}
            />
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
