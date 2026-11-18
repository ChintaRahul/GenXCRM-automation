import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAuditLog } from "../hooks/useAuditLog";
import * as client from "../api/client";

vi.mock("../api/client");

const page1 = { items: [{ id: "a1", action: "LOGIN", userName: "Rahul", time: "2026-09-01T00:00:00Z", ipAddress: "1.2.3.4" }], total: 25, page: 1, pageSize: 20 };

describe("useAuditLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads page 1 on mount", async () => {
    vi.mocked(client.getAuditLog).mockResolvedValue(page1 as never);
    const { result } = renderHook(() => useAuditLog());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(client.getAuditLog).toHaveBeenCalledWith(1, 20);
    expect(result.current.page?.items).toHaveLength(1);
  });

  it("sets an error when the fetch fails", async () => {
    vi.mocked(client.getAuditLog).mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useAuditLog());
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it("setPage refetches the requested page", async () => {
    vi.mocked(client.getAuditLog).mockResolvedValue(page1 as never);
    const { result } = renderHook(() => useAuditLog());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(client.getAuditLog).toHaveBeenCalledWith(2, 20));
  });
});
