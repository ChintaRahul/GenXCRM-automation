import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import ResetPasswordPage from "../pages/ResetPassword";
import * as client from "../api/client";

vi.mock("../api/client");

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ResetPasswordPage />
    </MemoryRouter>,
  );
}

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the invalid-link state when no token is present", () => {
    renderAt("/reset-password");
    expect(screen.getByText(/invalid link/i)).toBeInTheDocument();
  });

  it("blocks submission and warns when passwords are too short", async () => {
    renderAt("/reset-password?token=abc");
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    await waitFor(() =>
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument(),
    );
    expect(client.resetPassword).not.toHaveBeenCalled();
  });

  it("blocks submission and warns when passwords do not match", async () => {
    renderAt("/reset-password?token=abc");
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: "LongEnough@1" },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "Different@1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    await waitFor(() =>
      expect(screen.getByText(/do not match/i)).toBeInTheDocument(),
    );
    expect(client.resetPassword).not.toHaveBeenCalled();
  });

  it("shows a strength meter as the user types a password", () => {
    renderAt("/reset-password?token=abc");
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: "abc" },
    });
    expect(screen.getByText(/weak/i)).toBeInTheDocument();
  });

  it("flags mismatch live on blur, before submit", () => {
    renderAt("/reset-password?token=abc");
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: "LongEnough@1" },
    });
    const confirm = screen.getByLabelText(/confirm password/i);
    fireEvent.change(confirm, { target: { value: "Different@1" } });
    fireEvent.blur(confirm);
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    expect(client.resetPassword).not.toHaveBeenCalled();
  });

  it("calls resetPassword when validation passes", async () => {
    vi.mocked(client.resetPassword).mockResolvedValue({ message: "ok" });
    renderAt("/reset-password?token=abc");
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: "LongEnough@1" },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "LongEnough@1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    await waitFor(() =>
      expect(client.resetPassword).toHaveBeenCalledWith("abc", "LongEnough@1"),
    );
  });
});
