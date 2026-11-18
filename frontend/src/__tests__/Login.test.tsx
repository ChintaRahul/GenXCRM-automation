import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import LoginPage from "../pages/Login";
import * as client from "../api/client";
import * as platform from "../lib/platform";
import type { User } from "../types";

vi.mock("../api/client");
vi.mock("../lib/platform", async () => {
  const actual = await vi.importActual<typeof platform>("../lib/platform");
  return { ...actual, isNative: vi.fn(() => false), openExternal: vi.fn() };
});

const mockSignIn = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ signIn: mockSignIn }),
}));

vi.mock("../hooks/useResendVerification", () => ({
  useResendVerification: () => ({ resend: vi.fn(), loading: false, success: false }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const user: User = {
  id: "u1",
  name: "Rep",
  email: "rep@co.com",
  role: "SALES_REP",
  teamId: null,
};

async function fillAndSubmit() {
  const emailInput = screen.getByLabelText("Email");
  const passwordInput = screen.getByLabelText("Password");
  await userEvent.type(emailInput, "rep@co.com");
  await userEvent.type(passwordInput, "password123");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("signs in and navigates home on a normal login", async () => {
    vi.mocked(client.login).mockResolvedValue({ token: "session-token", user });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await fillAndSubmit();
    expect(mockSignIn).toHaveBeenCalledWith("session-token", user);
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it("navigates to the MFA challenge screen when a code is required", async () => {
    vi.mocked(client.login).mockResolvedValue({ mfaRequired: true, challengeToken: "challenge-token" });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await fillAndSubmit();
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/mfa-challenge", {
      state: { challengeToken: "challenge-token" },
    });
  });

  it("navigates to forced MFA setup when the org enforces it and the user hasn't enrolled", async () => {
    vi.mocked(client.login).mockResolvedValue({
      mustSetupMfa: true,
      setupToken: "setup-token",
      qrCodeDataUrl: "data:image/png;base64,xyz",
      secret: "SECRET",
    });
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await fillAndSubmit();
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/mfa-setup", {
      state: { setupToken: "setup-token", qrCodeDataUrl: "data:image/png;base64,xyz", secret: "SECRET" },
    });
  });

  it("renders SSO buttons as plain links on web", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByTitle("Continue with Google")).toHaveAttribute(
      "href",
      expect.stringContaining("/auth/google"),
    );
    expect(screen.getByTitle("Continue with X")).toHaveAttribute(
      "href",
      expect.stringContaining("/auth/twitter"),
    );
    expect(screen.getByTitle("Continue with Meta")).toHaveAttribute(
      "href",
      expect.stringContaining("/auth/facebook"),
    );
  });

  it("opens SSO in the system browser with ?platform=native on the native app", async () => {
    vi.mocked(platform.isNative).mockReturnValue(true);
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByTitle("Continue with Google"));
    expect(platform.openExternal).toHaveBeenCalledWith(
      expect.stringContaining("/auth/google?platform=native"),
    );
  });
});
