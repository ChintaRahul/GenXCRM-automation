import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useModuleRights } from "../hooks/useModuleRights";
import * as modulesApi from "../api/modules";
import * as authCtx from "../context/AuthContext";

vi.mock("../api/modules");
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

const mockUser = (workspaceType: string) =>
  vi.mocked(authCtx.useAuth).mockReturnValue({
    user: { id: "u1", name: "T", email: "t@example.com", role: "SALES_REP", mfgRole: "SALES_EXECUTIVE", teamId: null, org: { workspaceType } },
  } as never);

describe("useModuleRights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides what the role may not do in that module", async () => {
    mockUser("MANUFACTURING");
    vi.mocked(modulesApi.getModuleRights).mockResolvedValue({
      leads: { create: false, read: true, update: true, delete: false },
    });
    const { result } = renderHook(() => useModuleRights("leads"));
    await waitFor(() => expect(result.current.create).toBe(false));
    expect(result.current).toMatchObject({ read: true, update: true, delete: false });
  });

  it("allows everything while unknown, when unrestricted, and on a failed check (the server still enforces)", async () => {
    mockUser("MANUFACTURING");
    vi.mocked(modulesApi.getModuleRights).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useModuleRights("leads"));
    expect(result.current.create).toBe(true);
    await waitFor(() => expect(modulesApi.getModuleRights).toHaveBeenCalled());
    expect(result.current).toMatchObject({ create: true, update: true, delete: true });
  });

  it("makes no call for an EdTech user", () => {
    mockUser("EDTECH");
    renderHook(() => useModuleRights("leads"));
    expect(modulesApi.getModuleRights).not.toHaveBeenCalled();
  });
});
