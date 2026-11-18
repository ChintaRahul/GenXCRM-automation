import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import MfaChallengePage from "../pages/MfaChallenge";
import { useMfaChallenge } from "../hooks/useMfaChallenge";
import type { User } from "../types";

vi.mock("../hooks/useMfaChallenge", () => ({
  useMfaChallenge: vi.fn(),
}));

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

function renderWithChallengeToken(challengeToken: string | undefined) {
  return render(
    <MemoryRouter
      initialEntries={[{ pathname: "/mfa-challenge", state: challengeToken ? { challengeToken } : undefined }]}
    >
      <Routes>
        <Route path="/mfa-challenge" element={<MfaChallengePage />} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MfaChallengePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when no challengeToken is present in state", () => {
    vi.mocked(useMfaChallenge).mockReturnValue({ verify: vi.fn(), loading: false, error: null });
    renderWithChallengeToken(undefined);
    expect(screen.getByText("Login page")).toBeInTheDocument();
  });

  it("signs in and navigates home on a correct code", async () => {
    const verify = vi.fn().mockResolvedValue({ token: "session-token", user });
    vi.mocked(useMfaChallenge).mockReturnValue({ verify, loading: false, error: null });
    renderWithChallengeToken("challenge-token");

    await userEvent.type(screen.getByLabelText(/verification code/i), "123456");
    await userEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));

    expect(verify).toHaveBeenCalledWith("challenge-token", "123456");
    expect(mockSignIn).toHaveBeenCalledWith("session-token", user);
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("toggling to a recovery code changes the input and still verifies correctly", async () => {
    const verify = vi.fn().mockResolvedValue({ token: "session-token", user });
    vi.mocked(useMfaChallenge).mockReturnValue({ verify, loading: false, error: null });
    renderWithChallengeToken("challenge-token");

    await userEvent.click(screen.getByRole("button", { name: /use a recovery code instead/i }));
    const input = screen.getByLabelText(/recovery code/i);
    await userEvent.type(input, "abcd-1234");

    await userEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));
    expect(verify).toHaveBeenCalledWith("challenge-token", "ABCD-1234");
  });

  it("shows the error and does not sign in on a wrong code", async () => {
    const verify = vi.fn().mockResolvedValue(null);
    vi.mocked(useMfaChallenge).mockReturnValue({ verify, loading: false, error: "That code isn't correct. Please try again." });
    renderWithChallengeToken("challenge-token");

    await userEvent.type(screen.getByLabelText(/verification code/i), "000000");
    await userEvent.click(screen.getByRole("button", { name: /verify and sign in/i }));

    expect(mockSignIn).not.toHaveBeenCalled();
    expect(screen.getByText(/that code isn't correct/i)).toBeInTheDocument();
  });

  it("cancelling (X button) returns to /login without signing in", async () => {
    vi.mocked(useMfaChallenge).mockReturnValue({ verify: vi.fn(), loading: false, error: null });
    renderWithChallengeToken("challenge-token");
    await userEvent.click(screen.getByRole("button", { name: /cancel and back to sign in/i }));
    expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("pressing Escape cancels back to /login", async () => {
    vi.mocked(useMfaChallenge).mockReturnValue({ verify: vi.fn(), loading: false, error: null });
    renderWithChallengeToken("challenge-token");
    await userEvent.keyboard("{Escape}");
    expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
  });
});
