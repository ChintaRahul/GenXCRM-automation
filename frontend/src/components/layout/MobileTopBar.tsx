import { useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { NAV, isActiveRoute } from "../../config/nav";

interface MobileTopBarProps {
  onMenu: () => void;
}

// 52px bar shown below 768px in place of the sidebar: menu button, logo and the current page's
// title. The sidebar itself slides in as an off-canvas drawer from the menu button.
export function MobileTopBar({ onMenu }: MobileTopBarProps) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { pinned, groups } = NAV[user?.org?.workspaceType ?? "EDTECH"];
  const title =
    [...pinned, ...groups.flatMap((g) => g.items)].find((item) => isActiveRoute(item.to, pathname))?.label ?? "GenX CRM";

  return (
    <div className="flex h-[52px] flex-shrink-0 items-center gap-1 border-b border-border bg-background pl-[max(0.25rem,env(safe-area-inset-left))] pr-3 pt-[env(safe-area-inset-top)] box-content">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open navigation"
        className="touch-manipulation inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg hover:bg-muted"
      >
        <Menu className="h-5 w-5" />
      </button>
      <img src="/logo-mark.png" alt="" className="h-7 w-7 flex-shrink-0 object-contain" />
      <span className="ml-1 min-w-0 truncate font-display text-sm font-semibold text-foreground" title={title}>
        {title}
      </span>
    </div>
  );
}
