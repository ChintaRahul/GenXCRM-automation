import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import MfaSetupPage from "../pages/MfaSetup";
import { useMfaSetup } from "../hooks/useMfaSetup";
import { saveFile } from "../lib/platform";
import type { User } from "../types";

vi.mock("../hooks/useMfaSetup", () => ({
  useMfaSetup: vi.fn(),
}));

vi.mock("../lib/platform", () => ({ saveFile: vi.fn() }));

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

function renderAt(state: object | undefined) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/mfa-setup", state }]}>
      <Routes>
        <Route path="/mfa-setup" element={<MfaSetupPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MfaSetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("self-service: calls init() on mount and shows the returned QR code", async () => {
    const init = vi.fn().mockResolvedValue({
      setupToken: "setup-token",
      qrCodeDataUrl: "data:image/png;base64,xyz",
      secret: "SECRET",
    });
    vi.mocked(useMfaSetup).mockReturnValue({
      init,
      getSetupInfo: vi.fn(),
      verify: vi.fn(),
      loading: false,
      error: null,
    });
    renderAt(undefined);

    await waitFor(() => expect(init).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByAltText(/qr code/i)).toBeInTheDocument());
    expect(screen.getByText("SECRET")).toBeInTheDocument();
  });

  it("forced: uses the QR/secret already provided via location.state without calling init()", async () => {
    const init = vi.fn();
    const getSetupInfo = vi.fn();
    vi.mocked(useMfaSetup).mockReturnValue({ init, getSetupInfo, verify: vi.fn(), loading: false, error: null });
    renderAt({ setupToken: "setup-token", qrCodeDataUrl: "data:image/png;base64,xyz", secret: "SECRET" });

    expect(screen.getByAltText(/qr code/i)).toBeInTheDocument();
    expect(init).not.toHaveBeenCalled();
    expect(getSetupInfo).not.toHaveBeenCalled();
  });

  it("forced via SSO: fetches QR/secret via getSetupInfo when location.state carries only the setupToken", async () => {
    const getSetupInfo = vi.fn().mockResolvedValue({
      qrCodeDataUrl: "data:image/png;base64,xyz",
      secret: "SECRET",
    });
    vi.mocked(useMfaSetup).mockReturnValue({
      init: vi.fn(),
      getSetupInfo,
      verify: vi.fn(),
      loading: false,
      error: null,
    });
    renderAt({ setupToken: "setup-token" });

    await waitFor(() => expect(getSetupInfo).toHaveBeenCalledWith("setup-token"));
    await waitFor(() => expect(screen.getByAltText(/qr code/i)).toBeInTheDocument());
    expect(screen.getByText("SECRET")).toBeInTheDocument();
  });

  it("signs in and navigates home on a correct code", async () => {
    const verify = vi.fn().mockResolvedValue({ enabled: true, token: "session-token", user, recoveryCodes: [] });
    vi.mocked(useMfaSetup).mockReturnValue({
      init: vi.fn(),
      getSetupInfo: vi.fn(),
      verify,
      loading: false,
      error: null,
    });
    renderAt({ setupToken: "setup-token", qrCodeDataUrl: "data:image/png;base64,xyz", secret: "SECRET" });

    await userEvent.type(screen.getByLabelText(/verification code/i), "123456");
    await userEvent.click(screen.getByRole("button", { name: /verify and enable/i }));

    expect(verify).toHaveBeenCalledWith("setup-token", "123456");
    expect(mockSignIn).toHaveBeenCalledWith("session-token", user);
    await userEvent.click(await screen.findByRole("button", { name: /continue/i }));
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("shows recovery codes after a correct code and lets the user download them", async () => {
    const verify = vi.fn().mockResolvedValue({
      enabled: true,
      token: "session-token",
      user,
      recoveryCodes: ["ABCD-1234", "EFGH-5678"],
    });
    vi.mocked(useMfaSetup).mockReturnValue({
      init: vi.fn(),
      getSetupInfo: vi.fn(),
      verify,
      loading: false,
      error: null,
    });
    renderAt({ setupToken: "setup-token", qrCodeDataUrl: "data:image/png;base64,xyz", secret: "SECRET" });

    await userEvent.type(screen.getByLabelText(/verification code/i), "123456");
    await userEvent.click(screen.getByRole("button", { name: /verify and enable/i }));

    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
    expect(screen.getByText("EFGH-5678")).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /download codes/i }));
    expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), "genxcrm-recovery-codes.csv");

    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("self-service: signs in and returns to the previous page (not the dashboard) on a correct code", async () => {
    const verify = vi.fn().mockResolvedValue({ enabled: true, token: "session-token", user, recoveryCodes: [] });
    vi.mocked(useMfaSetup).mockReturnValue({
      init: vi.fn().mockResolvedValue({
        setupToken: "setup-token",
        qrCodeDataUrl: "data:image/png;base64,xyz",
        secret: "SECRET",
      }),
      getSetupInfo: vi.fn(),
      verify,
      loading: false,
      error: null,
    });
    renderAt(undefined);
    await screen.findByAltText(/qr code/i);

    await userEvent.type(screen.getByLabelText(/verification code/i), "123456");
    await userEvent.click(screen.getByRole("button", { name: /verify and enable/i }));

    expect(verify).toHaveBeenCalledWith("setup-token", "123456");
    expect(mockSignIn).toHaveBeenCalledWith("session-token", user);
    await userEvent.click(await screen.findByRole("button", { name: /continue/i }));
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it("self-service: cancelling (X button) goes back to the previous page without signing in", async () => {
    vi.mocked(useMfaSetup).mockReturnValue({
      init: vi.fn().mockResolvedValue({ setupToken: "t", qrCodeDataUrl: "data:image/png;base64,x", secret: "S" }),
      getSetupInfo: vi.fn(),
      verify: vi.fn(),
      loading: false,
      error: null,
    });
    renderAt(undefined);
    await userEvent.click(await screen.findByRole("button", { name: /cancel and close/i }));
    expect(mockNavigate).toHaveBeenCalledWith(-1);
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("self-service: pressing Escape cancels back to the previous page", async () => {
    vi.mocked(useMfaSetup).mockReturnValue({
      init: vi.fn().mockResolvedValue({ setupToken: "t", qrCodeDataUrl: "data:image/png;base64,x", secret: "S" }),
      getSetupInfo: vi.fn(),
      verify: vi.fn(),
      loading: false,
      error: null,
    });
    renderAt(undefined);
    await screen.findByAltText(/qr code/i);
    await userEvent.keyboard("{Escape}");
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it("forced: cancelling returns to /login, not the app", async () => {
    vi.mocked(useMfaSetup).mockReturnValue({
      init: vi.fn(),
      getSetupInfo: vi.fn(),
      verify: vi.fn(),
      loading: false,
      error: null,
    });
    renderAt({ setupToken: "setup-token", qrCodeDataUrl: "data:image/png;base64,xyz", secret: "SECRET" });
    await userEvent.click(screen.getByRole("button", { name: /cancel and back to sign in/i }));
    expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
  });
});
