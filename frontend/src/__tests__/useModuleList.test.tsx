import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useModuleList } from "../hooks/useModuleList";
import { emptyModuleFilters } from "../lib/moduleFilters";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");

describe("useModuleList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the first page on mount", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "A-1", name: "Acme" }], total: 1, page: 1, limit: 20, pages: 1,
    });
    const { result } = renderHook(() => useModuleList("accounts"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.records).toEqual([{ id: "A-1", name: "Acme" }]);
    expect(result.current.total).toBe(1);
    expect(modulesApi.getModuleList).toHaveBeenCalledWith("accounts", expect.objectContaining({ page: 1 }));
  });

  it("sets error state on a failed fetch", async () => {
    vi.mocked(modulesApi.getModuleList).mockRejectedValue(new Error("network error"));
    const { result } = renderHook(() => useModuleList("accounts"));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.loading).toBe(false);
  });

  it("re-fetches when search changes", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
    const { result } = renderHook(() => useModuleList("accounts"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setSearch("acme"));
    await waitFor(() =>
      expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ search: "acme" })),
    );
  });

  it("resets to page 1 when search or a filter changes", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({ data: [], total: 0, page: 2, limit: 20, pages: 1 });
    const { result } = renderHook(() => useModuleList("accounts"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.page).toBe(2));

    act(() => result.current.setFilters({ ...result.current.filters, status: ["Active"] }));
    await waitFor(() => expect(result.current.page).toBe(1));
  });

  it("setSort toggles ascending -> descending -> unsorted on repeated calls with the same key", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
    const { result } = renderHook(() => useModuleList("accounts"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setSort("name"));
    await waitFor(() => expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ sort: "name" })));

    act(() => result.current.setSort("name"));
    await waitFor(() => expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ sort: "-name" })));

    act(() => result.current.setSort("name"));
    await waitFor(() => expect(modulesApi.getModuleList).toHaveBeenLastCalledWith("accounts", expect.objectContaining({ sort: undefined })));
  });

  it("setSort resets to a fresh ascending sort when switching to a different column", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
    const { result } = renderHook(() => useModuleList("accounts"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setSort("name"));
    await waitFor(() => expect(result.current.sort).toBe("name"));
    act(() => result.current.setSort("value"));
    await waitFor(() => expect(result.current.sort).toBe("value"));
  });

  it("restores the cleared filters on Back, but a fresh visit re-applies the defaults", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
    const mtd = { ...emptyModuleFilters(), date: { preset: "mtd" as const, from: "", to: "" } };
    const first = renderHook(() => useModuleList("leads", mtd));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    act(() => first.result.current.setFilters(emptyModuleFilters()));
    first.unmount();

    const back = renderHook(() => useModuleList("leads", mtd, 25, true));
    expect(back.result.current.filters).toEqual(emptyModuleFilters());
    back.unmount();

    const fresh = renderHook(() => useModuleList("leads", mtd, 25, false));
    expect(fresh.result.current.filters).toEqual(mtd);
  });
});
