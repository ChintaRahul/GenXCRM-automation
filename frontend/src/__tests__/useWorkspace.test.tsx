import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useWorkspace } from "../hooks/useWorkspace";
import * as AuthContext from "../context/AuthContext";

vi.mock("../context/AuthContext");

describe("useWorkspace", () => {
  it("returns the current user's org workspaceType", () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue({
      user: { org: { workspaceType: "MANUFACTURING" } },
    } as never);
    const { result } = renderHook(() => useWorkspace());
    expect(result.current).toBe("MANUFACTURING");
  });

  it("returns undefined when logged out", () => {
    vi.mocked(AuthContext.useAuth).mockReturnValue({ user: null } as never);
    const { result } = renderHook(() => useWorkspace());
    expect(result.current).toBeUndefined();
  });
});
