import { useEffect, useState } from "react";

const MIN_ROWS = 5;
const MAX_ROWS = 100;
const FALLBACK_ROWS = 25;
// Room kept for a horizontal scrollbar so it never pushes the last row out of view.
const SCROLLBAR_ROOM = 16;

// How many table rows fit the height of `element` (minus the sticky header row), so a list page
// fills the screen exactly with no vertical scrollbar. Null until the element is measured.
export function useFitRows(element: HTMLElement | null, rowHeight: number, headerHeight: number): number | null {
  const [rows, setRows] = useState<number | null>(null);

  useEffect(() => {
    if (!element) return;
    const measure = () => {
      const height = element.getBoundingClientRect().height;
      // No layout (e.g. jsdom): fall back to a sensible default page.
      if (height <= 0) return setRows(FALLBACK_ROWS);
      const fit = Math.floor((height - headerHeight - SCROLLBAR_ROOM) / rowHeight);
      setRows(Math.min(MAX_ROWS, Math.max(MIN_ROWS, fit)));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, rowHeight, headerHeight]);

  return rows;
}
