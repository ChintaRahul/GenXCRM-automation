import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrations } from "../hooks/useIntegrations";
import * as client from "../api/client";
import type {
  OrgIntegrationInfo,
  WebhookInfoDto,
  GoogleWebhookInfoDto,
} from "../types";
import { Messages } from "../lib/messages";

vi.mock("../api/client", () => ({
  getIntegrationStatuses: vi.fn(),
  getWebhookInfo: vi.fn(),
  initFacebookOAuth: vi.fn(),
  initGoogleOAuth: vi.fn(),
  disconnectIntegration: vi.fn(),
  regenerateWebhookSecret: vi.fn(),
  getGoogleWebhookInfo: vi.fn(),
  regenerateGoogleWebhookKey: vi.fn(),
  connectWhatsApp: vi.fn(),
  getWhatsAppWebhookInfo: vi.fn(),
  regenerateWhatsAppVerifyToken: vi.fn(),
  getWhatsAppEmbeddedSignupConfig: vi.fn(),
  completeWhatsAppEmbeddedSignup: vi.fn(),
  getEmailConfig: vi.fn(),
  connectEmailSmtp: vi.fn(),
  connectEmailSesDomain: vi.fn(),
  checkEmailDomainStatus: vi.fn(),
}));

vi.mock("../lib/facebookSdk", () => ({
  loadFacebookSdk: vi.fn().mockResolvedValue(undefined),
}));

const mockStatus: OrgIntegrationInfo = {
  provider: "FACEBOOK",
  status: "CONNECTED",
  accountName: "Test Page",
  maskedAccountId: "****3F2A",
};

const googleConnected: OrgIntegrationInfo = {
  provider: "GOOGLE_ADS",
  status: "CONNECTED",
  accountName: "Acme Ads",
  maskedAccountId: "****6789",
};

const mockGoogleWebhookInfo: GoogleWebhookInfoDto = {
  webhookUrl:
    "http://localhost:3000/api/v1/integrations/google/abc123/webhook",
  webhookKey: "deadbeefcafef00d",
};

const mockWebhookInfo: WebhookInfoDto = {
  webhookUrl: "http://localhost:3000/api/v1/integrations/webhook/abc123/ingest",
  webhookSecret: "abcdef0123456789ef90",
};

describe("useIntegrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getIntegrationStatuses).mockResolvedValue([]);
    vi.mocked(client.getWebhookInfo).mockResolvedValue(mockWebhookInfo);
    vi.mocked(client.disconnectIntegration).mockResolvedValue(
      undefined as never,
    );
    vi.mocked(client.regenerateWebhookSecret).mockResolvedValue(
      mockWebhookInfo,
    );
    vi.mocked(client.getGoogleWebhookInfo).mockResolvedValue(
      mockGoogleWebhookInfo,
    );
    vi.mocked(client.regenerateGoogleWebhookKey).mockResolvedValue(
      mockGoogleWebhookInfo,
    );
  });

  it("starts in loading state", () => {
    const { result } = renderHook(() => useIntegrations());
    expect(result.current.loading).toBe(true);
  });

  it("fetches statuses and webhook info on mount", async () => {
    vi.mocked(client.getIntegrationStatuses).mockResolvedValue([mockStatus]);
    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.statuses).toHaveLength(1);
    expect(result.current.statuses[0].provider).toBe("FACEBOOK");
    expect(result.current.webhookInfo?.webhookSecret).toBe(
      "abcdef0123456789ef90",
    );
    expect(result.current.error).toBeNull();
  });

  it("sets error state when getIntegrationStatuses fails", async () => {
    vi.mocked(client.getIntegrationStatuses).mockRejectedValue(
      new Error("Network error"),
    );
    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.integrations.statusesLoadFailed);
    expect(result.current.statuses).toHaveLength(0);
  });

  it("still loads when getWebhookInfo fails (graceful degradation)", async () => {
    vi.mocked(client.getIntegrationStatuses).mockResolvedValue([mockStatus]);
    vi.mocked(client.getWebhookInfo).mockRejectedValue(new Error("Forbidden"));
    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.webhookInfo).toBeNull();
    expect(result.current.statuses).toHaveLength(1);
  });

  it("getStatus returns the matching provider status", async () => {
    vi.mocked(client.getIntegrationStatuses).mockResolvedValue([mockStatus]);
    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.getStatus("FACEBOOK")).toEqual(mockStatus);
    expect(result.current.getStatus("GOOGLE_ADS")).toBeUndefined();
  });

  it("disconnect calls API then refetches statuses", async () => {
    vi.mocked(client.getIntegrationStatuses).mockResolvedValue([mockStatus]);
    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.disconnect("FACEBOOK");
    });
    expect(client.disconnectIntegration).toHaveBeenCalledWith("FACEBOOK");
    expect(client.getIntegrationStatuses).toHaveBeenCalledTimes(2);
  });

  it("disconnect also reloads emailConfig when disconnecting EMAIL, so the UI doesn't stay stale until a manual refresh", async () => {
    vi.mocked(client.getIntegrationStatuses).mockResolvedValue([]);
    vi.mocked(client.getEmailConfig)
      .mockResolvedValueOnce({
        method: "SMTP",
        status: "CONNECTED",
        fromEmail: "sales@acme.com",
        fromName: "Acme Academy",
        maskedUsername: "****.com",
      })
      .mockResolvedValueOnce({ method: null, status: "DISCONNECTED" });

    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadEmailConfig();
    });
    expect(result.current.emailConfig?.status).toBe("CONNECTED");

    await act(async () => {
      await result.current.disconnect("EMAIL");
    });

    expect(client.disconnectIntegration).toHaveBeenCalledWith("EMAIL");
    expect(result.current.emailConfig?.status).toBe("DISCONNECTED");
  });

  it("disconnect surfaces an error toast and does not refetch on failure", async () => {
    vi.mocked(client.disconnectIntegration).mockRejectedValue(new Error("network error"));
    vi.mocked(client.getIntegrationStatuses).mockResolvedValue([mockStatus]);
    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.disconnect("FACEBOOK");
      }),
    ).rejects.toThrow();

    expect(client.getIntegrationStatuses).toHaveBeenCalledTimes(1);
  });

  it("regenerateSecret updates webhookInfo and returns new info", async () => {
    const newInfo: WebhookInfoDto = {
      webhookUrl: mockWebhookInfo.webhookUrl,
      webhookSecret: "newsecret0000000001234",
    };
    vi.mocked(client.regenerateWebhookSecret).mockResolvedValue(newInfo);
    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let returned: WebhookInfoDto | undefined;
    await act(async () => {
      returned = await result.current.regenerateSecret();
    });
    expect(returned).toEqual(newInfo);
    expect(result.current.webhookInfo?.webhookSecret).toBe(
      "newsecret0000000001234",
    );
  });

  it("refetch re-queries the API", async () => {
    vi.mocked(client.getIntegrationStatuses).mockResolvedValue([mockStatus]);
    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.refetch();
    });
    expect(client.getIntegrationStatuses).toHaveBeenCalledTimes(2);
  });

  it("connectFacebook sets error when initFacebookOAuth fails", async () => {
    vi.mocked(client.initFacebookOAuth).mockRejectedValue(
      new Error("App not configured"),
    );
    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.connectFacebook();
    });
    expect(result.current.error).toBe(Messages.integrations.oauthStartFailed);
  });

  it("connectGoogle sets error when initGoogleOAuth fails", async () => {
    vi.mocked(client.initGoogleOAuth).mockRejectedValue(
      new Error("App not configured"),
    );
    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.connectGoogle();
    });
    expect(result.current.error).toBe(Messages.integrations.oauthStartFailed);
  });

  it("does not fetch Google webhook info on mount (lazy, no OAuth gate)", async () => {
    vi.mocked(client.getIntegrationStatuses).mockResolvedValue([
      mockStatus,
      googleConnected,
    ]);
    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(client.getGoogleWebhookInfo).not.toHaveBeenCalled();
    expect(result.current.googleWebhookInfo).toBeNull();
  });

  it("loadGoogleWebhookInfo fetches and sets the URL + key on demand", async () => {
    vi.mocked(client.getIntegrationStatuses).mockResolvedValue([mockStatus]);
    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.loadGoogleWebhookInfo();
    });
    expect(client.getGoogleWebhookInfo).toHaveBeenCalledTimes(1);
    expect(result.current.googleWebhookInfo?.webhookKey).toBe(
      "deadbeefcafef00d",
    );
  });

  it("regenerateGoogleKey updates googleWebhookInfo and returns new info", async () => {
    const newInfo: GoogleWebhookInfoDto = {
      webhookUrl: mockGoogleWebhookInfo.webhookUrl,
      webhookKey: "newkey1234",
    };
    vi.mocked(client.regenerateGoogleWebhookKey).mockResolvedValue(newInfo);
    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let returned: GoogleWebhookInfoDto | undefined;
    await act(async () => {
      returned = await result.current.regenerateGoogleKey();
    });
    expect(returned).toEqual(newInfo);
    expect(result.current.googleWebhookInfo?.webhookKey).toBe("newkey1234");
  });
});

describe("useIntegrations — WhatsApp", () => {
  it("connectWhatsAppAccount calls the API and refreshes statuses on success", async () => {
    vi.mocked(client.connectWhatsApp).mockResolvedValue({
      accountName: "Acme Academy",
      webhookUrl: "https://api.example.com/integrations/whatsapp/tok/webhook",
      verifyToken: "vtok-1",
    });
    vi.mocked(client.getIntegrationStatuses).mockResolvedValue([]);
    vi.mocked(client.getWebhookInfo).mockResolvedValue({ webhookUrl: "x", webhookSecret: null });

    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.connectWhatsAppAccount({
        phoneNumberId: "123",
        accessToken: "tok",
        appSecret: "secret",
        businessAccountId: "waba-1",
      });
    });

    expect(client.connectWhatsApp).toHaveBeenCalledWith({
      phoneNumberId: "123",
      accessToken: "tok",
      appSecret: "secret",
      businessAccountId: "waba-1",
    });
    expect(result.current.whatsappWebhookInfo).toEqual({
      webhookUrl: "https://api.example.com/integrations/whatsapp/tok/webhook",
      verifyToken: "vtok-1",
    });
  });

  it("connectWhatsAppAccount surfaces an error on failure without crashing", async () => {
    vi.mocked(client.connectWhatsApp).mockRejectedValue(new Error("bad creds"));
    vi.mocked(client.getIntegrationStatuses).mockResolvedValue([]);
    vi.mocked(client.getWebhookInfo).mockResolvedValue({ webhookUrl: "x", webhookSecret: null });

    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.connectWhatsAppAccount({
          phoneNumberId: "1",
          accessToken: "t",
          appSecret: "s",
          businessAccountId: "w",
        });
      }),
    ).rejects.toThrow();
  });
});

describe("useIntegrations — Email", () => {
  beforeEach(() => {
    vi.mocked(client.getIntegrationStatuses).mockResolvedValue([]);
    vi.mocked(client.getWebhookInfo).mockResolvedValue({ webhookUrl: "x", webhookSecret: null });
  });

  it("connectEmailSmtpAccount calls the API and reloads config + statuses on success", async () => {
    vi.mocked(client.connectEmailSmtp).mockResolvedValue({ fromEmail: "sales@acme.com" });
    vi.mocked(client.getEmailConfig).mockResolvedValue({
      method: "SMTP",
      status: "CONNECTED",
      fromEmail: "sales@acme.com",
      fromName: "Acme Academy",
      maskedUsername: "****.com",
    });

    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.connectEmailSmtpAccount({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        username: "sales@acme.com",
        password: "app-pass",
        fromEmail: "sales@acme.com",
        fromName: "Acme Academy",
      });
    });

    expect(client.connectEmailSmtp).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.gmail.com", username: "sales@acme.com" }),
    );
    expect(result.current.emailConfig?.status).toBe("CONNECTED");
  });

  it("connectEmailSmtpAccount surfaces an error on failure without crashing", async () => {
    vi.mocked(client.connectEmailSmtp).mockRejectedValue(new Error("bad smtp creds"));

    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.connectEmailSmtpAccount({
          host: "smtp.gmail.com",
          port: 587,
          secure: false,
          username: "sales@acme.com",
          password: "wrong",
          fromEmail: "sales@acme.com",
          fromName: "Acme Academy",
        });
      }),
    ).rejects.toThrow();
  });

  it("connectEmailSesDomainAccount calls the API and stores the returned DNS records", async () => {
    vi.mocked(client.connectEmailSesDomain).mockResolvedValue({
      domain: "acme.com",
      dnsRecords: [{ type: "TXT", name: "_amazonses.acme.com", value: "vtoken" }],
    });
    vi.mocked(client.getEmailConfig).mockResolvedValue({
      method: "SES_DOMAIN",
      status: "PENDING",
      domain: "acme.com",
      dnsRecords: [{ type: "TXT", name: "_amazonses.acme.com", value: "vtoken" }],
    });

    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.connectEmailSesDomainAccount({
        domain: "acme.com",
        fromEmail: "sales@acme.com",
        fromName: "Acme Academy",
      });
    });

    expect(client.connectEmailSesDomain).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "acme.com" }),
    );
    expect(result.current.emailConfig?.status).toBe("PENDING");
    expect(result.current.emailConfig?.dnsRecords).toHaveLength(1);
  });

  it("checkEmailStatus updates emailConfig from the API response", async () => {
    vi.mocked(client.checkEmailDomainStatus).mockResolvedValue({
      method: "SES_DOMAIN",
      status: "CONNECTED",
      domain: "acme.com",
    });

    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.checkEmailStatus();
    });

    expect(result.current.emailConfig?.status).toBe("CONNECTED");
  });
});

describe("useIntegrations — connectWhatsAppEmbeddedSignup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getIntegrationStatuses).mockResolvedValue([]);
    vi.mocked(client.getWebhookInfo).mockResolvedValue(mockWebhookInfo);
    vi.mocked(client.getWhatsAppEmbeddedSignupConfig).mockResolvedValue({
      appId: "app-123",
      configId: "cfg-456",
    });
    (window as unknown as { FB?: unknown }).FB = {
      login: vi.fn(),
    };
  });

  it("completes signup when both the login code and the postMessage signup data arrive", async () => {
    vi.mocked(client.completeWhatsAppEmbeddedSignup).mockResolvedValue({ accountName: "Acme Support" });
    const fbLogin = vi.fn((callback: (r: { authResponse?: { code?: string } }) => void) => {
      callback({ authResponse: { code: "auth-code-1" } });
    });
    (window as unknown as { FB: { login: typeof fbLogin } }).FB = { login: fbLogin };

    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let connectPromise: Promise<unknown>;
    act(() => {
      connectPromise = result.current.connectWhatsAppEmbeddedSignup();
    });

    // Let the pending config-fetch/SDK-load awaits resolve so the message listener and
    // FB.login call actually run before the postMessage below is dispatched — otherwise
    // it fires with no listener registered yet and the test hangs waiting on it forever.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Simulate the WA_EMBEDDED_SIGNUP postMessage Meta fires during the popup flow.
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://www.facebook.com",
          data: { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { phone_number_id: "pn-1", waba_id: "waba-1" } },
        }),
      );
    });

    await connectPromise!;

    expect(client.completeWhatsAppEmbeddedSignup).toHaveBeenCalledWith({
      code: "auth-code-1",
      phoneNumberId: "pn-1",
      wabaId: "waba-1",
    });
  });

  it("does not call completeWhatsAppEmbeddedSignup when the user cancels FB.login (no code)", async () => {
    const fbLogin = vi.fn((callback: (r: { authResponse?: { code?: string } }) => void) => {
      callback({ authResponse: undefined });
    });
    (window as unknown as { FB: { login: typeof fbLogin } }).FB = { login: fbLogin };

    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.connectWhatsAppEmbeddedSignup();
    });

    expect(client.completeWhatsAppEmbeddedSignup).not.toHaveBeenCalled();
  });

  it("surfaces an error toast when getWhatsAppEmbeddedSignupConfig fails", async () => {
    vi.mocked(client.getWhatsAppEmbeddedSignupConfig).mockRejectedValue(new Error("not configured"));

    const { result } = renderHook(() => useIntegrations());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.connectWhatsAppEmbeddedSignup()).rejects.toThrow();
    });

    expect(client.completeWhatsAppEmbeddedSignup).not.toHaveBeenCalled();
  });
});
