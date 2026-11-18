import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import MfaResetRequestPage from "../pages/MfaResetRequest";
import { useMfaResetRequest } from "../hooks/useMfaResetRequest";

vi.mock("../hooks/useMfaResetRequest", () => ({ useMfaResetRequest: vi.fn() }));

describe("MfaResetRequestPage", () => {
  it("submits the typed email", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useMfaResetRequest).mockReturnValue({ submit, loading: false, error: null, success: false });
    render(<MemoryRouter><MfaResetRequestPage /></MemoryRouter>);

    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.click(screen.getByRole("button", { name: /send reset link/i }));
    expect(submit).toHaveBeenCalledWith("a@b.com");
  });

  it("shows a generic success state after submitting", () => {
    vi.mocked(useMfaResetRequest).mockReturnValue({ submit: vi.fn(), loading: false, error: null, success: true });
    render(<MemoryRouter><MfaResetRequestPage /></MemoryRouter>);
    expect(screen.getByText(/check your inbox/i)).toBeInTheDocument();
  });
});
