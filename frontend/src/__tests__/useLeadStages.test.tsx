import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLeadStages } from "../hooks/useLeadStages";
import * as client from "../api/client";
import type { StageView } from "../types";

vi.mock("../api/client");

const stage = (key: string, sortOrder: number): StageView => ({
  key,
  id: null,
  label: key,
  color: "blue",
  sortOrder,
  isHidden: false,
  mandatory: false,
  isCustom: false,
  countsAs: null,
});

describe("useLeadStages", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns stages on successful fetch", async () => {
    vi.mocked(client.getLeadStages).mockResolvedValue([stage("NEW", 0), stage("WON", 1)]);
    const { result } = renderHook(() => useLeadStages());
    await waitFor(() => expect(result.current.stages).toHaveLength(2));
    expect(result.current.error).toBeNull();
    expect(client.getLeadStages).toHaveBeenCalledWith(false);
  });

  it("sets error on failed fetch", async () => {
    vi.mocked(client.getLeadStages).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useLeadStages());
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it("reorder rolls back list when the API rejects", async () => {
    vi.mocked(client.getLeadStages).mockResolvedValue([stage("NEW", 0), stage("WON", 1)]);
    vi.mocked(client.reorderLeadStages).mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() => useLeadStages(true));
    await waitFor(() => expect(result.current.stages).toHaveLength(2));
    await act(async () => {
      await expect(result.current.reorder(["WON", "NEW"])).rejects.toThrow();
    });
    expect(result.current.stages.map((s) => s.key)).toEqual(["NEW", "WON"]);
  });

  it("byKey indexes by key", async () => {
    vi.mocked(client.getLeadStages).mockResolvedValue([stage("NEW", 0), stage("WON", 1)]);
    const { result } = renderHook(() => useLeadStages());
    await waitFor(() => expect(result.current.stages).toHaveLength(2));
    expect(result.current.byKey.WON.key).toBe("WON");
  });
});
