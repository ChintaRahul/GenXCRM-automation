import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SavedViewsRow } from "../components/leads/filters/SavedViewsRow";

const renderRow = (activeFilters: Record<string, unknown>, onApply = vi.fn()) => {
  render(<SavedViewsRow views={[]} activeFilters={activeFilters} onApply={onApply} onSaveCurrent={vi.fn()} onDelete={vi.fn()} />);
  return onApply;
};

describe("SavedViewsRow", () => {
  it("applies a view when it is not active", () => {
    const onApply = renderRow({ unassigned: false });
    fireEvent.click(screen.getByRole("button", { name: "Unassigned" }));
    expect(onApply).toHaveBeenCalledWith({ unassigned: true });
  });

  it("clears the filters when the active view is clicked again", () => {
    const onApply = renderRow({ unassigned: true });
    fireEvent.click(screen.getByRole("button", { name: "Unassigned" }));
    expect(onApply).toHaveBeenCalledWith({});
  });
});
