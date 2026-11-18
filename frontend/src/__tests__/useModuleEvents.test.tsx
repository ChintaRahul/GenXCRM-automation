import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useModuleEvents } from "../hooks/useModuleEvents";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");

describe("useModuleEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads events on mount", async () => {
    vi.mocked(modulesApi.getModuleEvents).mockResolvedValue([
      { id: "e1", at: "2026-09-28T10:00:00Z", label: "Moved to Qualified" },
    ]);
    const { result } = renderHook(() => useModuleEvents("opps", "OP-1", "history"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.events).toHaveLength(1);
    expect(modulesApi.getModuleEvents).toHaveBeenCalledWith("opps", "OP-1", "history");
  });

  it("sets error state on a failed fetch", async () => {
    vi.mocked(modulesApi.getModuleEvents).mockRejectedValue(new Error("network error"));
    const { result } = renderHook(() => useModuleEvents("opps", "OP-1", "history"));
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
