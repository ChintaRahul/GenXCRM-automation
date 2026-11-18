import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useModuleBoard } from "../hooks/useModuleBoard";
import * as modulesApi from "../api/modules";
import { REGISTRY, type ModuleDef } from "../modules/registry";

vi.mock("../api/modules");
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Minimal module-def-shaped object with `kanban: true` and no `flow`, so the
// column-grouping logic's `moduleDef.flow ?? moduleDef.statuses.map(...)` fallback
// is what actually determines column order (Review Focus #1).
const NO_FLOW_MODULE: ModuleDef = {
  title: "No Flow Module",
  idPrefix: "NF-",
  statuses: [
    { value: "A", tone: "gray" },
    { value: "B", tone: "gray" },
  ],
  kanban: true,
  fields: [],
  cols: [],
  tabs: [],
};

describe("useModuleBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("groups records by status into one column per flow step, appending extra statuses, in flow-then-extra order", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [
        { id: "OP-1", stage: "Qualified", value: 100000 },
        { id: "OP-2", stage: "Won", value: 200000 },
      ],
      total: 2, page: 1, limit: 1000, pages: 1,
    });
    const { result } = renderHook(() => useModuleBoard("opps"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const qualified = result.current.columns.find((c) => c.status === "Qualified");
    const won = result.current.columns.find((c) => c.status === "Won");
    expect(qualified?.records).toHaveLength(1);
    expect(won?.records).toHaveLength(1);

    // opps.flow is STAGES minus the last two ("Won", "Lost"), which are appended
    // as extra statuses — assert the actual column order, not just record counts.
    const flow = REGISTRY.opps.flow ?? [];
    const extra = REGISTRY.opps.statuses.map((s) => s.value).filter((v) => !flow.includes(v));
    expect(result.current.columns.map((c) => c.status)).toEqual([...flow, ...extra]);
    expect(extra).toEqual(["Won", "Lost"]);
  });

  it("uses the statuses array as column order when a kanban module has no flow", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "NF-1", status: "B" }],
      total: 1, page: 1, limit: 1000, pages: 1,
    });
    REGISTRY.__noFlowTest = NO_FLOW_MODULE;
    try {
      const { result } = renderHook(() => useModuleBoard("__noFlowTest"));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.columns.map((c) => c.status)).toEqual(
        NO_FLOW_MODULE.statuses.map((s) => s.value),
      );
    } finally {
      delete REGISTRY.__noFlowTest;
    }
  });

  it("sets error state on a failed fetch", async () => {
    vi.mocked(modulesApi.getModuleList).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useModuleBoard("opps"));
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it("moveRecord is a no-op when the target status equals the current status", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "OP-1", stage: "Qualified" }], total: 1, page: 1, limit: 1000, pages: 1,
    });
    const { result } = renderHook(() => useModuleBoard("opps"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.moveRecord({ id: "OP-1", stage: "Qualified" }, "Qualified");
    });
    expect(modulesApi.updateModuleRecord).not.toHaveBeenCalled();
    expect(modulesApi.performModuleAction).not.toHaveBeenCalled();
  });

  it("moveRecord returns needsAsk when the matched action requires one, without calling the API", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "OP-1", stage: "Negotiation" }], total: 1, page: 1, limit: 1000, pages: 1,
    });
    const { result } = renderHook(() => useModuleBoard("opps"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.moveRecord({ id: "OP-1", stage: "Negotiation" }, "Lost");
    });
    expect(outcome).toMatchObject({ needsAsk: { label: "Mark lost" } });
    expect(modulesApi.performModuleAction).not.toHaveBeenCalled();
    expect(modulesApi.updateModuleRecord).not.toHaveBeenCalled();
  });

  it("moveRecord runs the matched action directly when it has no ask", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "OP-1", stage: "PO received" }], total: 1, page: 1, limit: 1000, pages: 1,
    });
    vi.mocked(modulesApi.performModuleAction).mockResolvedValue({ id: "OP-1", stage: "Won" });
    const { result } = renderHook(() => useModuleBoard("opps"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.moveRecord({ id: "OP-1", stage: "PO received" }, "Won");
    });
    expect(modulesApi.performModuleAction).toHaveBeenCalledWith("opps", "OP-1", "Mark won", undefined);
  });

  it("moveRecord rejects a drop the matched action's when/notWhen disallows, without calling the API", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "OP-1", stage: "Qualified" }], total: 1, page: 1, limit: 1000, pages: 1,
    });
    const { result } = renderHook(() => useModuleBoard("opps"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.moveRecord({ id: "OP-1", stage: "Qualified" }, "Won");
    });
    expect(outcome).toBeUndefined();
    expect(modulesApi.performModuleAction).not.toHaveBeenCalled();
    expect(modulesApi.updateModuleRecord).not.toHaveBeenCalled();
  });

  it("shows a toast when a drop is rejected by the matched action's when/notWhen", async () => {
    const { toast } = await import("sonner");
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "OP-1", stage: "Qualified" }], total: 1, page: 1, limit: 1000, pages: 1,
    });
    const { result } = renderHook(() => useModuleBoard("opps"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.moveRecord({ id: "OP-1", stage: "Qualified" }, "Won");
    });
    expect(toast.error).toHaveBeenCalledWith("Can't move to Won from Qualified.");
  });

  it("moveRecord plain-PATCHes the status field when no action matches the target", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "OP-1", stage: "Qualified" }], total: 1, page: 1, limit: 1000, pages: 1,
    });
    vi.mocked(modulesApi.updateModuleRecord).mockResolvedValue({ id: "OP-1", stage: "Technical discussion" });
    const { result } = renderHook(() => useModuleBoard("opps"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.moveRecord({ id: "OP-1", stage: "Qualified" }, "Technical discussion");
    });
    expect(modulesApi.updateModuleRecord).toHaveBeenCalledWith("opps", "OP-1", { stage: "Technical discussion" });
  });

  it("passes the list's search and filters to the board fetch", async () => {
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({ data: [], total: 0, page: 1, limit: 1000, pages: 1 });
    renderHook(() => useModuleBoard("opps", { search: "kaveri", status: ["Qualified"] }));
    await waitFor(() =>
      expect(modulesApi.getModuleList).toHaveBeenCalledWith("opps", expect.objectContaining({ search: "kaveri", status: ["Qualified"], limit: 1000 })),
    );
  });
});
