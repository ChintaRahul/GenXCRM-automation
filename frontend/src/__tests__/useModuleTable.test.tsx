import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useModuleTable } from "../hooks/useModuleTable";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");

describe("useModuleTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads table data on mount", async () => {
    vi.mocked(modulesApi.getModuleTable).mockResolvedValue({
      columns: [{ key: "name", label: "Plant", type: "text" }],
      rows: [{ name: "Plant 1" }],
    });
    const { result } = renderHook(() => useModuleTable("accounts", "A-1", "plants"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({
      columns: [{ key: "name", label: "Plant", type: "text" }],
      rows: [{ name: "Plant 1" }],
    });
    expect(modulesApi.getModuleTable).toHaveBeenCalledWith("accounts", "A-1", "plants");
  });

  it("sets error state on a failed fetch", async () => {
    vi.mocked(modulesApi.getModuleTable).mockRejectedValue(new Error("network error"));
    const { result } = renderHook(() => useModuleTable("accounts", "A-1", "plants"));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.loading).toBe(false);
  });
});
