// frontend/src/components/layout/SidebarGroup.tsx
import { NavLink } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";
import { isActiveRoute, type NavGroup } from "../../config/nav";
import type { Role } from "../../types";

interface SidebarGroupProps {
  group: NavGroup;
  open: boolean;
  onToggle: () => void;
  activePath: string;
  userRole?: Role;
}

export function SidebarGroup({ group, open, onToggle, activePath, userRole }: SidebarGroupProps) {
  const visibleItems = group.items.filter(
    (item) => !item.roles || (userRole && item.roles.includes(userRole)),
  );
  if (visibleItems.length === 0) return null;

  const hasActiveItem = visibleItems.some((item) => isActiveRoute(item.to, activePath));
  const badgeTotal = visibleItems.reduce((sum, item) => sum + (item.badge?.() ?? 0), 0);

  return (
    <div>
      <button
        type="button"
        data-tour-group={group.label}
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-1.5 max-[799px]:min-h-11 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-sidebar-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5">
          {group.label}
          {!open && hasActiveItem && (
            <span
              data-testid="group-active-dot"
              className="w-1.5 h-1.5 rounded-full bg-primary"
              aria-hidden="true"
            />
          )}
          {!open && badgeTotal > 0 && (
            <span className="text-[10px] font-bold text-amber-600 tabular-nums">{badgeTotal}</span>
          )}
        </span>
        <ChevronDown
          className={cn("w-3.5 h-3.5 transition-transform duration-150", !open && "-rotate-90")}
        />
      </button>
      {open && (
        <div className="space-y-0.5 pb-1">
          {visibleItems.map(({ to, icon: Icon, label, badge }) => {
            const count = badge?.();
            return (
              <NavLink
                key={to}
                to={to}
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
                {!!count && count > 0 && (
                  <span className="ml-auto text-[11px] font-bold text-amber-600 tabular-nums">{count}</span>
                )}
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}
