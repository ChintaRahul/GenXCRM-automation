import type { TourRect } from "./useTourTarget";

export const HOLE_PAD = 6;
const DIM = "pointer-events-auto absolute bg-[rgba(10,12,18,0.62)]";

interface TourOverlayProps {
  // Null = nothing to point at: the whole screen is dimmed.
  readonly rect: TourRect | null;
  // Click steps leave the hole open (and pulsing) so the real element can be clicked;
  // info steps cover it with a transparent blocker.
  readonly clickable: boolean;
}

// Four dim rectangles around the hole (not one big box-shadow) so the hole stays clickable.
export function TourOverlay({ rect, clickable }: TourOverlayProps) {
  if (!rect) return <div className={`${DIM} inset-0`} />;

  const left = Math.max(0, rect.left - HOLE_PAD);
  const top = Math.max(0, rect.top - HOLE_PAD);
  const right = Math.min(window.innerWidth, rect.left + rect.width + HOLE_PAD);
  const bottom = Math.min(window.innerHeight, rect.top + rect.height + HOLE_PAD);
  const hole = { left, top, width: right - left, height: bottom - top };

  return (
    <>
      <div className={DIM} style={{ left: 0, top: 0, right: 0, height: top }} />
      <div className={DIM} style={{ left: 0, top: bottom, right: 0, bottom: 0 }} />
      <div className={DIM} style={{ left: 0, top, width: left, height: hole.height }} />
      <div className={DIM} style={{ left: right, top, right: 0, height: hole.height }} />
      {!clickable && <div className="pointer-events-auto absolute" style={hole} />}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute rounded-[10px] shadow-[0_0_0_2px_hsl(var(--primary))] transition-[left,top,width,height] duration-[180ms] ${clickable ? "genx-tour-pulse" : ""}`}
        style={hole}
      />
    </>
  );
}
