import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { StageFilterChips } from "../components/leads/filters/StageFilterChips";

const facets = [
  { value: "NEW" as const, count: 4 },
  { value: "CONTACTED" as const, count: 2 },
];

function noop() {
  /* no-op */
}

describe("StageFilterChips", () => {
  it("shows 'Any stage' on the trigger when nothing is selected", () => {
    render(
      <StageFilterChips
        facets={facets}
        value={[]}
        onChange={vi.fn()}
        open={false}
        onToggle={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByText("Any stage")).toBeInTheDocument();
  });

  it("shows the count of selected stages on the trigger", () => {
    render(
      <StageFilterChips
        facets={facets}
        value={["NEW", "CONTACTED"]}
        onChange={vi.fn()}
        open={false}
        onToggle={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByText("2 stages selected")).toBeInTheDocument();
  });

  it("renders a checklist option per facet with its count when open", () => {
    render(
      <StageFilterChips
        facets={facets}
        value={[]}
        onChange={vi.fn()}
        open
        onToggle={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByText("NEW")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("adds a stage to the selection when its option is checked", () => {
    const onChange = vi.fn();
    render(
      <StageFilterChips
        facets={facets}
        value={[]}
        onChange={onChange}
        open
        onToggle={noop}
        onClose={noop}
      />,
    );
    fireEvent.click(screen.getByText("NEW"));
    expect(onChange).toHaveBeenCalledWith(["NEW"]);
  });

  it("removes a stage from the selection when its checked option is clicked again", () => {
    const onChange = vi.fn();
    render(
      <StageFilterChips
        facets={facets}
        value={["NEW"]}
        onChange={onChange}
        open
        onToggle={noop}
        onClose={noop}
      />,
    );
    fireEvent.click(screen.getByText("NEW", { selector: "span.flex-1" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("calls onToggle when the trigger button is clicked", () => {
    const onToggle = vi.fn();
    render(
      <StageFilterChips
        facets={facets}
        value={[]}
        onChange={vi.fn()}
        open={false}
        onToggle={onToggle}
        onClose={noop}
      />,
    );
    fireEvent.click(screen.getByText("Any stage"));
    expect(onToggle).toHaveBeenCalled();
  });
});
