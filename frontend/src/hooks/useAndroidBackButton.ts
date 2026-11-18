import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { App as CapacitorApp } from "@capacitor/app";
import { isNative } from "../lib/platform";

// The mobile navigation drawer stays mounted (slid off-screen) while closed, so only an overlay that is
// actually on screen counts as open.
const hasOpenOverlay = (): boolean =>
  [...document.querySelectorAll("[role=dialog],[role=menu],[role=listbox]")].some((el) => {
    const { left, right, width } = el.getBoundingClientRect();
    return width > 0 && right > 0 && left < window.innerWidth;
  });

// Android's back button: close the open dialog / drawer / menu first (Radix closes on Escape), then
// go back a page, and from the dashboard (or a login/signup screen) send the app to the background
// instead of leaving the button dead.
export function useAndroidBackButton(): void {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNative()) return;

    const sub = CapacitorApp.addListener("backButton", ({ canGoBack }) => {
      if (hasOpenOverlay()) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return;
      }
      const atRoot = ["/", "/login", "/signup"].includes(location.pathname);
      if (!atRoot && canGoBack) navigate(-1);
      else if (!atRoot) navigate("/", { replace: true });
      else void CapacitorApp.minimizeApp();
    });

    return () => {
      void sub.then((handle) => handle.remove());
    };
  }, [location.pathname, navigate]);
}
