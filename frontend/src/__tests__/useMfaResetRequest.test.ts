import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMfaResetRequest } from "../hooks/useMfaResetRequest";
import * as client from "../api/client";

vi.mock("../api/client");

describe("useMfaResetRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets success after a successful request", async () => {
    vi.mocked(client.requestMfaReset).mockResolvedValue({ message: "ok" });
    const { result } = renderHook(() => useMfaResetRequest());
    await act(async () => {
      await result.current.submit("user@example.com");
    });
    await waitFor(() => expect(result.current.success).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it("sets error when the request fails", async () => {
    vi.mocked(client.requestMfaReset).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useMfaResetRequest());
    await act(async () => {
      await result.current.submit("user@example.com");
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.success).toBe(false);
  });
});
