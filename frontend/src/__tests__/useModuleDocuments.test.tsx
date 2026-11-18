import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useModuleDocuments } from "../hooks/useModuleDocuments";
import * as modulesApi from "../api/modules";

vi.mock("../api/modules");

describe("useModuleDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads documents on mount", async () => {
    vi.mocked(modulesApi.getModuleDocuments).mockResolvedValue([{ id: "d1", name: "Quote.pdf", type: "pdf", createdAt: "2026-09-28", url: "https://x/quote.pdf" }]);
    const { result } = renderHook(() => useModuleDocuments("opps", "OP-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.documents).toHaveLength(1);
  });

  it("sets error state on a failed fetch", async () => {
    vi.mocked(modulesApi.getModuleDocuments).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useModuleDocuments("opps", "OP-1"));
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
