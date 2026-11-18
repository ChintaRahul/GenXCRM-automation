import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useImportMappings } from "../hooks/useImportMappings";
import * as client from "../api/client";
import type { ImportMapping } from "../types";
import { Messages } from "../lib/messages";

vi.mock("../api/client", () => ({
  getImportMappings: vi.fn(),
  createImportMapping: vi.fn(),
  updateImportMapping: vi.fn(),
  deleteImportMapping: vi.fn(),
}));

const mockMapping: ImportMapping = {
  id: "map-1",
  name: "Template A",
  mappings: { name: "Full Name", phone: "Mobile" },
  createdById: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("useImportMappings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getImportMappings).mockResolvedValue([]);
    vi.mocked(client.createImportMapping).mockResolvedValue(mockMapping);
    vi.mocked(client.updateImportMapping).mockResolvedValue(mockMapping);
    vi.mocked(client.deleteImportMapping).mockResolvedValue(undefined as never);
  });

  it("fetches mappings on mount", async () => {
    vi.mocked(client.getImportMappings).mockResolvedValue([mockMapping]);
    const { result } = renderHook(() => useImportMappings());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mappings).toHaveLength(1);
    expect(result.current.mappings[0].id).toBe("map-1");
    expect(result.current.error).toBeNull();
  });

  it("sets error state on failed fetch", async () => {
    vi.mocked(client.getImportMappings).mockRejectedValue(
      new Error("Network error"),
    );
    const { result } = renderHook(() => useImportMappings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.load.mappingTemplates);
    expect(result.current.mappings).toHaveLength(0);
  });

  it("starts in loading state", () => {
    const { result } = renderHook(() => useImportMappings());
    expect(result.current.loading).toBe(true);
  });

  it("createMapping calls API and refetches list", async () => {
    vi.mocked(client.getImportMappings).mockResolvedValue([mockMapping]);
    const { result } = renderHook(() => useImportMappings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.createMapping({
        name: "Template A",
        mappings: { name: "Full Name" },
      });
    });
    expect(client.createImportMapping).toHaveBeenCalledWith({
      name: "Template A",
      mappings: { name: "Full Name" },
    });
    expect(client.getImportMappings).toHaveBeenCalledTimes(2);
  });

  it("updateMapping calls API with id and payload then refetches", async () => {
    vi.mocked(client.getImportMappings).mockResolvedValue([mockMapping]);
    vi.mocked(client.updateImportMapping).mockResolvedValue({
      ...mockMapping,
      name: "Renamed",
    });
    const { result } = renderHook(() => useImportMappings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.updateMapping("map-1", { name: "Renamed" });
    });
    expect(client.updateImportMapping).toHaveBeenCalledWith("map-1", {
      name: "Renamed",
    });
    expect(client.getImportMappings).toHaveBeenCalledTimes(2);
  });

  it("deleteMapping calls API then refetches", async () => {
    const { result } = renderHook(() => useImportMappings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.deleteMapping("map-1");
    });
    expect(client.deleteImportMapping).toHaveBeenCalledWith("map-1");
    expect(client.getImportMappings).toHaveBeenCalledTimes(2);
  });

  it("refetch re-queries the API", async () => {
    vi.mocked(client.getImportMappings).mockResolvedValue([mockMapping]);
    const { result } = renderHook(() => useImportMappings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.refetch();
    });
    expect(client.getImportMappings).toHaveBeenCalledTimes(2);
  });
});
