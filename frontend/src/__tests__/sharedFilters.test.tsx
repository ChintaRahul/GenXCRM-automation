import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ActiveFilterStrip } from "../components/filters/ActiveFilterStrip";
import { DateRangeSelect, EMPTY_DATE_RANGE } from "../components/filters/DateRangeSelect";
import { FiltersTrigger } from "../components/filters/FiltersTrigger";

describe("ActiveFilterStrip", () => {
  it("renders nothing without chips", () => {
    const { container } = render(<ActiveFilterStrip chips={[]} onClearAll={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("removes a single chip and clears all", () => {
    const onRemove = vi.fn();
    const onClearAll = vi.fn();
    render(<ActiveFilterStrip chips={[{ key: "a", label: "Won", onRemove }]} onClearAll={onClearAll} />);
    fireEvent.click(screen.getByLabelText("Remove filter Won"));
    fireEvent.click(screen.getByText("Clear all"));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onClearAll).toHaveBeenCalledOnce();
  });
});

describe("DateRangeSelect", () => {
  it("switches to Custom when a date is edited", () => {
    const onChange = vi.fn();
    render(<DateRangeSelect value={EMPTY_DATE_RANGE} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-09-01" } });
    expect(onChange).toHaveBeenCalledWith({ preset: "custom", from: "2026-09-01", to: "" });
  });

  it("picking a preset clears custom dates", () => {
    const onChange = vi.fn();
    render(<DateRangeSelect value={{ preset: "custom", from: "2026-09-01", to: "" }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Date range preset"), { target: { value: "30d" } });
    expect(onChange).toHaveBeenCalledWith({ preset: "30d", from: "", to: "" });
  });
});

describe("FiltersTrigger", () => {
  it("shows the count badge only when filters are active", () => {
    const { rerender } = render(<FiltersTrigger count={0} onClick={vi.fn()} />);
    expect(screen.queryByText("3")).toBeNull();
    rerender(<FiltersTrigger count={3} onClick={vi.fn()} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
