import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { DateRangeSection, toDateInputValue } from "../components/leads/filters/DateRangeSection";

describe("DateRangeSection", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("'Today' starts at local midnight and 'Last 7 days' spans today plus the 6 days before", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 16, 15, 30)); // 16 Oct 2026, local
    const onChange = vi.fn();
    render(<DateRangeSection preset={null} createdAfter="" createdBefore="" onChange={onChange} />);
    const select = screen.getByRole("combobox");

    fireEvent.change(select, { target: { value: "today" } });
    expect(new Date(onChange.mock.calls[0][0].createdAfter)).toEqual(new Date(2026, 9, 16, 0, 0));

    fireEvent.change(select, { target: { value: "7d" } });
    expect(new Date(onChange.mock.calls[1][0].createdAfter)).toEqual(new Date(2026, 9, 10, 0, 0));
  });

  it("shows the local date for an ISO instant and keeps a 'Custom' label after editing the to-date", () => {
    const from = new Date(2026, 9, 16, 0, 0).toISOString();
    expect(toDateInputValue(from)).toBe("2026-10-16");
    render(<DateRangeSection preset={null} createdAfter={from} createdBefore="2026-10-18" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveValue("custom");
  });
});
