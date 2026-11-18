import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useModuleRecord } from "../hooks/useModuleRecord";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");

describe("useModuleRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the record on mount", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "A-1", status: "Active" });
    const { result } = renderHook(() => useModuleRecord("accounts", "A-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.record).toEqual({ id: "A-1", status: "Active" });
  });

  it("sets error state on a failed fetch", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockRejectedValue(new Error("not found"));
    const { result } = renderHook(() => useModuleRecord("accounts", "missing"));
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it("runAction calls performModuleAction and refreshes the record with the response", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "LD-1", status: "New" });
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({ id: "LD-1", status: "Qualified" });
    const { result } = renderHook(() => useModuleRecord("leads", "LD-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The re-read after the action carries derived fields (the SLA state) the bare response lacks.
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "LD-1", status: "Qualified", sla: { l: "Due in 3d" } });
    await act(async () => {
      await result.current.runAction("Qualify");
    });
    expect(modulesApi.performModuleAction).toHaveBeenCalledWith("leads", "LD-1", "Qualify", undefined);
    expect(result.current.record).toEqual({ id: "LD-1", status: "Qualified", sla: { l: "Due in 3d" } });
  });

  it("keeps the action response when re-reading the record fails", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValueOnce({ id: "LD-1", status: "New" });
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({ id: "LD-1", status: "Qualified" });
    const { result } = renderHook(() => useModuleRecord("leads", "LD-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.mocked(modulesApi.getModuleRecord).mockRejectedValue(new Error("offline"));
    await act(async () => {
      await result.current.runAction("Qualify");
    });
    expect(result.current.record).toEqual({ id: "LD-1", status: "Qualified" });
  });

  it("archive calls archiveModuleRecord", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "A-1", status: "Active" });
    vi.mocked(modulesApi.archiveModuleRecord).mockResolvedValue(undefined);
    const { result } = renderHook(() => useModuleRecord("accounts", "A-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.archive();
    });
    expect(modulesApi.archiveModuleRecord).toHaveBeenCalledWith("accounts", "A-1");
  });

  it("save calls updateModuleRecord and refreshes the record with the response", async () => {
    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "A-1", name: "Acme" });
    vi.mocked(modulesApi.updateModuleRecord).mockResolvedValue({ id: "A-1", name: "Acme Renamed" });
    const { result } = renderHook(() => useModuleRecord("accounts", "A-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.mocked(modulesApi.getModuleRecord).mockResolvedValue({ id: "A-1", name: "Acme Renamed" });
    await act(async () => {
      await result.current.save({ name: "Acme Renamed" });
    });
    expect(modulesApi.updateModuleRecord).toHaveBeenCalledWith("accounts", "A-1", { name: "Acme Renamed" });
    expect(result.current.record).toEqual({ id: "A-1", name: "Acme Renamed" });
  });
});
