import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SidebarSearch } from "../components/layout/SidebarSearch";
import { LayoutDashboard, Target, Zap } from "lucide-react";
import type { NavItem, NavGroup } from "../config/nav";

const pinned: NavItem[] = [{ to: "/", icon: LayoutDashboard, label: "Dashboard" }];
const groups: NavGroup[] = [
  {
    key: "engage",
    label: "Engage",
    items: [
      { to: "/nurturing", icon: Zap, label: "Nurturing" },
      { to: "/templates", icon: Target, label: "Templates" },
    ],
  },
];

describe("SidebarSearch", () => {
  it("filters items by case-insensitive label match and reports matched group keys", () => {
    const onFilterChange = vi.fn();
    render(<SidebarSearch pinned={pinned} groups={groups} onFilterChange={onFilterChange} />);

    fireEvent.change(screen.getByPlaceholderText(/find a page/i), { target: { value: "NURTUR" } });

    const lastCall = onFilterChange.mock.calls.at(-1)![0];
    expect(lastCall.active).toBe(true);
    expect(lastCall.matchedGroupKeys).toEqual(["engage"]);
    expect(lastCall.filteredGroups[0].items.map((i: NavItem) => i.label)).toEqual(["Nurturing"]);
    expect(lastCall.filteredPinned).toEqual([]);
  });

  it("reports active: false and the full unfiltered set when the query is empty", () => {
    const onFilterChange = vi.fn();
    render(<SidebarSearch pinned={pinned} groups={groups} onFilterChange={onFilterChange} />);
    const lastCall = onFilterChange.mock.calls.at(-1)![0];
    expect(lastCall.active).toBe(false);
    expect(lastCall.filteredPinned).toEqual(pinned);
    expect(lastCall.filteredGroups).toEqual(groups);
  });

  it("focuses the input on Cmd/Ctrl+K", () => {
    render(<SidebarSearch pinned={pinned} groups={groups} onFilterChange={vi.fn()} />);
    const input = screen.getByPlaceholderText(/find a page/i);
    expect(input).not.toHaveFocus();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(input).toHaveFocus();
  });
});
