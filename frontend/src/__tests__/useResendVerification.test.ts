import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useResendVerification } from "../hooks/useResendVerification";
import * as client from "../api/client";

vi.mock("../api/client");

describe("useResendVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets success after resending", async () => {
    vi.mocked(client.resendVerification).mockResolvedValue({ message: "ok" });
    const { result } = renderHook(() => useResendVerification());
    await act(async () => {
      await result.current.resend("user@example.com");
    });
    await waitFor(() => expect(result.current.success).toBe(true));
  });

  it("sets error when resending fails", async () => {
    vi.mocked(client.resendVerification).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useResendVerification());
    await act(async () => {
      await result.current.resend("user@example.com");
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.success).toBe(false);
  });
});
