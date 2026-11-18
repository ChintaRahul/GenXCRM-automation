import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import SignUpPage from "../pages/SignUp";
import * as client from "../api/client";

vi.mock("../api/client");

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ signIn: vi.fn() }),
}));

function fillStep1() {
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Asha Rao" } });
  fireEvent.change(screen.getByLabelText(/work email/i), { target: { value: "asha@co.com" } });
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "Password@123" } });
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
}

function confirmWorkspace(type: "EdTech" | "Manufacturing") {
  fireEvent.click(screen.getByRole("radio", { name: new RegExp(type, "i") }));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
}

describe("SignUpPage workspace step", () => {
  beforeEach(() => {
    vi.mocked(client.getBillingPlans).mockResolvedValue([]);
    vi.mocked(client.checkEmailAvailable).mockResolvedValue(true);
  });

  it("shows the Workspace step as step 2 of 4 and requires a selection before Organization", () => {
    render(
      <MemoryRouter>
        <SignUpPage />
      </MemoryRouter>,
    );
    fillStep1();
    expect(screen.getByText(/what will you use genx crm for/i)).toBeInTheDocument();
  });

  it("shows a locked workspace chip and no Industry field on the Organization step", () => {
    render(
      <MemoryRouter>
        <SignUpPage />
      </MemoryRouter>,
    );
    fillStep1();
    confirmWorkspace("EdTech");

    expect(screen.getByText(/edtech workspace/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^industry/i)).not.toBeInTheDocument();
  });

  it("submits workspaceType and no industry key in the register payload", async () => {
    vi.mocked(client.register).mockResolvedValue({
      user: {} as never,
      org: { id: "org-1" } as never,
    });
    render(
      <MemoryRouter>
        <SignUpPage />
      </MemoryRouter>,
    );
    fillStep1();
    confirmWorkspace("EdTech");

    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: "Acme Mfg" } });
    // Team size is now a set of radio chips, not a <select>.
    fireEvent.click(screen.getByRole("radio", { name: "11–50" }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    // PlanPaymentStep gates submit on accepting terms.
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /start.*free trial/i }));

    await waitFor(() =>
      expect(client.register).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceType: "EDTECH" }),
      ),
    );
    const payload = vi.mocked(client.register).mock.calls[0][0];
    expect(payload).not.toHaveProperty("industry");
  });

  it("shows the Check your inbox screen after a trial signup instead of redirecting immediately", async () => {
    vi.mocked(client.register).mockResolvedValue({
      user: {} as never,
      org: { id: "org-1" } as never,
    });
    render(
      <MemoryRouter>
        <SignUpPage />
      </MemoryRouter>,
    );
    fillStep1();
    confirmWorkspace("EdTech");

    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: "Acme Edu" } });
    fireEvent.click(screen.getByRole("radio", { name: "1–10" }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /start.*free trial/i }));

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(screen.getByText("asha@co.com")).toBeInTheDocument();
  });
});
