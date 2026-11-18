import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useColumnPrefs } from "../hooks/useColumnPrefs";
import * as modulesApi from "../api/modules";
import type { ModuleColumn } from "../modules/registry";

vi.mock("../api/modules");

const COLS: ModuleColumn[] = [
  { key: "id", label: "ID", type: "id" },
  { key: "name", label: "Name", type: "text" },
];

describe("useColumnPrefs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to every column visible when no preference is saved (null)", async () => {
    vi.mocked(modulesApi.getColumnPrefs).mockResolvedValue(null);
    const { result } = renderHook(() => useColumnPrefs("accounts", COLS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visibleKeys).toEqual(["id", "name"]);
  });

  it("respects a saved empty array as 'every column hidden', not 'no preference'", async () => {
    vi.mocked(modulesApi.getColumnPrefs).mockResolvedValue([]);
    const { result } = renderHook(() => useColumnPrefs("accounts", COLS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visibleKeys).toEqual([]);
  });

  it("loads a saved subset of columns", async () => {
    vi.mocked(modulesApi.getColumnPrefs).mockResolvedValue(["name"]);
    const { result } = renderHook(() => useColumnPrefs("accounts", COLS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visibleKeys).toEqual(["name"]);
  });

  it("toggleColumn adds or removes a key and persists the result", async () => {
    vi.mocked(modulesApi.getColumnPrefs).mockResolvedValue(["id", "name"]);
    vi.mocked(modulesApi.saveColumnPrefs).mockResolvedValue(undefined);
    const { result } = renderHook(() => useColumnPrefs("accounts", COLS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleColumn("name"));
    await waitFor(() => expect(result.current.visibleKeys).toEqual(["id"]));
    expect(modulesApi.saveColumnPrefs).toHaveBeenCalledWith("accounts", ["id"]);
  });

  it("does not throw or reject when the background save fails", async () => {
    vi.mocked(modulesApi.getColumnPrefs).mockResolvedValue(["id", "name"]);
    vi.mocked(modulesApi.saveColumnPrefs).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useColumnPrefs("accounts", COLS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Visible state still updates immediately even though persistence fails in the background.
    act(() => result.current.toggleColumn("name"));
    await waitFor(() => expect(result.current.visibleKeys).toEqual(["id"]));
    await waitFor(() => expect(modulesApi.saveColumnPrefs).toHaveBeenCalledWith("accounts", ["id"]));
  });
});
