import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FiltersButton } from "../components/leads/FiltersButton";
import { emptyLeadFilters } from "../components/leads/FiltersDrawer";

describe("FiltersButton", () => {
  it("renders with no count badge when no filters are active", () => {
    render(<FiltersButton filters={emptyLeadFilters()} onClick={vi.fn()} />);
    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });

  it("shows the active facet count when filters are set", () => {
    render(
      <FiltersButton
        filters={{ ...emptyLeadFilters(), stages: ["NEW"], hotOnly: true }}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<FiltersButton filters={emptyLeadFilters()} onClick={onClick} />);
    fireEvent.click(screen.getByText("Filters"));
    expect(onClick).toHaveBeenCalled();
  });
});
