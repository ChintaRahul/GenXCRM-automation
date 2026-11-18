import { useCallback, useEffect, useRef, useState } from "react";

const SWIPE_THRESHOLD = 40;
const AUTO_ADVANCE_MS = 4500;

// Swipeable carousel state: current slide, pointer-swipe handlers, and auto-advance that stops
// for good once the user interacts (swipe, dot tap or `stop()`).
export function useCarousel(count: number, autoAdvance = true) {
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);
  const startX = useRef<number | null>(null);

  useEffect(() => {
    if (!autoAdvance || stopped) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), AUTO_ADVANCE_MS);
    return () => window.clearInterval(timer);
  }, [autoAdvance, stopped, count]);

  const stop = useCallback(() => setStopped(true), []);
  const goTo = useCallback(
    (i: number) => {
      setStopped(true);
      setIndex(Math.max(0, Math.min(count - 1, i)));
    },
    [count],
  );

  const swipeHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      startX.current = e.clientX;
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (startX.current === null) return;
      const dx = e.clientX - startX.current;
      startX.current = null;
      if (Math.abs(dx) > SWIPE_THRESHOLD) goTo(index + (dx < 0 ? 1 : -1));
    },
    onPointerCancel: () => {
      startX.current = null;
    },
  };

  return { index, goTo, stop, swipeHandlers };
}
