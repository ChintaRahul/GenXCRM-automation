import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import OAuthCallbackPage from "../pages/OAuthCallback";
import { completeOAuthSignIn } from "../lib/oauth";
import type { User } from "../types";

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

function renderAtCallbackUrl(query: string) {
  return render(
    <MemoryRouter initialEntries={[`/auth/callback${query}`]}>
      <Routes>
        <Route path="/auth/callback" element={<OAuthCallbackPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("OAuthCallbackPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "location", {
      value: { href: "https://app.genxcrm.co.in/auth/callback" },
      writable: true,
    });
  });

  it("signs in and navigates home on a plain token", async () => {
    window.location.href = "https://app.genxcrm.co.in/auth/callback?token=tok-1";
    vi.mocked(completeOAuthSignIn).mockResolvedValue(user);
    renderAtCallbackUrl("?token=tok-1");
    await vi.waitFor(() => expect(mockSignIn).toHaveBeenCalledWith("tok-1", user));
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("redirects to the MFA challenge page instead of signing in when the SSO user has MFA enrolled", async () => {
    window.location.href = "https://app.genxcrm.co.in/auth/callback?mfa=challenge&challengeToken=chal-1";
    renderAtCallbackUrl("?mfa=challenge&challengeToken=chal-1");
    await vi.waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/mfa-challenge", { state: { challengeToken: "chal-1" }, replace: true }),
    );
    expect(completeOAuthSignIn).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("redirects to the MFA setup page when the org enforces MFA and the SSO user has not enrolled", async () => {
    window.location.href = "https://app.genxcrm.co.in/auth/callback?mfa=setup&setupToken=setup-1";
    renderAtCallbackUrl("?mfa=setup&setupToken=setup-1");
    await vi.waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/mfa-setup", { state: { setupToken: "setup-1" }, replace: true }),
    );
    expect(completeOAuthSignIn).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});
