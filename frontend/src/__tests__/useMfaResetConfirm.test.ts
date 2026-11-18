import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useMfaResetConfirm } from "../hooks/useMfaResetConfirm";
import * as client from "../api/client";

vi.mock("../api/client");

describe("useMfaResetConfirm", () => {
  it("returns true and sets success on a valid token", async () => {
    vi.mocked(client.confirmMfaReset).mockResolvedValue({ message: "ok" });
    const { result } = renderHook(() => useMfaResetConfirm());
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.submit("good-token"); });
    expect(ok).toBe(true);
    await waitFor(() => expect(result.current.success).toBe(true));
  });

  it("returns false and sets error on an invalid token", async () => {
    vi.mocked(client.confirmMfaReset).mockRejectedValue(new Error("bad token"));
    const { result } = renderHook(() => useMfaResetConfirm());
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.submit("bad-token"); });
    expect(ok).toBe(false);
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
