import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ArrowLeft, LogOut } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { useAuth } from "../../context/AuthContext";
import { NotificationBell } from "./NotificationBell";
import { initials } from "../../lib/utils";
import { useSidebarMode } from "../../hooks/useViewportMode";

interface HeaderProps {
  title: string;
  subtitle?: string;
  // Shown below `sm` instead of `subtitle` when given — the title/subtitle column has much
  // less room on a phone (pl-16 reserves space for the fixed back/menu button, plus the bell
  // and avatar on the right), so a long subtitle can crowd out the part that matters most
  // (see SCRUM-30, where the date was squeezed out entirely on the Dashboard header).
  subtitleMobile?: string;
  // Renders as a pill next to the title instead of stacked below it — for a short label
  // that needs to read as distinct from the title (e.g. a payment gateway name next to the
  // lead's name), not as a description of it. Mutually exclusive with `subtitle`/`subtitleMobile`.
  subtitleBadge?: string;
  actions?: React.ReactNode;
  backTo?: string;
  // Shows the desktop back button (see below) without pinning its destination to a fixed
  // route — handleBack falls through to navigate(-1), so it returns wherever the user
  // actually came from (a filtered list, a notification popover, etc.) instead of always
  // landing on one canonical parent page.
  showBackButton?: boolean;
  // For sub-views that swap in-page state instead of changing route (e.g. a Nurturing
  // sequence detail) — takes over both the desktop and the mobile back button.
  onBack?: () => void;
  hideBell?: boolean;
  // Product-tour hook (`data-tour`) placed on the header's root element.
  tourId?: string;
}

export function Header({
  title,
  subtitle,
  subtitleMobile,
  subtitleBadge,
  actions,
  backTo,
  showBackButton,
  onBack,
  hideBell,
  tourId,
}: HeaderProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isDashboard = location.pathname === "/";
  // In the Manufacturing shell the top-left corner belongs to the sidebar rail / mobile top bar, so
  // the back button sits inline in the header instead of floating over it.
  const sidebarMode = useSidebarMode();
  const inlineBack = sidebarMode !== "legacy";
  // On a phone the top bar already names the page, so a top-level page's own title row is dropped
  // (leaving just its actions + the bell/avatar), and a record page folds Back into its title row.
  const phone = sidebarMode === "drawer";
  const topLevel = location.pathname.split("/").filter(Boolean).length <= 1;
  const compact = phone && topLevel;
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
      document.addEventListener("keydown", handleEscape);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [dropdownOpen]);

  const handleSignOut = () => {
    setDropdownOpen(false);
    signOut();
    navigate("/login");
  };

  const handleBack = () => {
    if (onBack) onBack();
    else if (backTo) navigate(backTo);
    // location.key is "default" when this entry has no in-app back history (e.g. the app
    // was launched/reopened directly on this route) — navigate(-1) would silently no-op
    // there, making the back button look missing/unresponsive (see SCRUM-32).
    else if (location.key === "default") navigate("/");
    else navigate(-1);
  };

  const accountCluster = (
    <>
          {user && !hideBell && <NotificationBell />}

        {user && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={dropdownOpen}
              className="flex items-center justify-center rounded-full ring-2 ring-transparent hover:ring-primary/60 transition-all focus-visible:outline-none focus-visible:ring-primary max-[799px]:h-11 max-[799px]:w-11"
            >
              <Avatar className="w-8 h-8">
                <AvatarFallback className="text-xs font-semibold bg-primary text-primary-foreground">
                  {initials(user.name)}
                </AvatarFallback>
              </Avatar>
            </button>

            {dropdownOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 w-52 max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-card shadow-lg z-50 overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-xs font-medium text-foreground truncate">
                    {user.name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user.email}
                  </p>
                </div>
                <button
                  role="menuitem"
                  onClick={handleSignOut}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:bg-accent transition-colors"
                >
                  <LogOut className="w-4 h-4 text-muted-foreground" />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        )}
    </>
  );

  if (compact) {
    return (
      <div data-tour={tourId} className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background lg:bg-background/80 px-[clamp(14px,3.5vw,24px)] py-2 backdrop-blur-sm">
        <h1 className="sr-only">{title}</h1>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{actions}</div>
        <div className="ml-auto flex flex-shrink-0 items-center gap-2">{accountCluster}</div>
      </div>
    );
  }

  return (
    <div
      data-tour={tourId}
      // Top padding must clear the device status bar/notch on the native (Capacitor) app —
      // same env(safe-area-inset-top) pattern already used for the fixed hamburger/back
      // button below and the toast offset in App.tsx. Without it this sticky header (and
      // its title/date content) renders underneath the system status bar on a real device,
      // making the welcome message and date header invisible even though the DOM is correct
      // and everything looks fine in a browser dev-tools preview (see SCRUM-30).
      className={`flex flex-col lg:flex-row lg:items-center gap-3 ${inlineBack ? "px-[clamp(14px,3.5vw,24px)] pt-[max(0.75rem,env(safe-area-inset-top))]" : "pl-16 pr-4 pt-[max(1rem,env(safe-area-inset-top))]"} pb-4 lg:px-6 lg:pt-4 border-b border-border bg-background lg:bg-background/80 backdrop-blur-sm sticky top-0 z-20`}
    >
      {!isDashboard && !phone && !(inlineBack && topLevel) && (
        <button
          onClick={handleBack}
          aria-label="Go back"
          className={
            inlineBack
              ? "lg:hidden self-start -mb-1 -ml-2 inline-flex items-center gap-1 h-10 px-2 rounded-lg text-sm text-muted-foreground hover:text-foreground"
              : "lg:hidden fixed top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-50 inline-flex items-center justify-center h-11 w-11 rounded-lg bg-card border border-border shadow-md"
          }
        >
          <ChevronLeft className="w-5 h-5" />
          {inlineBack && <span>Back</span>}
        </button>
      )}

      {/* Title and the bell/avatar cluster always share one row, with the bell/avatar
          pinned to its right edge — they must never get pushed onto a later row by a
          long action-button list (see SCRUM-22 follow-up). `lg:contents` dissolves this
          wrapper at the lg breakpoint so title/actions/icons become independent flex
          items of the row below, ordered via lg:order so actions can sit between them
          without disturbing the tight gap between actions and the icons on desktop. */}
      <div className="flex items-center justify-between gap-3 lg:contents">
        <div className="min-w-0 lg:order-1 flex items-center gap-3">
          {phone && !topLevel && (
            <button
              type="button"
              onClick={handleBack}
              aria-label="Go back"
              className="-ml-2 inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          {/* Detail sub-pages (Payment, Invoice, Lead, etc.) aren't reachable from the
              sidebar, so the mobile-only fixed back button above leaves desktop with no
              way back except browser-back. Opt-in via `backTo`/`showBackButton` — top-level
              sidebar pages (Payments, Reports, ...) don't need it (see SCRUM-32). */}
          {(backTo || showBackButton || onBack) && (
            <button
              onClick={handleBack}
              className="hidden lg:inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
          )}
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 min-w-0">
              <h1 className="text-lg font-semibold text-foreground truncate min-w-0" title={title}>
                {title}
              </h1>
              {subtitleBadge && (
                <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
                  {subtitleBadge}
                </span>
              )}
            </div>
            {subtitle && (
              <p
                className={`text-sm text-muted-foreground mt-0.5 line-clamp-2 sm:truncate ${subtitleMobile ? "hidden sm:block" : ""}`}
              >
                {subtitle}
              </p>
            )}
            {subtitleMobile && (
              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2 sm:hidden">
                {subtitleMobile}
              </p>
            )}
          </div>
        </div>

        {/* Pushing this cluster to the row's right edge needs exactly one lg:ml-auto
            among [actions, icons] — two auto margins on the same row split the free
            space between them instead of one owning it. The actions block below claims
            it when actions exist (pushing the actions+icons group right together); this
            cluster claims it only when there's no actions block (e.g. Payments) to push
            it, since it would otherwise sit crowded right against the title. */}
        <div
          className={`flex items-center gap-2 flex-shrink-0 lg:order-3 ${actions ? "" : "lg:ml-auto"}`}
        >
          {accountCluster}
        </div>
      </div>

      {actions && (
        <div className="flex items-center gap-2 flex-wrap justify-end lg:order-2 lg:ml-auto lg:flex-shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
