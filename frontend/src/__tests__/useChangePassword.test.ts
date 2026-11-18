import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useChangePassword } from "../hooks/useChangePassword";
import * as client from "../api/client";
import type { User } from "../types";

vi.mock("../api/client");

const freshUser: User = {
  id: "u1",
  name: "Rep",
  email: "rep@co.com",
  role: "SALES_REP",
  teamId: null,
  mustChangePassword: false,
};

describe("useChangePassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the fresh token + user on success", async () => {
    vi.mocked(client.changePassword).mockResolvedValue({ token: "new-token", user: freshUser });
    const { result } = renderHook(() => useChangePassword());
    let out: { token: string; user: User } | null = null;
    await act(async () => {
      out = await result.current.submit("NewPassword@1");
    });
    expect(out).toEqual({ token: "new-token", user: freshUser });
    expect(result.current.error).toBeNull();
  });

  it("returns null and sets error on failure", async () => {
    vi.mocked(client.changePassword).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useChangePassword());
    let out: { token: string; user: User } | null = { token: "x", user: freshUser };
    await act(async () => {
      out = await result.current.submit("NewPassword@1");
    });
    expect(out).toBeNull();
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
