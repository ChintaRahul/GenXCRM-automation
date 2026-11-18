import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useFieldMappings } from "../hooks/useFieldMappings";
import * as client from "../api/client";

vi.mock("../api/client");

const mapping = {
  coreFieldAliases: { name: "", email: "", phone: "" },
  customFieldDefs: [],
};

describe("useFieldMappings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the mapping on mount", async () => {
    vi.mocked(client.getFieldMappings).mockResolvedValue(mapping as never);
    const { result } = renderHook(() => useFieldMappings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mapping).toEqual(mapping);
    expect(result.current.error).toBeNull();
  });

  it("sets an error when the load fails", async () => {
    vi.mocked(client.getFieldMappings).mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useFieldMappings());
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it("save PATCHes and updates local state", async () => {
    vi.mocked(client.getFieldMappings).mockResolvedValue(mapping as never);
    const updated = { ...mapping, coreFieldAliases: { ...mapping.coreFieldAliases, name: "Full Name" } };
    vi.mocked(client.updateFieldMappings).mockResolvedValue(updated as never);
    const { result } = renderHook(() => useFieldMappings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await result.current.save({ coreFieldAliases: updated.coreFieldAliases });
    expect(client.updateFieldMappings).toHaveBeenCalledWith({ coreFieldAliases: updated.coreFieldAliases });
    await waitFor(() => expect(result.current.mapping?.coreFieldAliases.name).toBe("Full Name"));
  });
});
