import { useEffect, useRef, useState } from "react";
import type { TourStep } from "./tourSteps";

export interface TourRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

// What the card should tell the user to do for a click step (see README §1 "Target resolution").
export type TourInstruction =
  | { readonly kind: "menu" }
  | { readonly kind: "hover"; readonly group: string; readonly label: string }
  | { readonly kind: "click"; readonly label: string }
  | { readonly kind: "group"; readonly group: string; readonly label: string }
  | { readonly kind: "fallback" };

export interface TourTarget {
  // Key of the step this measurement belongs to (a stale one is ignored for a frame after a step change).
  readonly k: string;
  readonly rect: TourRect | null;
  readonly instruction: TourInstruction | null;
  // An info step's target never showed up on its route (role/state dependent) — skip it.
  readonly missing: boolean;
}

export const MENU_BUTTON = 'button[aria-label="Open navigation"]';
const MEASURE_MS = 140;
const MISSING_AFTER_MS = 2000;

// First matching element actually on screen (the sidebar renders twice in some layouts — one
// copy is display:none, and a closed drawer sits off-screen to the left).
const findVisible = (selector: string): HTMLElement | undefined =>
  Array.from(document.querySelectorAll<HTMLElement>(selector)).find((el) => {
    const { width, height, right } = el.getBoundingClientRect();
    return width > 0 && height > 0 && right > 0;
  });

const toRect = (el: Element): TourRect => {
  const { left, top, width, height } = el.getBoundingClientRect();
  return { left, top, width, height };
};

const union = (a: TourRect, b: TourRect): TourRect => {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return {
    left,
    top,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  };
};

// Tall tables / the whole <main> can exceed the viewport: keep the hole on screen.
const clampToViewport = ({ left, top, width, height }: TourRect): TourRect => {
  const l = Math.max(0, left);
  const t = Math.max(0, top);
  return {
    left: l,
    top: t,
    width: Math.max(0, Math.min(left + width, window.innerWidth) - l),
    height: Math.max(0, Math.min(top + height, window.innerHeight) - t),
  };
};

const sameRect = (a: TourRect | null, b: TourRect | null) =>
  a === b ||
  (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

const sameInstruction = (a: TourInstruction | null, b: TourInstruction | null) =>
  JSON.stringify(a) === JSON.stringify(b);

function resolveClickTarget(
  step: Extract<TourStep, { type: "click" }>,
  navOpen: boolean,
): { el: TourRect | null; instruction: TourInstruction } {
  const { route, label, group } = step;
  const menu = findVisible(MENU_BUTTON);
  // 1. Phone layout with the drawer closed: point at the menu button first.
  if (menu && !navOpen) return { el: toRect(menu), instruction: { kind: "menu" } };

  // 2. Icon rail: items inside a group live in a hover flyout.
  const railGroup = group ? findVisible(`[data-tour-rail="${group}"]`) : undefined;
  if (railGroup && group) {
    const fly = findVisible("[data-tour-fly]");
    const rect = fly ? union(toRect(railGroup), toRect(fly)) : toRect(railGroup);
    return { el: rect, instruction: { kind: "hover", group, label } };
  }

  // 3. The link itself.
  const link = findVisible(`aside a[href="${route}"]`);
  if (link) return { el: toRect(link), instruction: { kind: "click", label } };

  // 4. Link not rendered because its group is collapsed.
  const header = group ? findVisible(`[data-tour-group="${group}"]`) : undefined;
  if (header && group) return { el: toRect(header), instruction: { kind: "group", group, label } };

  // 5. Nothing found.
  return { el: null, instruction: { kind: "fallback" } };
}

// Finds and keeps measuring the element the current step points at. Pages render async and the
// sticky header moves things, so it re-measures on an interval as well as on resize/scroll.
export function useTourTarget(step: TourStep | undefined, navOpen: boolean, active: boolean): TourTarget {
  const [target, setTarget] = useState<TourTarget>({ k: "", rect: null, instruction: null, missing: false });
  const scrolledRef = useRef<string>("");

  useEffect(() => {
    if (!active || !step || step.type === "modal") {
      setTarget({ k: "", rect: null, instruction: null, missing: false });
      return;
    }
    const startedAt = Date.now();
    scrolledRef.current = "";

    const measure = () => {
      let rect: TourRect | null;
      let instruction: TourInstruction | null = null;
      if (step.type === "click") {
        const resolved = resolveClickTarget(step, navOpen);
        rect = resolved.el;
        instruction = resolved.instruction;
        const link = findVisible(`aside a[href="${step.route}"]`);
        if (link && scrolledRef.current !== step.k) {
          scrolledRef.current = step.k;
          link.scrollIntoView({ block: "nearest" });
        }
      } else {
        const el = findVisible(step.sel);
        rect = el ? toRect(el) : null;
      }
      const clamped = rect ? clampToViewport(rect) : null;
      const missing = step.type === "info" && !clamped && Date.now() - startedAt > MISSING_AFTER_MS;
      setTarget((prev) =>
        prev.k === step.k && sameRect(prev.rect, clamped) && sameInstruction(prev.instruction, instruction) && prev.missing === missing
          ? prev
          : { k: step.k, rect: clamped, instruction, missing },
      );
    };

    measure();
    const timer = window.setInterval(measure, MEASURE_MS);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [active, step, navOpen]);

  return target;
}
