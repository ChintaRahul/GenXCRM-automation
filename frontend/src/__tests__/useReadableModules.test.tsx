import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useReadableModules } from "../hooks/useReadableModules";
import * as modulesApi from "../api/modules";
import * as authCtx from "../context/AuthContext";

vi.mock("../api/modules");
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

function mockUser(workspaceType: string) {
  vi.mocked(authCtx.useAuth).mockReturnValue({
    user: { id: "u1", name: "T", email: "t@example.com", role: "SALES_REP", mfgRole: "SALES_EXECUTIVE", teamId: null, org: { workspaceType } },
    token: "tok", loading: false, signIn: vi.fn(), signOut: vi.fn(), updateUser: vi.fn(),
    isImpersonating: false, impersonate: vi.fn(), exitImpersonation: vi.fn(),
  } as never);
}

describe("useReadableModules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the readable module keys for a Manufacturing user", async () => {
    mockUser("MANUFACTURING");
    vi.mocked(modulesApi.getReadableModules).mockResolvedValue(["leads", "opps"]);
    const { result } = renderHook(() => useReadableModules());
    await waitFor(() => expect(result.current).toEqual(["leads", "opps"]));
  });

  it("makes no API call for an EdTech user", () => {
    mockUser("EDTECH");
    const { result } = renderHook(() => useReadableModules());
    expect(result.current).toBeNull();
    expect(modulesApi.getReadableModules).not.toHaveBeenCalled();
  });

  it("fails open (null) when the request errors", async () => {
    mockUser("MANUFACTURING");
    vi.mocked(modulesApi.getReadableModules).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useReadableModules());
    await waitFor(() => expect(modulesApi.getReadableModules).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
