import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SidebarCollapsedRail } from "../components/layout/SidebarCollapsedRail";
import { LayoutDashboard, Zap, Target } from "lucide-react";
import type { NavItem, NavGroup } from "../config/nav";

const pinned: NavItem[] = [{ to: "/", icon: LayoutDashboard, label: "Dashboard" }];
const groups: NavGroup[] = [
  {
    key: "engage",
    label: "Engage",
    items: [
      { to: "/nurturing", icon: Zap, label: "Nurturing" },
      { to: "/templates", icon: Target, label: "Templates", roles: ["DIRECTOR"] },
    ],
  },
];

function renderRail(activePath: string, userRole: "DIRECTOR" | undefined) {
  return render(
    <MemoryRouter initialEntries={[activePath]}>
      <SidebarCollapsedRail pinned={pinned} groups={groups} activePath={activePath} userRole={userRole} />
    </MemoryRouter>,
  );
}

describe("SidebarCollapsedRail", () => {
  it("renders a pinned link for Dashboard", () => {
    renderRail("/somewhere-else", "DIRECTOR");
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute("href", "/");
  });

  it("shows a pop-out card with the group's items on hover", () => {
    renderRail("/somewhere-else", "DIRECTOR");
    fireEvent.mouseEnter(screen.getByRole("button", { name: /engage/i }));
    expect(screen.getByText("Nurturing")).toBeInTheDocument();
    expect(screen.getByText("Templates")).toBeInTheDocument();
  });

  it("hides the pop-out on mouse leave", () => {
    renderRail("/somewhere-else", "DIRECTOR");
    const trigger = screen.getByRole("button", { name: /engage/i });
    fireEvent.mouseEnter(trigger);
    expect(screen.getByText("Nurturing")).toBeInTheDocument();
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByText("Nurturing")).not.toBeInTheDocument();
  });

  it("filters the pop-out's items by role", () => {
    renderRail("/somewhere-else", undefined);
    fireEvent.mouseEnter(screen.getByRole("button", { name: /engage/i }));
    expect(screen.getByText("Nurturing")).toBeInTheDocument();
    expect(screen.queryByText("Templates")).not.toBeInTheDocument();
  });

  it("marks the group icon as active (teal) when it contains the active route", () => {
    renderRail("/nurturing", "DIRECTOR");
    expect(screen.getByRole("button", { name: /engage/i })).toHaveClass("text-sidebar-primary");
  });
});
