import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import MfaResetConfirmPage from "../pages/MfaResetConfirm";
import { useMfaResetConfirm } from "../hooks/useMfaResetConfirm";

vi.mock("../hooks/useMfaResetConfirm", () => ({ useMfaResetConfirm: vi.fn() }));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderAt(token: string | null) {
  const search = token ? `?token=${token}` : "";
  return render(
    <MemoryRouter initialEntries={[`/mfa-reset${search}`]}>
      <MfaResetConfirmPage />
    </MemoryRouter>,
  );
}

describe("MfaResetConfirmPage", () => {
  beforeEach(() => {
    vi.mocked(useMfaResetConfirm).mockReturnValue({
      submit: vi.fn(),
      loading: false,
      error: null,
      success: false,
    });
  });

  it("shows an invalid-link message with no token", () => {
    renderAt(null);
    expect(screen.getByText(/invalid link/i)).toBeInTheDocument();
  });

  it("confirms the reset and offers a link back to sign in", async () => {
    const submit = vi.fn().mockResolvedValue(true);
    vi.mocked(useMfaResetConfirm).mockReturnValue({ submit, loading: false, error: null, success: false });
    renderAt("good-token");

    await userEvent.click(screen.getByRole("button", { name: /reset two-factor authentication/i }));
    expect(submit).toHaveBeenCalledWith("good-token");
  });
});
