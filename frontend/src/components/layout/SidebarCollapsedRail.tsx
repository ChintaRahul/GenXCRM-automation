import { useState } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "../../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { isActiveRoute, type NavItem, type NavGroup } from "../../config/nav";
import type { Role } from "../../types";

interface SidebarCollapsedRailProps {
  pinned: NavItem[];
  groups: NavGroup[];
  activePath: string;
  userRole?: Role;
}

export function SidebarCollapsedRail({
  pinned,
  groups,
  activePath,
  userRole,
}: SidebarCollapsedRailProps) {
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) => !i.roles || (userRole && i.roles.includes(userRole)),
      ),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-col items-center gap-1 px-2 py-2">
        {pinned.map(({ to, icon: Icon, label }) => (
          <Tooltip key={to}>
            <TooltipTrigger asChild>
              <NavLink
                to={to}
                end={to === "/"}
                aria-label={label}
                className={({ isActive }) =>
                  cn(
                    "flex items-center justify-center w-10 h-10 rounded-lg transition-colors",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent",
                  )
                }
              >
                <Icon className="w-4 h-4" />
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}

        <div className="w-8 h-px bg-sidebar-border my-1" />

        {visibleGroups.map((group) => {
          const Icon = group.items[0].icon;
          const isActiveGroup = group.items.some((i) =>
            isActiveRoute(i.to, activePath),
          );
          return (
            <div
              key={group.key}
              data-tour-rail={group.label}
              // `pr-2` (not the pop-out's own margin) extends this wrapper's own
              // hoverable box to butt up against the pop-out with zero dead-space
              // gap in between — an absolutely positioned descendant doesn't
              // enlarge the parent's layout box, so a gap expressed as the
              // pop-out's margin-left is NOT part of this wrapper and moving the
              // cursor through it fires mouseleave before the pop-out is reached.
              className="relative pr-2"
              onMouseEnter={() => setHoveredGroup(group.key)}
              onMouseLeave={() => setHoveredGroup(null)}
            >
              <button
                type="button"
                aria-label={group.label}
                className={cn(
                  "flex items-center justify-center w-10 h-10 rounded-lg transition-colors",
                  isActiveGroup
                    ? "text-sidebar-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent",
                )}
              >
                <Icon className="w-4 h-4" />
              </button>
              {hoveredGroup === group.key && (
                <div data-tour-fly className="absolute left-full top-0 w-[220px] rounded-lg border border-sidebar-border bg-sidebar shadow-lg p-2 z-50">
                  <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {group.label}
                  </p>
                  {group.items.map(({ to, icon: ItemIcon, label }) => (
                    <NavLink
                      key={to}
                      to={to}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm",
                          isActive
                            ? "bg-sidebar-primary text-sidebar-primary-foreground"
                            : "text-sidebar-foreground hover:bg-sidebar-accent",
                        )
                      }
                    >
                      <ItemIcon className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
