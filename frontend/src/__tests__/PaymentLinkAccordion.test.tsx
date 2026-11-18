import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaymentLinkAccordion } from "../components/invoices/PaymentLinkAccordion";
import * as client from "../api/client";
import type { PaymentGatewayStatus } from "../types";

vi.mock("../api/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockGateways: PaymentGatewayStatus[] = [{ gateway: "RAZORPAY", connected: true }];

async function renderAccordion(open = true) {
  const result = render(
    <PaymentLinkAccordion
      ensureInvoiceId={async () => "inv-1"}
      open={open}
      onToggle={vi.fn()}
    />,
  );
  // Collapsed accordions don't render PaymentLinkForm at all, so there's nothing to
  // fetch gateways for — only wait for the fetch when the panel is actually open.
  if (open) {
    await waitFor(() => expect(client.getConnectedPaymentGateways).toHaveBeenCalled());
  }
  return result;
}

describe("PaymentLinkAccordion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getConnectedPaymentGateways).mockResolvedValue(mockGateways);
    vi.mocked(client.getInvoice).mockResolvedValue({ id: "inv-1", registrationFeePaidAt: null } as never);
  });

  it("stays collapsed until open is true", async () => {
    await renderAccordion(false);
    expect(screen.queryByText("Use payment gateway")).toBeNull();
    expect(client.getConnectedPaymentGateways).not.toHaveBeenCalled();
  });

  it("shows the gateway/custom sub-section when open", async () => {
    await renderAccordion(true);
    expect(screen.getByText("Use payment gateway")).toBeInTheDocument();
    expect(screen.getByText("Enter custom link")).toBeInTheDocument();
  });

  it("custom mode hides the gateway select and shows a URL input", async () => {
    await renderAccordion(true);
    expect(screen.getByRole("combobox")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Enter custom link"));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByPlaceholderText("Paste an existing payment link")).toBeInTheDocument();
  });

  it("sends a GATEWAY link with the default-selected Razorpay gateway", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    await renderAccordion(true);

    await user.click(screen.getByText("Send Link"));

    await waitFor(() =>
      expect(client.sendRegistrationPaymentLink).toHaveBeenCalledWith("inv-1", {
        source: "GATEWAY",
        gateway: "RAZORPAY",
      }),
    );
  });

  it("does not pre-select a gateway when several are connected, so Send Link waits for a choice", async () => {
    vi.mocked(client.getConnectedPaymentGateways).mockResolvedValue([
      { gateway: "RAZORPAY", connected: true },
      { gateway: "CASHFREE", connected: true },
    ]);
    await renderAccordion(true);
    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
    expect(screen.getByText("Select a gateway")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send link/i })).toBeDisabled();
  });

  it("sends a CUSTOM link with the pasted URL", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    await renderAccordion(true);
    fireEvent.click(screen.getByText("Enter custom link"));

    fireEvent.change(screen.getByPlaceholderText("Paste an existing payment link"), {
      target: { value: "https://pay.example.com/abc" },
    });
    await user.click(screen.getByText("Send Link"));

    await waitFor(() =>
      expect(client.sendRegistrationPaymentLink).toHaveBeenCalledWith("inv-1", {
        source: "CUSTOM",
        customUrl: "https://pay.example.com/abc",
      }),
    );
  });

  it("enables Send Link once Razorpay is connected (the only, default-selected gateway)", async () => {
    await renderAccordion(true);
    expect(screen.getByText("Send Link").closest("button")).not.toBeDisabled();
  });

  it("disables Send Link when Razorpay isn't connected", async () => {
    vi.mocked(client.getConnectedPaymentGateways).mockResolvedValue([
      { gateway: "RAZORPAY", connected: false },
    ]);
    await renderAccordion(true);
    expect(screen.getByText("Send Link").closest("button")).toBeDisabled();
  });

  it("resolves the invoice id lazily via ensureInvoiceId only when sending", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    const ensureInvoiceId = vi.fn().mockResolvedValue("inv-lazy");
    const result = render(
      <PaymentLinkAccordion ensureInvoiceId={ensureInvoiceId} open onToggle={vi.fn()} />,
    );
    await waitFor(() => expect(client.getConnectedPaymentGateways).toHaveBeenCalled());
    expect(ensureInvoiceId).not.toHaveBeenCalled();

    await user.click(result.getByText("Send Link"));

    await waitFor(() =>
      expect(client.sendRegistrationPaymentLink).toHaveBeenCalledWith("inv-lazy", {
        source: "GATEWAY",
        gateway: "RAZORPAY",
      }),
    );
    expect(ensureInvoiceId).toHaveBeenCalledTimes(1);
  });

  it("eagerly checks paid status when knownInvoiceId is given, without needing a click", async () => {
    vi.mocked(client.getInvoice).mockResolvedValue({
      id: "inv-1",
      registrationFeePaidAt: "2026-09-18T00:00:00.000Z",
    } as never);
    render(
      <PaymentLinkAccordion
        ensureInvoiceId={async () => "inv-1"}
        knownInvoiceId="inv-1"
        open
        onToggle={vi.fn()}
      />,
    );
    await waitFor(() => expect(client.getInvoice).toHaveBeenCalledWith("inv-1"));
    expect(await screen.findByText(/Paid on/)).toBeInTheDocument();
    expect(screen.queryByText("Send Link")).toBeNull();
  });

  it("marks the registration fee paid via the manual override button", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    vi.mocked(client.markRegistrationFeePaid).mockResolvedValue({
      id: "inv-1",
      registrationFeePaidAt: "2026-09-18T00:00:00.000Z",
    } as never);
    await renderAccordion(true);

    await user.click(screen.getByText("Mark as paid"));

    await waitFor(() => expect(client.markRegistrationFeePaid).toHaveBeenCalledWith("inv-1"));
    expect(await screen.findByText(/Paid on/)).toBeInTheDocument();
  });
});
