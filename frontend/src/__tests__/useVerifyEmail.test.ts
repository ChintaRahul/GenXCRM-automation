import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useVerifyEmail } from "../hooks/useVerifyEmail";
import * as client from "../api/client";

vi.mock("../api/client");

describe("useVerifyEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("transitions to success when verification succeeds", async () => {
    vi.mocked(client.verifyEmail).mockResolvedValue({ verified: true });
    const { result } = renderHook(() => useVerifyEmail());
    await act(async () => {
      await result.current.verify("token");
    });
    await waitFor(() => expect(result.current.status).toBe("success"));
  });

  it("transitions to error when verification fails", async () => {
    vi.mocked(client.verifyEmail).mockRejectedValue(new Error("bad token"));
    const { result } = renderHook(() => useVerifyEmail());
    await act(async () => {
      await result.current.verify("token");
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBeTruthy();
  });
});
