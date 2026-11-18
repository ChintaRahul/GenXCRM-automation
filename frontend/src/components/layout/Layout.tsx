import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { MobileTopBar } from "./MobileTopBar";
import { useSidebarMode } from "../../hooks/useViewportMode";
import TrialBanner from "../shared/TrialBanner";
import TrialExpiredModal from "../shared/TrialExpiredModal";
import ImpersonationBanner from "../shared/ImpersonationBanner";
import { ProductTour } from "../shared/ProductTour";
import { useProductTour } from "../../hooks/useProductTour";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import { LeadStatsProvider } from "../../context/LeadStatsContext";
import { NotificationsProvider } from "../../context/NotificationsContext";

export default function Layout() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const mode = useSidebarMode();
  const [navOpen, setNavOpen] = useState(false);
  const tour = useProductTour(setNavOpen);

  // <main> is the one scrollable container shared by every route (nothing else in the
  // tree scrolls). Without this, navigating away doesn't reset its scrollTop — if the
  // page you're leaving is scrolled far down and the next page is shorter, the browser
  // just clamps scrollTop to the new content's max, which looks like an uncontrolled
  // "jump up" mid-navigation rather than a clean scroll-to-top.
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <LeadStatsProvider>
      <NotificationsProvider>
        <div className="flex h-screen overflow-hidden bg-background">
          <Sidebar mobileOpen={navOpen} onMobileOpenChange={setNavOpen} />
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {mode === "drawer" && <MobileTopBar onMenu={() => setNavOpen(true)} />}
            <ImpersonationBanner />
            <TrialBanner />
            <main ref={mainRef} className="flex-1 overflow-y-auto">
              {/* Keyed by pathname so a crashed page's boundary resets on the next navigation
                  instead of staying stuck on the fallback screen — see SCRUM-32/SCRUM-33. */}
              <ErrorBoundary key={location.pathname}>
                <Outlet />
              </ErrorBoundary>
            </main>
          </div>
          <TrialExpiredModal />
          <ProductTour tour={tour} navOpen={navOpen} />
        </div>
      </NotificationsProvider>
    </LeadStatsProvider>
  );
}
