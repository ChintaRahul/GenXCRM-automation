import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useNativeOAuthCallback } from "../hooks/useNativeOAuthCallback";
import { completeOAuthSignIn } from "../lib/oauth";
import type { User } from "../types";

let appUrlOpenListener: ((data: { url: string }) => void) | undefined;
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn((_event: string, cb: (data: { url: string }) => void) => {
      appUrlOpenListener = cb;
      return Promise.resolve({ remove: vi.fn() });
    }),
  },
}));

const mockBrowserClose = vi.fn().mockResolvedValue(undefined);
vi.mock("@capacitor/browser", () => ({ Browser: { close: () => mockBrowserClose() } }));

vi.mock("../lib/platform", () => ({ isNative: () => true }));

vi.mock("../lib/oauth", async () => {
  const actual = await vi.importActual("../lib/oauth");
  return { ...actual, completeOAuthSignIn: vi.fn() };
});

const mockSignIn = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ signIn: mockSignIn }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const user: User = { id: "u1", name: "Rep", email: "rep@co.com", role: "SALES_REP", teamId: null };

describe("useNativeOAuthCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appUrlOpenListener = undefined;
  });

  it("signs in and navigates home on a plain token", async () => {
    vi.mocked(completeOAuthSignIn).mockResolvedValue(user);
    renderHook(() => useNativeOAuthCallback());

    appUrlOpenListener?.({ url: "com.genxcrm.app://auth/callback?token=tok-1" });

    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith("tok-1", user));
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
    expect(mockBrowserClose).toHaveBeenCalled();
  });

  it("redirects to the MFA challenge page instead of signing in when the SSO user has MFA enrolled", async () => {
    renderHook(() => useNativeOAuthCallback());

    appUrlOpenListener?.({ url: "com.genxcrm.app://auth/callback?mfa=challenge&challengeToken=chal-1" });

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/mfa-challenge", { state: { challengeToken: "chal-1" }, replace: true }),
    );
    expect(completeOAuthSignIn).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("redirects to the MFA setup page when the org enforces MFA and the SSO user has not enrolled", async () => {
    renderHook(() => useNativeOAuthCallback());

    appUrlOpenListener?.({ url: "com.genxcrm.app://auth/callback?mfa=setup&setupToken=setup-1" });

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/mfa-setup", { state: { setupToken: "setup-1" }, replace: true }),
    );
    expect(completeOAuthSignIn).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});
