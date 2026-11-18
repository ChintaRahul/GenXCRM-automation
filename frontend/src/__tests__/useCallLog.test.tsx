import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCallLog } from "../hooks/useCallLog";
import * as client from "../api/client";
import { Messages } from "../lib/messages";
import type { CallLogEntry, PaginatedResponse } from "../types";

vi.mock("../api/client");

const mockCall: CallLogEntry = {
  id: "comm-1",
  direction: "outbound",
  status: "completed",
  durationSec: 184,
  callOutcome: "CONNECTED",
  sentAt: "2026-08-11T00:00:00.000Z",
  lead: { id: "lead-1", name: "Rohan Mehta", phone: "+919123456780" },
  callRecording: { id: "rec-1", status: "UPLOADED" },
};

const mockResponse: PaginatedResponse<CallLogEntry> = {
  data: [mockCall],
  total: 1,
  page: 1,
  limit: 20,
  pages: 1,
};

describe("useCallLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and returns calls on success", async () => {
    vi.mocked(client.getCallLog).mockResolvedValue(mockResponse);
    const { result } = renderHook(() => useCallLog());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.calls).toHaveLength(1);
    expect(result.current.calls[0].id).toBe("comm-1");
    expect(result.current.total).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it("sets error state on failed fetch", async () => {
    vi.mocked(client.getCallLog).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useCallLog());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.load.calls);
    expect(result.current.calls).toHaveLength(0);
  });

  it("exposes a refetch function that re-queries the API", async () => {
    vi.mocked(client.getCallLog).mockResolvedValue(mockResponse);
    const { result } = renderHook(() => useCallLog());
    await waitFor(() => expect(result.current.loading).toBe(false));
    result.current.refetch();
    await waitFor(() => expect(client.getCallLog).toHaveBeenCalledTimes(2));
  });
});
