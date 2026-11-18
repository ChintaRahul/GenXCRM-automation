import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

// full >= 1100 · rail 768-1099 · drawer < 768
export type ViewportMode = "full" | "rail" | "drawer";
export const FULL_MIN_WIDTH = 1100;
export const RAIL_MIN_WIDTH = 768;

export const modeForWidth = (width: number): ViewportMode =>
  width >= FULL_MIN_WIDTH ? "full" : width >= RAIL_MIN_WIDTH ? "rail" : "drawer";

const currentMode = (): ViewportMode => (typeof window === "undefined" ? "full" : modeForWidth(window.innerWidth));

export function useViewportMode(): ViewportMode {
  const [mode, setMode] = useState<ViewportMode>(currentMode);

  useEffect(() => {
    const update = () => setMode(currentMode());
    window.addEventListener("resize", update);
    update();
    return () => window.removeEventListener("resize", update);
  }, []);

  return mode;
}

// The Manufacturing shell follows the three viewport modes above. EdTech keeps its existing
// behaviour (`legacy`: desktop sidebar from 1024px, mobile drawer below), unchanged.
export type SidebarMode = ViewportMode | "legacy";

export function useSidebarMode(): SidebarMode {
  const { user } = useAuth();
  const viewport = useViewportMode();
  return user?.org?.workspaceType === "MANUFACTURING" ? viewport : "legacy";
}
