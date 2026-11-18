import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useReadableModules } from "./useReadableModules";
import { hasSeenTour, readTourRecord, writeTourRecord } from "../lib/firstRun";
import { TOURS, allowedRoutes, isStepAllowed, neighbourStep } from "../components/onboarding/tourSteps";

interface TourState {
  readonly userId: string | null;
  readonly i: number;
  readonly done: boolean;
  readonly open: boolean;
  readonly hidden: boolean;
}

const EMPTY: TourState = { userId: null, i: 0, done: false, open: false, hidden: false };

// Guided product tour state: which step the user is on, whether the tour is open, and where
// they left off (`genx-tour-v1:{userId}`). Click steps advance when the route changes; info
// steps advance on Next. Auto-opens the welcome modal once per user, never while impersonating.
export function useProductTour(onNavOpenChange: (open: boolean) => void = () => {}) {
  const { user, isImpersonating } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const readable = useReadableModules();
  const workspaceType = user?.org?.workspaceType ?? "EDTECH";
  const tour = TOURS[workspaceType];
  const allowed = useMemo(() => allowedRoutes(workspaceType, readable), [workspaceType, readable]);
  const userId = user?.id ?? null;

  const [state, setState] = useState<TourState>(EMPTY);

  // Load this user's saved progress; a brand-new user gets the welcome modal.
  useEffect(() => {
    if (!userId) {
      setState(EMPTY);
      return;
    }
    const saved = readTourRecord(userId);
    if (saved) {
      setState({ userId, ...saved, hidden: saved.hidden === true, open: false });
    } else if (hasSeenTour(userId) || isImpersonating) {
      setState({ userId, i: 0, done: false, open: false, hidden: false });
    } else {
      writeTourRecord(userId, { i: 0, done: false });
      setState({ userId, i: 0, done: false, open: true, hidden: false });
    }
  }, [userId, isImpersonating]);

  const lastIndex = tour.steps.length - 1;
  const i = Math.min(state.i, lastIndex);
  const step = tour.steps[i];
  const open = state.open && state.userId === userId && !!user;

  const go = useCallback(
    (next: Partial<Omit<TourState, "userId">>) => {
      setState((prev) => {
        const merged = { ...prev, ...next };
        if (prev.userId && !isImpersonating) writeTourRecord(prev.userId, { i: merged.i, done: merged.done, hidden: merged.hidden });
        return merged;
      });
    },
    [isImpersonating],
  );

  const finish = useCallback(() => {
    onNavOpenChange(false);
    go({ i: lastIndex, done: true, open: false });
  }, [go, lastIndex, onNavOpenChange]);

  const next = useCallback(() => {
    const n = neighbourStep(tour.steps, i, 1, allowed);
    if (n < 0) finish();
    else go({ i: n, open: true });
  }, [tour.steps, i, allowed, go, finish]);

  const prevIndex = neighbourStep(tour.steps, i, -1, allowed, true);
  const hasBack = prevIndex >= 0 && tour.steps[prevIndex].type === "info";
  // Back skips click steps: it returns to the previous info step (and that step's route).
  const back = useCallback(() => {
    if (hasBack) go({ i: prevIndex });
  }, [hasBack, prevIndex, go]);

  const pause = useCallback(() => {
    onNavOpenChange(false);
    go({ open: false, hidden: true });
  }, [go, onNavOpenChange]);

  // From the welcome modal / done modal: jump to the first real step.
  const start = useCallback(() => {
    const n = neighbourStep(tour.steps, 0, 1, allowed);
    if (n < 0) finish();
    else go({ i: n, done: false, open: true });
  }, [tour.steps, allowed, go, finish]);

  // Launcher: resume where the user left off, or open the welcome modal for a first/repeat run.
  const launch = useCallback(() => {
    if (state.done || i === 0) go({ i: 0, done: false, open: true });
    else go({ open: true });
  }, [state.done, i, go]);

  // Entering an info step on another route navigates there; a click step completes as soon as
  // the router lands on its route (also when the user is already there).
  const enteredRef = useRef(-1);
  useEffect(() => {
    if (!open || !step || step.type === "modal") {
      enteredRef.current = -1;
      return;
    }
    if (!isStepAllowed(step, allowed)) {
      next();
      return;
    }
    if (step.type === "click" && pathname === step.route) {
      onNavOpenChange(false);
      next();
      return;
    }
    if (step.type === "info" && enteredRef.current !== i && pathname !== step.route) navigate(step.route);
    enteredRef.current = i;
  }, [open, i, step, pathname, allowed, next, navigate, onNavOpenChange]);

  const progress: "never" | "paused" | "finished" = state.done ? "finished" : i === 0 ? "never" : "paused";
  const chaptersDone = state.done ? tour.chapters.length : Math.max(0, Math.min(step?.ch ?? 0, tour.chapters.length));

  return {
    open,
    // Launcher shows while the tour is closed, unless the user dismissed it (Not now / Skip / Esc).
    showLauncher: !open && !state.hidden && !!user && !isImpersonating,
    tour,
    index: i,
    step,
    progress,
    chaptersDone,
    firstName: user?.name?.trim().split(/\s+/)[0] ?? "",
    hasBack,
    start,
    next,
    back,
    pause,
    finish,
    launch,
  };
}

export type ProductTourState = ReturnType<typeof useProductTour>;
