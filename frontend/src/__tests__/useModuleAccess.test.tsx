import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useModuleAccess, isRestrictedModule } from "../hooks/useModuleAccess";
import * as modulesApi from "../api/modules";
import * as authCtx from "../context/AuthContext";

vi.mock("../api/modules");
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

function mockUser(role: string) {
  vi.mocked(authCtx.useAuth).mockReturnValue({
    user: { id: "u1", name: "Test User", email: "test@example.com", role: "SALES_REP", mfgRole: role, teamId: null },
    token: "tok", loading: false, signIn: vi.fn(), signOut: vi.fn(), updateUser: vi.fn(),
    isImpersonating: false, impersonate: vi.fn(), exitImpersonation: vi.fn(),
  } as never);
}

describe("useModuleAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("grants access immediately for a non-restricted module, with no API call", async () => {
    mockUser("SALES_ENGINEER");
    const { result } = renderHook(() => useModuleAccess("accounts"));
    expect(result.current.hasAccess).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(modulesApi.getModuleList).not.toHaveBeenCalled();
  });

  it("grants access to a restricted module when the caller's role isn't in restrictedToRoles", async () => {
    mockUser("SALES_ENGINEER");
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "fp1", fieldLabel: "Costing & margin", restrictedToRoles: ["SALES_HEAD"] }],
      total: 1, page: 1, limit: 20, pages: 1,
    });
    const { result } = renderHook(() => useModuleAccess("costing"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasAccess).toBe(true);
  });

  it("denies access to a restricted module when the caller's role is in restrictedToRoles", async () => {
    mockUser("SALES_ENGINEER");
    vi.mocked(modulesApi.getModuleList).mockResolvedValue({
      data: [{ id: "fp1", fieldLabel: "Costing & margin", restrictedToRoles: ["SALES_ENGINEER"] }],
      total: 1, page: 1, limit: 20, pages: 1,
    });
    const { result } = renderHook(() => useModuleAccess("costing"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasAccess).toBe(false);
  });

  it("fails open (grants access) when the field-permissions fetch fails", async () => {
    mockUser("SALES_ENGINEER");
    vi.mocked(modulesApi.getModuleList).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useModuleAccess("costing"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasAccess).toBe(true);
  });
});

describe("isRestrictedModule", () => {
  it("is true only for modules with registry.restricted === true", () => {
    expect(isRestrictedModule("costing")).toBe(true);
    expect(isRestrictedModule("accounts")).toBe(false);
  });
});
