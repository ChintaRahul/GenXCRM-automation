import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useModuleExport } from "../hooks/useModuleExport";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe("useModuleExport", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("calls exportModuleList with the given params and triggers a download", async () => {
    const blob = new Blob(["csv"]);
    vi.mocked(modulesApi.exportModuleList).mockResolvedValue(blob);
    const { result } = renderHook(() => useModuleExport("accounts"));

    await act(async () => {
      await result.current.exportNow({ page: 1, limit: 20, search: "acme", status: ["Active"] });
    });

    expect(modulesApi.exportModuleList).toHaveBeenCalledWith("accounts", {
      page: 1, limit: 20, search: "acme", status: ["Active"],
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    await waitFor(() => expect(result.current.exporting).toBe(false));
  });

  it("shows a toast and resets exporting when the export fails", async () => {
    const { toast } = await import("sonner");
    vi.mocked(modulesApi.exportModuleList).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useModuleExport("accounts"));

    await act(async () => {
      await result.current.exportNow({ page: 1, limit: 20 });
    });

    expect(toast.error).toHaveBeenCalledWith("Couldn't export accounts.");
    expect(result.current.exporting).toBe(false);
  });
});
