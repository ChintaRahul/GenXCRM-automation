import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MfaStatusCard } from "../components/shared/MfaStatusCard";
import * as client from "../api/client";

vi.mock("../api/client");

const mockUpdateUser = vi.fn();
let mockUser: { mfaConfigured?: boolean } = { mfaConfigured: false };
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, updateUser: mockUpdateUser }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

describe("MfaStatusCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { mfaConfigured: false };
  });

  it("shows 'Not enabled' and navigates to /mfa-setup on Set up, calling onBeforeSetup first", async () => {
    const onBeforeSetup = vi.fn();
    render(
      <MemoryRouter>
        <MfaStatusCard onBeforeSetup={onBeforeSetup} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Not enabled")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /set up/i }));
    expect(onBeforeSetup).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/mfa-setup");
  });

  it("shows 'Enabled' and a Disable button when the user has MFA configured", async () => {
    mockUser = { mfaConfigured: true };
    vi.mocked(client.disableMfa).mockResolvedValue({ disabled: true });
    render(
      <MemoryRouter>
        <MfaStatusCard />
      </MemoryRouter>,
    );
    expect(screen.getByText("Enabled")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /disable/i }));
    await userEvent.type(screen.getByPlaceholderText(/current 6-digit code/i), "123456");
    await userEvent.click(screen.getByRole("button", { name: /confirm disable/i }));

    expect(client.disableMfa).toHaveBeenCalledWith("123456");
    expect(mockUpdateUser).toHaveBeenCalledWith(expect.objectContaining({ mfaConfigured: false }));
  });
});
