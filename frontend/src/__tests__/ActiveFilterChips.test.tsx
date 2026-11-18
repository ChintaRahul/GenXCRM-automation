import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ActiveFilterChips } from "../components/leads/ActiveFilterChips";
import { emptyLeadFilters } from "../components/leads/FiltersDrawer";
import type { Team } from "../types";

describe("ActiveFilterChips", () => {
  it("renders nothing when no filters are active", () => {
    const { container } = render(
      <ActiveFilterChips
        filters={emptyLeadFilters()}
        users={[]}
        teams={[]}
        onChange={vi.fn()}
        onClearAll={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one chip per active facet value", () => {
    render(
      <ActiveFilterChips
        filters={{ ...emptyLeadFilters(), stages: ["NEW"], cities: ["Pune"], hotOnly: true }}
        users={[]}
        teams={[]}
        onChange={vi.fn()}
        onClearAll={vi.fn()}
      />,
    );
    expect(screen.getByText("NEW")).toBeInTheDocument();
    expect(screen.getByText("Pune")).toBeInTheDocument();
    expect(screen.getByText("Hot leads only")).toBeInTheDocument();
  });

  it("removing a chip clears only that value", () => {
    const onChange = vi.fn();
    render(
      <ActiveFilterChips
        filters={{ ...emptyLeadFilters(), cities: ["Pune", "Bangalore"] }}
        users={[]}
        teams={[]}
        onChange={onChange}
        onClearAll={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove Pune filter"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ cities: ["Bangalore"] }),
    );
  });

  it("renders a chip labeled with the team name for each active teamIds entry", () => {
    const onChange = vi.fn();
    const teams = [{ id: "team-1", name: "Sales North" } as unknown as Team];
    render(
      <ActiveFilterChips
        filters={{ ...emptyLeadFilters(), teamIds: ["team-1"] }}
        users={[]}
        teams={teams}
        onChange={onChange}
        onClearAll={vi.fn()}
      />,
    );
    expect(screen.getByText("Sales North")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remove Sales North filter"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ teamIds: [] }),
    );
  });

  it("Clear all calls onClearAll", () => {
    const onClearAll = vi.fn();
    render(
      <ActiveFilterChips
        filters={{ ...emptyLeadFilters(), hotOnly: true }}
        users={[]}
        teams={[]}
        onChange={vi.fn()}
        onClearAll={onClearAll}
      />,
    );
    fireEvent.click(screen.getByText("Clear all"));
    expect(onClearAll).toHaveBeenCalled();
  });
});
