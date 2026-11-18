import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLead } from "../hooks/useLead";
import * as client from "../api/client";
import type { Lead } from "../types";

vi.mock("../api/client");

const mockLead: Lead = {
  id: "lead-1",
  name: "Sneha Patel",
  phone: "+919876543210",
  source: "INSTAGRAM",
  stage: "INTERESTED",
  score: 84,
  interestedCount: 1,
  tags: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("useLead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the lead on successful fetch", async () => {
    vi.mocked(client.getLead).mockResolvedValue(mockLead);
    const { result } = renderHook(() => useLead("lead-1"));
    await waitFor(() => expect(result.current.lead).toEqual(mockLead));
    expect(result.current.loading).toBe(false);
  });

  it("sets error state on failed fetch", async () => {
    vi.mocked(client.getLead).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useLead("lead-1"));
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it("does not fetch when id is undefined", async () => {
    renderHook(() => useLead(undefined));
    await waitFor(() => expect(client.getLead).not.toHaveBeenCalled());
  });

  it("refetch re-triggers the API call", async () => {
    vi.mocked(client.getLead).mockResolvedValue(mockLead);
    const { result } = renderHook(() => useLead("lead-1"));
    await waitFor(() => expect(result.current.lead).toEqual(mockLead));
    result.current.refetch();
    await waitFor(() => expect(client.getLead).toHaveBeenCalledTimes(2));
  });
});
