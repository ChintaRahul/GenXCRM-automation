import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import RegisterCompletePage from "../pages/RegisterComplete";
import * as client from "../api/client";

vi.mock("../api/client");

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockSignOut = vi.fn();
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { name: "Asha", orgId: null },
    updateUser: vi.fn(),
    signOut: mockSignOut,
  }),
}));

function confirmWorkspace() {
  fireEvent.click(screen.getByRole("radio", { name: /edtech/i }));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
}

describe("RegisterCompletePage", () => {
  it("shows the workspace picker before the organization form", () => {
    render(
      <MemoryRouter>
        <RegisterCompletePage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/what will you use genx crm for/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/organization name/i)).not.toBeInTheDocument();
  });

  it("shows the organization form with no Industry field after confirming a workspace", () => {
    render(
      <MemoryRouter>
        <RegisterCompletePage />
      </MemoryRouter>,
    );
    confirmWorkspace();
    expect(screen.getByLabelText(/organization name/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^industry/i)).not.toBeInTheDocument();
  });

  it("disables the submit button until the terms checkbox is checked", () => {
    render(
      <MemoryRouter>
        <RegisterCompletePage />
      </MemoryRouter>,
    );
    confirmWorkspace();
    expect(screen.getByRole("button", { name: /complete setup/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: /complete setup/i })).not.toBeDisabled();
  });

  it("sends workspaceType and acceptedTerms: true once checked and submitted", async () => {
    vi.mocked(client.completeProfile).mockResolvedValue({ token: "tok" });
    render(
      <MemoryRouter>
        <RegisterCompletePage />
      </MemoryRouter>,
    );
    confirmWorkspace();

    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: "Acme Edu" } });
    fireEvent.change(screen.getByLabelText(/team size/i), { target: { value: "SMALL" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /complete setup/i }));

    await vi.waitFor(() =>
      expect(client.completeProfile).toHaveBeenCalledWith(
        expect.objectContaining({ acceptedTerms: true, workspaceType: "EDTECH" }),
      ),
    );
    const payload = vi.mocked(client.completeProfile).mock.calls[0][0];
    expect(payload).not.toHaveProperty("industry");
  });

  it("signs the user out before navigating to /login when Back is clicked on the workspace step", () => {
    render(
      <MemoryRouter>
        <RegisterCompletePage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });
});
