import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProfileTab } from "../components/admin/ProfileTab";
import * as client from "../api/client";
import type { User } from "../types";

vi.mock("../api/client");

const mockSignIn = vi.fn();
const mockUpdateUser = vi.fn();
const baseUser: User = {
  id: "u1",
  name: "Rep One",
  email: "rep@co.com",
  role: "SALES_REP",
  teamId: null,
  mfaConfigured: false,
};
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: baseUser, updateUser: mockUpdateUser, signIn: mockSignIn }),
}));

describe("ProfileTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the name and read-only email, with no MFA section (Security tab owns that now)", () => {
    render(
      <MemoryRouter>
        <ProfileTab />
      </MemoryRouter>,
    );
    expect(screen.getByDisplayValue("Rep One")).toBeInTheDocument();
    expect(screen.getByDisplayValue("rep@co.com")).toBeDisabled();
    expect(screen.queryByText(/two-factor authentication/i)).not.toBeInTheDocument();
  });

  it("saves name changes via updateUser when no password is set", async () => {
    vi.mocked(client.updateMe).mockResolvedValue({ ...baseUser, name: "New Name" });
    render(
      <MemoryRouter>
        <ProfileTab />
      </MemoryRouter>,
    );
    const nameInput = screen.getByDisplayValue("Rep One");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "New Name");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(client.updateMe).toHaveBeenCalledWith({ name: "New Name" });
    expect(mockUpdateUser).toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("signs back in with the fresh token when a password change reissues one", async () => {
    vi.mocked(client.updateMe).mockResolvedValue({ ...baseUser, token: "new-token" });
    render(
      <MemoryRouter>
        <ProfileTab />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText(/current password/i), "OldPass1");
    await userEvent.type(screen.getByLabelText(/new password/i), "NewPass1");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(client.updateMe).toHaveBeenCalledWith(
      expect.objectContaining({ currentPassword: "OldPass1", newPassword: "NewPass1" }),
    );
    expect(mockSignIn).toHaveBeenCalledWith("new-token", expect.objectContaining({ id: "u1" }));
  });
});
