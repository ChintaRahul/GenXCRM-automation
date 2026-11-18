import { renderHook, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useDailySummary,
  useStatusReport,
  useDailyReportFilters,
} from "../hooks/useReports";
import * as client from "../api/client";
import { Messages } from "../lib/messages";

vi.mock("../api/client");

describe("useDailySummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and returns the daily summary on success", async () => {
    vi.mocked(client.getDailySummary).mockResolvedValue({
      generated: 10,
      newLeads: 4,
      contacted: 3,
      pending: 2,
    });
    const { result } = renderHook(() => useDailySummary({ from: "2026-08-03", to: "2026-08-03" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ generated: 10, newLeads: 4, contacted: 3, pending: 2 });
    expect(result.current.error).toBeNull();
  });

  it("sets error state on failed fetch", async () => {
    vi.mocked(client.getDailySummary).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useDailySummary({}));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.load.report);
    expect(result.current.data).toBeNull();
  });
});

describe("useStatusReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refetches when the filter changes", async () => {
    vi.mocked(client.getStatusReport).mockResolvedValue([]);
    const { rerender } = renderHook(({ filter }) => useStatusReport(filter), {
      initialProps: { filter: { teamMemberId: "rep-1" } },
    });
    await waitFor(() => expect(client.getStatusReport).toHaveBeenCalledTimes(1));

    rerender({ filter: { teamMemberId: "rep-2" } });
    await waitFor(() => expect(client.getStatusReport).toHaveBeenCalledTimes(2));
    expect(client.getStatusReport).toHaveBeenLastCalledWith({ teamMemberId: "rep-2" });
  });
});

describe("useDailyReportFilters", () => {
  it("defaults from/to from to the first of the month and to to today and syncs updates into the URL", () => {
    const { result } = renderHook(() => useDailyReportFilters(), {
      wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
    });

    const today = new Date().toISOString().slice(0, 10);
    expect(result.current.filters.from).toBe(`${today.slice(0, 7)}-01`);
    expect(result.current.filters.to).toBe(today);

    act(() => {
      result.current.setFilters({ teamMemberId: "rep-1" });
    });
    expect(result.current.filters.teamMemberId).toBe("rep-1");
  });
});
