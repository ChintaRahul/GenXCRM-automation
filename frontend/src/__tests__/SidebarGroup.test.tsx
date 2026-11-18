// frontend/src/__tests__/SidebarGroup.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SidebarGroup } from "../components/layout/SidebarGroup";
import { LayoutDashboard, Target } from "lucide-react";
import type { NavGroup } from "../config/nav";

const group: NavGroup = {
  key: "engage",
  label: "Engage",
  items: [
    { to: "/nurturing", icon: LayoutDashboard, label: "Nurturing" },
    { to: "/templates", icon: Target, label: "Templates", roles: ["DIRECTOR"] },
  ],
};

function renderGroup(props: Partial<React.ComponentProps<typeof SidebarGroup>> = {}) {
  return render(
    <MemoryRouter initialEntries={["/somewhere-else"]}>
      <SidebarGroup group={group} open={false} onToggle={vi.fn()} activePath="/somewhere-else" {...props} />
    </MemoryRouter>,
  );
}

describe("SidebarGroup", () => {
  it("calls onToggle when the header is clicked", () => {
    const onToggle = vi.fn();
    renderGroup({ onToggle });
    fireEvent.click(screen.getByRole("button", { name: /engage/i }));
    expect(onToggle).toHaveBeenCalled();
  });

  it("hides items when closed and shows them when open", () => {
    const { rerender } = renderGroup({ open: false });
    expect(screen.queryByText("Nurturing")).not.toBeInTheDocument();

    rerender(
      <MemoryRouter initialEntries={["/somewhere-else"]}>
        <SidebarGroup group={group} open onToggle={vi.fn()} activePath="/somewhere-else" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Nurturing")).toBeInTheDocument();
  });

  it("filters items by role, and renders nothing (not even the header) when zero items remain visible", () => {
    const directorOnlyGroup: NavGroup = {
      key: "workspace",
      label: "Workspace",
      items: [{ to: "/billing", icon: Target, label: "Billing", roles: ["DIRECTOR"] }],
    };
    const { container } = render(
      <MemoryRouter initialEntries={["/somewhere-else"]}>
        <SidebarGroup
          group={directorOnlyGroup}
          open
          onToggle={vi.fn()}
          activePath="/somewhere-else"
          userRole="SALES_REP"
        />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a teal dot next to the header when closed and containing the active route", () => {
    render(
      <MemoryRouter initialEntries={["/templates"]}>
        <SidebarGroup group={group} open={false} onToggle={vi.fn()} activePath="/templates" userRole="DIRECTOR" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("group-active-dot")).toBeInTheDocument();
  });

  it("shows an amber badge count next to the header when closed and an item has a positive badge", () => {
    const groupWithBadge: NavGroup = {
      key: "quoting",
      label: "Quoting",
      items: [{ to: "/approvals", icon: Target, label: "Approvals", badge: () => 3 }],
    };
    render(
      <MemoryRouter initialEntries={["/somewhere-else"]}>
        <SidebarGroup group={groupWithBadge} open={false} onToggle={vi.fn()} activePath="/somewhere-else" />
      </MemoryRouter>,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
