import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Sun, Moon, Menu, X, Settings, UserCog } from "lucide-react";
import { cn, initials } from "../../lib/utils";
import { useTheme } from "../../lib/theme";
import { useAuth } from "../../context/AuthContext";
import { useLeadStats } from "../../context/LeadStatsContext";
import { useSidebarState } from "../../hooks/useSidebarState";
import { useSidebarMode } from "../../hooks/useViewportMode";
import { NAV, filterNavByReadable, isActiveRoute, type NavItem, type NavGroup } from "../../config/nav";
import { useReadableModules } from "../../hooks/useReadableModules";
import { useMfgLeadsMtd } from "../../hooks/useMfgLeadsMtd";
import { SidebarGroup } from "./SidebarGroup";
import { SidebarSearch } from "./SidebarSearch";
import { SidebarCollapsedRail } from "./SidebarCollapsedRail";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { AccountDialog } from "./AccountDialog";
import { IMPERSONATION_ALLOWED_EMAILS } from "../../config/impersonation";

interface SidebarProps {
  // Lets the layout's mobile top bar open the drawer; standalone use falls back to local state.
  readonly mobileOpen?: boolean;
  readonly onMobileOpenChange?: (open: boolean) => void;
}

export function Sidebar({ mobileOpen: mobileOpenProp, onMobileOpenChange }: SidebarProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const isDashboard = location.pathname === "/";
  const [localMobileOpen, setLocalMobileOpen] = useState(false);
  const mobileOpen = mobileOpenProp ?? localMobileOpen;
  const setMobileOpen = onMobileOpenChange ?? setLocalMobileOpen;
  const mode = useSidebarMode();
  const [accountOpen, setAccountOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const { mtdTotal: edtechLeadsMtd } = useLeadStats();
  const workspaceType = user?.org?.workspaceType ?? "EDTECH";
  const mfgLeadsMtd = useMfgLeadsMtd(workspaceType === "MANUFACTURING", location.pathname);
  const leadsTotal = workspaceType === "MANUFACTURING" ? mfgLeadsMtd : edtechLeadsMtd;
  const readable = useReadableModules();
  const { pinned, groups } = useMemo(
    () => filterNavByReadable(NAV[workspaceType].pinned, NAV[workspaceType].groups, readable),
    [workspaceType, readable],
  );

  // Seeding `defaultOpenGroups` with every group of the current workspace type
  // means a first-ever load (no localStorage yet) shows everything open,
  // matching the pre-Phase-1 flat list's effectively-always-visible items.
  // Any user who has ever toggled anything (including closing everything)
  // keeps their exact saved preference instead.
  const { collapsed: persistedCollapsed, toggleCollapsed, isGroupOpen, toggleGroup, ensureGroupOpen } = useSidebarState(
    groups.map((g) => g.key),
  );
  // The icon rail (768-1099px) overrides the persisted choice; the drawer never uses it.
  const collapsed = mode === "rail" || persistedCollapsed;

  const [filtered, setFiltered] = useState<{
    filteredPinned: NavItem[];
    filteredGroups: NavGroup[];
    matchedGroupKeys: string[];
    active: boolean;
  }>({ filteredPinned: pinned, filteredGroups: groups, matchedGroupKeys: [], active: false });

  const org = user?.org;
  const isOnTrial = org?.planStatus === "TRIAL";
  const daysLeft =
    isOnTrial && org?.trialEndsAt
      ? Math.max(0, Math.ceil((new Date(org.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : null;
  // A trial that ends decades from now is an internal/lifetime org: don't advertise a countdown.
  const showTrialCountdown = daysLeft !== null && daysLeft <= 3650;

  const canImpersonate = !!user?.email && IMPERSONATION_ALLOWED_EMAILS.includes(user.email);

  // The active route's group always opens, even if it was previously closed —
  // matches README §2 ("the group of the active route always opens").
  useEffect(() => {
    const activeGroup = groups.find((g) => g.items.some((i) => isActiveRoute(i.to, location.pathname)));
    if (activeGroup) ensureGroupOpen(activeGroup.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Close the mobile drawer on any navigation — previously only the pinned
  // items and the Impersonate link closed it via their own onClick, leaving
  // every grouped link (Courses, Payments, Nurturing, Team, ...) with the
  // drawer (and its body-scroll lock) stuck open after navigating.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, setMobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [mobileOpen, setMobileOpen]);

  // "No pages match" must reflect what the user actually sees, not just the
  // raw (pre-role-filter) `filteredGroups` count: a pinned-item match (e.g.
  // "dash" matching Dashboard) is a real hit even with zero matching groups,
  // and a group that `SidebarSearch` matched but that role-filters down to
  // zero visible items (SidebarGroup then renders null) is NOT a real hit.
  const hasAnyPinnedMatch = filtered.filteredPinned.length > 0;
  const hasAnyVisibleGroupItem = filtered.filteredGroups.some((g) =>
    g.items.some((item) => !item.roles || (user?.role && item.roles.includes(user.role))),
  );
  const noSearchMatches = filtered.active && !hasAnyPinnedMatch && !hasAnyVisibleGroupItem;

  const navList = (
    <nav className="flex-1 min-h-0 py-2 space-y-1 overflow-y-auto">
      <SidebarSearch pinned={pinned} groups={groups} onFilterChange={setFiltered} searchRecords={workspaceType === "MANUFACTURING"} />

      <div className="px-2 space-y-0.5">
        {filtered.filteredPinned.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 max-[767px]:min-h-11 rounded-lg text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_4px_14px_hsl(var(--sidebar-primary)/0.35)]"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )
            }
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span>{label}</span>
            {label === "Leads" && (
              <span
                aria-label={`${leadsTotal} leads this month (MTD)`}
                className="ml-auto flex items-center gap-1 text-[11px] font-bold tabular-nums bg-sidebar-accent text-foreground px-1.5 py-0.5 rounded"
              >
                <span className="font-medium opacity-70">MTD</span>
                {leadsTotal}
              </span>
            )}
          </NavLink>
        ))}

        {canImpersonate && (
          <NavLink
            to="/impersonation"
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 max-[767px]:min-h-11 rounded-lg text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_4px_14px_hsl(var(--sidebar-primary)/0.35)]"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )
            }
          >
            <UserCog className="w-4 h-4 flex-shrink-0" />
            <span>Impersonate</span>
          </NavLink>
        )}
      </div>

      <div className="px-2 space-y-1">
        {noSearchMatches ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No pages match.</p>
        ) : (
          filtered.filteredGroups.map((group) => (
            <SidebarGroup
              key={group.key}
              group={group}
              open={filtered.active ? filtered.matchedGroupKeys.includes(group.key) : isGroupOpen(group.key)}
              onToggle={() => toggleGroup(group.key)}
              activePath={location.pathname}
              userRole={user?.role}
            />
          ))
        )}
      </div>
    </nav>
  );

  // `forceExpanded` is true for the mobile drawer's render — mobile always shows the
  // full nav list regardless of the desktop rail's collapsed state (they're
  // independent surfaces; a user who collapsed the desktop sidebar and then opens
  // the mobile drawer must still see labels and groups, not the icon rail).
  function renderSidebarContent(forceExpanded: boolean) {
    const isCollapsed = collapsed && !forceExpanded;
    return (
      <div className="flex flex-col h-full">
        <div
          className={cn(
            "flex items-center gap-3 px-4 py-5 border-b border-sidebar-border",
            isCollapsed && "justify-center px-2",
          )}
        >
          <img
            src={isCollapsed && theme === "dark" ? "/logo-mark-white.png" : "/logo-mark.png"}
            alt="GenX CRM"
            className={cn("flex-shrink-0 object-contain", isCollapsed ? "w-10 h-10" : "w-12 h-12")}
          />
          {!isCollapsed && (
            <div>
              <p className="font-display font-bold text-sm text-sidebar-foreground tracking-tight">GenX CRM</p>
              <p className="text-xs text-muted-foreground">
                {workspaceType === "MANUFACTURING" ? "Manufacturing" : "EdTech"} workspace
              </p>
            </div>
          )}
        </div>

        {isCollapsed ? (
          // `overflow-x-visible` is explicit (not the default) because setting
          // only `overflow-y: auto` computes `overflow-x` to `auto` too per the
          // CSS spec, which clips the group pop-out (`SidebarCollapsedRail`)
          // that intentionally renders outside this rail's right edge.
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-visible">
            <SidebarCollapsedRail pinned={pinned} groups={groups} activePath={location.pathname} userRole={user?.role} />
          </div>
        ) : (
          navList
        )}

        {!isCollapsed && showTrialCountdown && (
          <div className="mx-2 mb-2 mt-1 p-3 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30">
            <p className="text-[11px] font-bold text-primary uppercase tracking-wide mb-1">
              Trial · {daysLeft} days left
            </p>
            <p className="text-[11px] text-muted-foreground leading-snug mb-2">
              Upgrade to keep your team, leads &amp; sequences.
            </p>
            <button
              onClick={() => navigate("/billing")}
              className="w-full text-[11px] font-semibold text-white bg-primary rounded-md py-1.5 hover:bg-primary/90 transition-colors"
            >
              Upgrade plan →
            </button>
          </div>
        )}

        <div className={cn("border-t border-sidebar-border p-3 space-y-1", isCollapsed && "px-2")}>
          <button
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className={cn(
              "flex items-center gap-3 w-full px-3 py-2.5 max-[767px]:min-h-11 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors",
              isCollapsed && "justify-center px-2",
            )}
          >
            {theme === "dark" ? <Moon className="w-4 h-4 flex-shrink-0" /> : <Sun className="w-4 h-4 flex-shrink-0" />}
            {!isCollapsed && <span>{theme === "dark" ? "Dark Mode" : "Light Mode"}</span>}
          </button>

          {user && (
            <button
              onClick={() => setAccountOpen(true)}
              className={cn(
                "flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-sidebar-accent transition-colors text-left",
                isCollapsed && "justify-center px-2",
              )}
            >
              <Avatar className="w-7 h-7 flex-shrink-0">
                <AvatarFallback className="text-xs bg-sidebar-primary text-sidebar-primary-foreground">
                  {initials(user.name)}
                </AvatarFallback>
              </Avatar>
              {!isCollapsed && (
                <>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-sidebar-foreground truncate">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{user.role.replace("_", " ")}</p>
                  </div>
                  <Settings className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 ml-auto" />
                </>
              )}
            </button>
          )}

          {/* Collapse toggle only makes sense on desktop — the mobile drawer has its
              own close button (X, top-right) and is never itself "collapsed". */}
          {!forceExpanded && mode !== "rail" && (
            <button
              onClick={toggleCollapsed}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn(
                "hidden lg:flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors",
                isCollapsed && "justify-center px-2",
              )}
            >
              {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              {!isCollapsed && <span>Collapse</span>}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Manufacturing shows one surface at a time: the drawer below 768px, otherwise the sidebar/rail.
  // EdTech (legacy) keeps rendering both and lets CSS pick by the lg breakpoint.
  const showDrawer = mode === "legacy" || mode === "drawer";

  return (
    <>
      {isDashboard && mode === "legacy" && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          className="touch-manipulation lg:hidden fixed top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-50 inline-flex items-center justify-center h-11 w-11 rounded-lg bg-card border border-border shadow-md"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      {showDrawer && mobileOpen && (
        <div className={cn("fixed inset-0 z-40 bg-black/60", mode === "legacy" && "lg:hidden")} onClick={() => setMobileOpen(false)} />
      )}

      {showDrawer && (
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className={cn(
          "fixed left-0 top-0 bottom-0 z-50 bg-sidebar transition-transform duration-200 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
          mode === "legacy" ? "lg:hidden w-[280px]" : "w-[232px] max-w-[86vw]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
          className="touch-manipulation absolute top-[calc(env(safe-area-inset-top)+0.5rem)] right-2 inline-flex items-center justify-center h-11 w-11 rounded-lg hover:bg-sidebar-accent active:bg-sidebar-accent text-sidebar-foreground"
        >
          <X className="w-5 h-5" />
        </button>
        {/* Mobile drawer is always "expanded" — no collapsed rail on mobile. */}
        {renderSidebarContent(true)}
      </aside>
      )}

      {mode !== "drawer" && (
        <aside
          data-testid="sidebar-desktop"
          className={cn(
            "flex-col bg-sidebar border-r border-sidebar-border transition-all duration-200 flex-shrink-0",
            mode === "legacy" ? "hidden lg:flex" : "flex",
            mode === "legacy"
              ? collapsed ? "w-[68px]" : "w-[244px]"
              : collapsed ? "w-[60px]" : "w-[232px]",
          )}
        >
          {renderSidebarContent(false)}
        </aside>
      )}

      <AccountDialog open={accountOpen} onClose={() => setAccountOpen(false)} />
    </>
  );
}
