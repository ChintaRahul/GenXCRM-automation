import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useModuleAudit } from "../hooks/useModuleAudit";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");

describe("useModuleAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads audit entries on mount", async () => {
    vi.mocked(modulesApi.getModuleAudit).mockResolvedValue([{ id: "a1", at: "2026-09-28", user: "Jane", field: "status", oldValue: "New", newValue: "Qualified" }]);
    const { result } = renderHook(() => useModuleAudit("opps", "OP-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toHaveLength(1);
  });

  it("sets error state on a failed fetch", async () => {
    vi.mocked(modulesApi.getModuleAudit).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useModuleAudit("opps", "OP-1"));
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
