import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMfaChallenge } from "../hooks/useMfaChallenge";
import * as client from "../api/client";
import type { User } from "../types";

vi.mock("../api/client");

const user: User = {
  id: "u1",
  name: "Rep",
  email: "rep@co.com",
  role: "SALES_REP",
  teamId: null,
};

describe("useMfaChallenge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the token + user on a correct code", async () => {
    vi.mocked(client.verifyMfaChallenge).mockResolvedValue({ token: "session-token", user });
    const { result } = renderHook(() => useMfaChallenge());
    let out: { token: string; user: User } | null = null;
    await act(async () => {
      out = await result.current.verify("challenge-token", "123456");
    });
    expect(out).toEqual({ token: "session-token", user });
    expect(result.current.error).toBeNull();
  });

  it("returns null and sets error on a wrong code", async () => {
    vi.mocked(client.verifyMfaChallenge).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useMfaChallenge());
    let out: { token: string; user: User } | null = { token: "x", user };
    await act(async () => {
      out = await result.current.verify("challenge-token", "000000");
    });
    expect(out).toBeNull();
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
