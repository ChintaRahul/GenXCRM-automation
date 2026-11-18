import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import IntegrationsPage from "../pages/Integrations";
import { LeadStatsProvider } from "../context/LeadStatsContext";
import * as integrationsHook from "../hooks/useIntegrations";
import * as mappingsHook from "../hooks/useImportMappings";
import * as authCtx from "../context/AuthContext";
import type { User } from "../types";

vi.mock("../hooks/useIntegrations");
vi.mock("../hooks/useImportMappings");
vi.mock("../api/client");
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockUser: User = {
  id: "u1",
  name: "Dana Director",
  email: "dana@co.com",
  role: "DIRECTOR",
  teamId: null,
  orgId: "org-1",
};

const integrationsValue: ReturnType<typeof integrationsHook.useIntegrations> = {
  statuses: [],
  webhookInfo: null,
  googleWebhookInfo: null,
  whatsappWebhookInfo: null,
  whatsappConnecting: false,
  loading: false,
  error: null,
  connectFacebook: vi.fn(),
  connectGoogle: vi.fn(),
  facebookConnecting: false,
  googleConnecting: false,
  disconnect: vi.fn(),
  regenerateSecret: vi.fn(),
  loadGoogleWebhookInfo: vi.fn(),
  regenerateGoogleKey: vi.fn(),
  connectWhatsAppAccount: vi.fn(),
  loadWhatsAppWebhookInfo: vi.fn(),
  regenerateWhatsAppKey: vi.fn(),
  connectWhatsAppEmbeddedSignup: vi.fn(),
  whatsappEmbeddedSignupConnecting: false,
  emailConfig: null,
  emailConnecting: false,
  loadEmailConfig: vi.fn(),
  connectEmailSmtpAccount: vi.fn(),
  connectEmailSesDomainAccount: vi.fn(),
  checkEmailStatus: vi.fn(),
  razorpayConnecting: false,
  connectRazorpayAccount: vi.fn(),
  cashfreeConnecting: false,
  connectCashfreeAccount: vi.fn(),
  connectTradeIndiaLink: vi.fn(),
  razorpayWebhookInfo: null,
  loadRazorpayWebhookInfo: vi.fn(),
  regenerateRazorpayKey: vi.fn(),
  getStatus: vi.fn(() => undefined),
  refetch: vi.fn(),
  adAccounts: null,
  adAccountsLoading: false,
  loadAdAccounts: vi.fn(),
  pickAdAccount: vi.fn(),
  syncing: false,
  refreshInsights: vi.fn(),
  backfilling: false,
  backfillFacebook: vi.fn(),
};

const mappingsValue: ReturnType<typeof mappingsHook.useImportMappings> = {
  mappings: [],
  loading: false,
  error: null,
  createMapping: vi.fn(),
  updateMapping: vi.fn(),
  deleteMapping: vi.fn(),
  refetch: vi.fn(),
};

function renderPage() {
  return render(
    <MemoryRouter>
      <LeadStatsProvider>
        <IntegrationsPage />
      </LeadStatsProvider>
    </MemoryRouter>,
  );
}

describe("IntegrationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: mockUser,
      token: "tok",
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    });
    vi.mocked(integrationsHook.useIntegrations).mockReturnValue(integrationsValue);
    vi.mocked(mappingsHook.useImportMappings).mockReturnValue(mappingsValue);
  });

  it("renders the underline tab bar", () => {
    renderPage();
    expect(
      screen.getByRole("button", { name: /sources & channels/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /csv \/ excel import/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /webhooks/i })).toBeInTheDocument();
  });

  it("defaults to the Sources tab (CSV wizard CTA not shown)", () => {
    renderPage();
    expect(screen.queryByText(/start import wizard/i)).not.toBeInTheDocument();
  });

  it("shows the CSV wizard CTA after selecting CSV / Excel import", () => {
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /csv \/ excel import/i }),
    );
    expect(screen.getByText(/start import wizard/i)).toBeInTheDocument();
  });

  it("renders the Sources grid by default and opens a real provider panel", () => {
    renderPage();
    // Grid is the default view (placeholder providers are present).
    expect(screen.getByText("WhatsApp Business")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Meta Ads"));
    // Provider panel + back affordance shown; grid hidden.
    expect(
      screen.getByRole("button", { name: /back to all sources/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("WhatsApp Business")).not.toBeInTheDocument();
  });

  it("returns to the grid via 'Back to all sources'", () => {
    renderPage();
    fireEvent.click(screen.getByText("Meta Ads"));
    fireEvent.click(
      screen.getByRole("button", { name: /back to all sources/i }),
    );
    expect(screen.getByText("WhatsApp Business")).toBeInTheDocument();
  });

  // SCRUM-51: the Facebook/Google "Connect" buttons used to be disabled by the hook's
  // general `loading` flag (the background fetch of ALL integration statuses), so the
  // button stayed unclickable for as long as that unrelated fetch was in flight — and
  // any refetch (e.g. after connecting a different provider) disabled it again. They
  // must instead be gated only by their own provider-specific connecting flag.
  it("keeps the Connect Facebook button clickable and calls connectFacebook on click", () => {
    const connectFacebook = vi.fn();
    vi.mocked(integrationsHook.useIntegrations).mockReturnValue({
      ...integrationsValue,
      connectFacebook,
      facebookConnecting: false,
    });
    renderPage();
    fireEvent.click(screen.getByText("Meta Ads"));
    const button = screen.getByRole("button", { name: /connect facebook/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(connectFacebook).toHaveBeenCalled();
  });

  it("disables only the Google Connect button while a Google connect is in flight, leaving Facebook's untouched", () => {
    vi.mocked(integrationsHook.useIntegrations).mockReturnValue({
      ...integrationsValue,
      googleConnecting: true,
      facebookConnecting: false,
    });
    renderPage();
    fireEvent.click(screen.getByText("Meta Ads"));
    expect(screen.getByRole("button", { name: /connect facebook/i })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /back to all sources/i }));
    fireEvent.click(screen.getByText("Google Ads"));
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeDisabled();
  });

  it("renders the header Docs link and Add integration action", () => {
    renderPage();
    expect(screen.getByRole("link", { name: /docs/i })).toHaveAttribute(
      "href",
      expect.stringContaining("docs"),
    );
    expect(
      screen.getByRole("button", { name: /add integration/i }),
    ).toBeInTheDocument();
  });

  it("'Add integration' jumps back to the Sources grid", () => {
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /csv \/ excel import/i }),
    );
    expect(screen.queryByText("WhatsApp Business")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /add integration/i }),
    );
    expect(screen.getByText("WhatsApp Business")).toBeInTheDocument();
  });

  it("shows the primary Embedded Signup button and a collapsed Advanced section when not connected", () => {
    renderPage();
    fireEvent.click(screen.getByText("WhatsApp Business"));
    expect(screen.getByRole("button", { name: /connect with whatsapp/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/phone number id/i)).not.toBeInTheDocument();
  });

  it("reveals the manual paste form when Advanced is expanded", () => {
    renderPage();
    fireEvent.click(screen.getByText("WhatsApp Business"));
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
    expect(screen.getByLabelText(/phone number id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/access token/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/app secret/i)).toBeInTheDocument();
  });

  it("calls connectWhatsAppEmbeddedSignup when the primary button is clicked", () => {
    const connectWhatsAppEmbeddedSignup = vi.fn();
    vi.mocked(integrationsHook.useIntegrations).mockReturnValue({
      ...integrationsValue,
      connectWhatsAppEmbeddedSignup,
    });
    renderPage();
    fireEvent.click(screen.getByText("WhatsApp Business"));
    fireEvent.click(screen.getByRole("button", { name: /connect with whatsapp/i }));
    expect(connectWhatsAppEmbeddedSignup).toHaveBeenCalled();
  });

  it("shows webhook info and a disconnect action when WhatsApp is connected via manual paste", () => {
    vi.mocked(integrationsHook.useIntegrations).mockReturnValue({
      ...integrationsValue,
      getStatus: vi.fn((provider) =>
        provider === "WHATSAPP"
          ? { provider: "WHATSAPP" as const, status: "CONNECTED" as const, accountName: "Acme Academy", connectMethod: "MANUAL" as const }
          : undefined,
      ),
      whatsappWebhookInfo: { webhookUrl: "https://api.example.com/integrations/whatsapp/tok/webhook", verifyToken: "vtok-1" },
    });
    renderPage();
    fireEvent.click(screen.getByText("WhatsApp Business"));
    expect(screen.getByText("Acme Academy")).toBeInTheDocument();
    expect(screen.getByText(/disconnect/i)).toBeInTheDocument();
    expect(screen.getByText(/verify token/i)).toBeInTheDocument();
  });

  it("shows a simplified connected view with no webhook URL/verify token block when connectMethod is EMBEDDED_SIGNUP", () => {
    vi.mocked(integrationsHook.useIntegrations).mockReturnValue({
      ...integrationsValue,
      getStatus: vi.fn((provider) =>
        provider === "WHATSAPP"
          ? { provider: "WHATSAPP" as const, status: "CONNECTED" as const, accountName: "Acme Support", connectMethod: "EMBEDDED_SIGNUP" as const }
          : undefined,
      ),
    });
    renderPage();
    fireEvent.click(screen.getByText("WhatsApp Business"));
    expect(screen.getByText("Acme Support")).toBeInTheDocument();
    expect(screen.queryByText(/verify token/i)).not.toBeInTheDocument();
  });

  it("fills the Razorpay connect form and calls connectRazorpayAccount", () => {
    const connectRazorpayAccount = vi.fn().mockResolvedValue({ keyId: "rzp_live_abc" });
    vi.mocked(integrationsHook.useIntegrations).mockReturnValue({
      ...integrationsValue,
      connectRazorpayAccount,
      razorpayWebhookInfo: {
        webhookUrl: "https://api.example.com/api/v1/payments/webhook/RAZORPAY",
        webhookSecret: "generated-secret",
      },
    });
    renderPage();
    fireEvent.click(screen.getByText("Razorpay"));
    fireEvent.change(screen.getByLabelText(/key id/i), { target: { value: "rzp_live_abc" } });
    fireEvent.change(screen.getByLabelText(/key secret/i), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));
    expect(connectRazorpayAccount).toHaveBeenCalledWith({
      keyId: "rzp_live_abc",
      keySecret: "secret123",
    });
  });

  it("shows the Cashfree webhook URL and setup steps on the Cashfree tab", () => {
    renderPage();
    fireEvent.click(screen.getByText("Cashfree"));
    expect(screen.getByText("Set up the webhook")).toBeInTheDocument();
    expect(screen.getByText(/\/payments\/webhook\/CASHFREE$/)).toBeInTheDocument();
  });

  it("fills the Cashfree connect form and calls connectCashfreeAccount with trimmed values", () => {
    const connectCashfreeAccount = vi.fn().mockResolvedValue({ appId: "TEST123" });
    vi.mocked(integrationsHook.useIntegrations).mockReturnValue({
      ...integrationsValue,
      connectCashfreeAccount,
    });
    renderPage();
    fireEvent.click(screen.getByText("Cashfree"));
    const connect = screen.getByRole("button", { name: /^connect$/i });
    expect(connect).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/app id/i), { target: { value: " TEST123 " } });
    fireEvent.change(screen.getByLabelText(/secret key/i), { target: { value: "cf-secret" } });
    fireEvent.click(connect);
    expect(connectCashfreeAccount).toHaveBeenCalledWith({ appId: "TEST123", secretKey: "cf-secret" });
  });

  it("shows the generated webhook secret masked, with a way to reveal and regenerate it", () => {
    renderPage();
    fireEvent.click(screen.getByText("Razorpay"));
    expect(screen.queryByLabelText(/webhook secret/i)).not.toBeInTheDocument();
    expect(screen.getByText(/regenerate/i)).toBeInTheDocument();
  });

  it("shows the masked Key ID and a disconnect action when Razorpay is connected", () => {
    vi.mocked(integrationsHook.useIntegrations).mockReturnValue({
      ...integrationsValue,
      getStatus: vi.fn((provider) =>
        provider === "RAZORPAY"
          ? { provider: "RAZORPAY" as const, status: "CONNECTED" as const, maskedAccountId: "****cdef" }
          : undefined,
      ),
    });
    renderPage();
    fireEvent.click(screen.getByText("Razorpay"));
    expect(screen.getByText(/\*\*\*\*cdef/)).toBeInTheDocument();
    expect(screen.getByText(/disconnect/i)).toBeInTheDocument();
  });
});
