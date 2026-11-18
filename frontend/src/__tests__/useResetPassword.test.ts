import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useResetPassword } from "../hooks/useResetPassword";
import * as client from "../api/client";

vi.mock("../api/client");

describe("useResetPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true and sets success on a successful reset", async () => {
    vi.mocked(client.resetPassword).mockResolvedValue({ message: "ok" });
    const { result } = renderHook(() => useResetPassword());
    let ok = false;
    await act(async () => {
      ok = await result.current.submit("token", "NewPassword@1");
    });
    expect(ok).toBe(true);
    await waitFor(() => expect(result.current.success).toBe(true));
  });

  it("returns false and sets error on failure", async () => {
    vi.mocked(client.resetPassword).mockRejectedValue(new Error("expired"));
    const { result } = renderHook(() => useResetPassword());
    let ok = true;
    await act(async () => {
      ok = await result.current.submit("token", "NewPassword@1");
    });
    expect(ok).toBe(false);
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
