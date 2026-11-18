import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCallAlert } from "../hooks/useCallAlert";
import * as client from "../api/client";

vi.mock("../api/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("useCallAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the delivered result on success", async () => {
    vi.mocked(client.sendCallAlert).mockResolvedValue({ delivered: true, phone: "9876543210" });
    const { result } = renderHook(() => useCallAlert());

    let outcome: { delivered: boolean; phone: string } | undefined;
    await act(async () => {
      outcome = await result.current.triggerCallAlert("lead-1");
    });

    expect(outcome).toEqual({ delivered: true, phone: "9876543210" });
    expect(result.current.pending).toBe(false);
  });

  it("returns undefined and does not throw when the request fails", async () => {
    vi.mocked(client.sendCallAlert).mockRejectedValue(new Error("network error"));
    const { result } = renderHook(() => useCallAlert());

    let outcome: { delivered: boolean; phone: string } | undefined;
    await act(async () => {
      outcome = await result.current.triggerCallAlert("lead-1");
    });

    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(outcome).toBeUndefined();
  });
});
