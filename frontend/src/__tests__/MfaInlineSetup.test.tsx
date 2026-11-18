import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MfaInlineSetup } from "../components/shared/MfaInlineSetup";
import * as client from "../api/client";

vi.mock("../api/client");

const mockSignIn = vi.fn();
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ signIn: mockSignIn }) }));

describe("MfaInlineSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.initMfaSetup).mockResolvedValue({ setupToken: "tok", qrCodeDataUrl: "data:image/png;base64,xx", secret: "ABCD" });
  });

  it("shows the QR + manual key and only enables verify once 6 digits are entered", async () => {
    render(<MfaInlineSetup onCancel={vi.fn()} />);
    expect(await screen.findByAltText(/qr code/i)).toBeInTheDocument();
    expect(screen.getByText("ABCD")).toBeInTheDocument();
    const verify = screen.getByRole("button", { name: /verify & turn on/i });
    expect(verify).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/6-digit code/i), "12345");
    expect(verify).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/6-digit code/i), "6");
    expect(verify).toBeEnabled();
  });

  it("verifies, signs in with the new session and shows recovery codes", async () => {
    const user = { id: "u1", mfaConfigured: true };
    vi.mocked(client.verifyMfaSetup).mockResolvedValue({ token: "jwt", user, recoveryCodes: ["rc-1", "rc-2"] } as never);
    render(<MfaInlineSetup onCancel={vi.fn()} />);
    await screen.findByAltText(/qr code/i);
    await userEvent.type(screen.getByLabelText(/6-digit code/i), "123456");
    await userEvent.click(screen.getByRole("button", { name: /verify & turn on/i }));
    expect(client.verifyMfaSetup).toHaveBeenCalledWith("tok", "123456");
    expect(mockSignIn).toHaveBeenCalledWith("jwt", user);
    expect(await screen.findByText("rc-1")).toBeInTheDocument();
  });

  it("shows the error and stays on the code step when verify fails", async () => {
    vi.mocked(client.verifyMfaSetup).mockRejectedValue(new Error("bad"));
    render(<MfaInlineSetup onCancel={vi.fn()} />);
    await screen.findByAltText(/qr code/i);
    await userEvent.type(screen.getByLabelText(/6-digit code/i), "123456");
    await userEvent.click(screen.getByRole("button", { name: /verify & turn on/i }));
    expect(await screen.findByText(/isn't correct/i)).toBeInTheDocument();
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});
