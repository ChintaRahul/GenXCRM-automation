import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  getIntegrationStatuses,
  initFacebookOAuth,
  initGoogleOAuth,
  disconnectIntegration,
  getWebhookInfo,
  regenerateWebhookSecret,
  getGoogleWebhookInfo,
  regenerateGoogleWebhookKey,
  listFacebookAdAccounts,
  connectFacebookAdAccount,
  syncFacebookInsights,
  manualBackfillFacebook,
  connectWhatsApp,
  getWhatsAppWebhookInfo,
  regenerateWhatsAppVerifyToken,
  getWhatsAppEmbeddedSignupConfig,
  completeWhatsAppEmbeddedSignup,
  getEmailConfig,
  connectEmailSmtp,
  connectEmailSesDomain,
  checkEmailDomainStatus,
  connectRazorpay,
  connectCashfree,
  connectTradeIndia,
  getRazorpayWebhookInfo,
  regenerateRazorpayWebhookSecret,
} from "../api/client";
import type {
  OrgIntegrationInfo,
  IntegrationProvider,
  WebhookInfoDto,
  GoogleWebhookInfoDto,
  WhatsAppWebhookInfoDto,
  EmailConfigDto,
  RazorpayWebhookInfoDto,
} from "../types";
import type { FacebookAdAccount } from "../api/client";
import { isNative, openExternal, webAppUrl } from "../lib/platform";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import { loadFacebookSdk } from "../lib/facebookSdk";

// Origin the OAuth popup posts back from (where the API serves the callback HTML).
// Same-origin in prod (`/api/v1`); an absolute host (e.g. ngrok) in some dev setups.
function apiOrigin(): string | null {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!base) return window.location.origin; // relative "/api/v1" → same origin
  try {
    return new URL(base, window.location.origin).origin;
  } catch {
    return null;
  }
}

const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  FACEBOOK: "Facebook",
  GOOGLE_ADS: "Google Ads",
  WEBHOOK: "Webhook",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  RAZORPAY: "Razorpay",
  CASHFREE: "Cashfree",
  TRADEINDIA: "TradeIndia",
  GOOGLE_FORMS: "Google Forms",
};

interface OAuthMessage {
  type: "genxcrm-oauth";
  provider: "facebook" | "google";
  status: "success" | "error";
  account?: string;
  message?: string;
}

export function useIntegrations() {
  const [statuses, setStatuses] = useState<OrgIntegrationInfo[]>([]);
  const [webhookInfo, setWebhookInfo] = useState<WebhookInfoDto | null>(null);
  const [googleWebhookInfo, setGoogleWebhookInfo] =
    useState<GoogleWebhookInfoDto | null>(null);
  const [whatsappWebhookInfo, setWhatsappWebhookInfo] =
    useState<WhatsAppWebhookInfoDto | null>(null);
  const [whatsappConnecting, setWhatsappConnecting] = useState(false);
  const [emailConfig, setEmailConfig] = useState<EmailConfigDto | null>(null);
  const [emailConnecting, setEmailConnecting] = useState(false);
  const [razorpayConnecting, setRazorpayConnecting] = useState(false);
  const [cashfreeConnecting, setCashfreeConnecting] = useState(false);
  const [razorpayWebhookInfo, setRazorpayWebhookInfo] = useState<RazorpayWebhookInfoDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatuses = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [data, info] = await Promise.all([
        getIntegrationStatuses(),
        getWebhookInfo().catch(() => null),
      ]);
      setStatuses(data);
      setWebhookInfo(info);
    } catch {
      setError(Messages.integrations.statusesLoadFailed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatuses();
  }, [fetchStatuses]);

  // Per-provider "connect" in-flight flags — kept separate from `loading` (which tracks the
  // initial/background fetch of ALL integration statuses). Gating the Connect buttons on
  // `loading` instead of one of these meant the button went disabled — and stayed disabled —
  // for as long as any statuses refetch was in flight, including ones unrelated to the click
  // (e.g. right after connecting a different provider), making it look permanently unclickable
  // (SCRUM-51).
  const [facebookConnecting, setFacebookConnecting] = useState(false);
  const [googleConnecting, setGoogleConnecting] = useState(false);

  const openOAuthPopup = useCallback(
    (
        initFn: () => Promise<{ url: string }>,
        label: string,
        setConnecting: (v: boolean) => void,
      ) =>
      async () => {
      // OAuth uses a popup window + postMessage handshake, neither of which works
      // inside the native WebView. Send the user to the web dashboard to connect.
      if (isNative()) {
        toast.info(Messages.integrations.connectFromWeb(label));
        await openExternal(`${webAppUrl()}/integrations`);
        return;
      }
      setConnecting(true);
      try {
        const { url } = await initFn();
        const popup = window.open(
          url,
          "oauth-popup",
          "width=620,height=760,left=400,top=80",
        );
        // The click has done its job (the popup is open) — re-enable the button now rather
        // than for the whole lifetime of the popup/handshake below.
        setConnecting(false);

        const allowedOrigin = apiOrigin();
        let settled = false;

        const cleanup = () => {
          window.removeEventListener("message", onMessage);
          clearInterval(poll);
        };

        const onMessage = (e: MessageEvent) => {
          if (allowedOrigin && e.origin !== allowedOrigin) return;
          const data = e.data as Partial<OAuthMessage> | null;
          if (!data || data.type !== "genxcrm-oauth") return;
          settled = true;
          cleanup();
          if (data.status === "success") {
            toast.success(
              data.account
                ? Messages.integrations.connectedWith(label, data.account)
                : Messages.integrations.connected(label),
            );
          } else {
            toast.error(data.message || Messages.integrations.connectFailed(label));
          }
          try {
            popup?.close();
          } catch {
            /* cross-origin close may throw — ignore */
          }
          void fetchStatuses();
        };
        window.addEventListener("message", onMessage);

        // Fallback: user closed the window manually (or messaging was blocked).
        const poll = setInterval(() => {
          if (popup?.closed) {
            cleanup();
            if (!settled) void fetchStatuses();
          }
        }, 600);
      } catch {
        setError(Messages.integrations.oauthStartFailed);
        toast.error(Messages.integrations.connectStartFailed(label));
      } finally {
        setConnecting(false);
      }
    },
    [fetchStatuses],
  );

  const connectFacebook = openOAuthPopup(initFacebookOAuth, "Facebook", setFacebookConnecting);
  const connectGoogle = openOAuthPopup(initGoogleOAuth, "Google Ads", setGoogleConnecting);

  const loadEmailConfig = useCallback(async () => {
    const config = await getEmailConfig().catch(() => null);
    setEmailConfig(config);
    return config;
  }, []);

  const disconnect = useCallback(
    async (provider: IntegrationProvider) => {
      try {
        await disconnectIntegration(provider);
        toast.success(Messages.integrations.disconnected(PROVIDER_LABELS[provider]));
        // Email has its own cached config (used by the connect/status UI) separate from the
        // general statuses list — without this it stays stale until a manual page refresh.
        await Promise.all([provider === "EMAIL" ? loadEmailConfig() : Promise.resolve(), fetchStatuses()]);
      } catch (err) {
        toast.error(apiErrorMessage(err, "Couldn’t disconnect. Please try again."));
        throw err;
      }
    },
    [fetchStatuses, loadEmailConfig],
  );

  const regenerateSecret = useCallback(async () => {
    const info = await regenerateWebhookSecret();
    setWebhookInfo(info);
    return info;
  }, []);

  // Fetched lazily when the Google tab is opened — Google lead delivery needs only
  // this URL + key (no OAuth), and we avoid provisioning a key for orgs that never
  // visit the tab. The caller gates this on googleWebhookInfo being null.
  const loadGoogleWebhookInfo = useCallback(async () => {
    const info = await getGoogleWebhookInfo().catch(() => null);
    setGoogleWebhookInfo(info);
    return info;
  }, []);

  const regenerateGoogleKey = useCallback(async () => {
    const info = await regenerateGoogleWebhookKey();
    setGoogleWebhookInfo(info);
    return info;
  }, []);

  const connectWhatsAppAccount = useCallback(
    async (dto: { phoneNumberId: string; accessToken: string; appSecret: string; businessAccountId: string }) => {
      setWhatsappConnecting(true);
      try {
        const result = await connectWhatsApp(dto);
        toast.success(Messages.integrations.connectedWith("WhatsApp", result.accountName));
        setWhatsappWebhookInfo({ webhookUrl: result.webhookUrl, verifyToken: result.verifyToken });
        await fetchStatuses();
        return result;
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.integrations.connectFailed("WhatsApp")));
        throw err;
      } finally {
        setWhatsappConnecting(false);
      }
    },
    [fetchStatuses],
  );

  const loadWhatsAppWebhookInfo = useCallback(async () => {
    const info = await getWhatsAppWebhookInfo().catch(() => null);
    setWhatsappWebhookInfo(info);
    return info;
  }, []);

  const regenerateWhatsAppKey = useCallback(async () => {
    const info = await regenerateWhatsAppVerifyToken();
    setWhatsappWebhookInfo(info);
    return info;
  }, []);

  const [whatsappEmbeddedSignupConnecting, setWhatsappEmbeddedSignupConnecting] = useState(false);

  const connectWhatsAppEmbeddedSignup = useCallback(async () => {
    setWhatsappEmbeddedSignupConnecting(true);
    try {
      const { appId, configId } = await getWhatsAppEmbeddedSignupConfig();
      await loadFacebookSdk(appId);
      if (!window.FB) throw new Error("Facebook SDK failed to load.");

      let resolveCode!: (code: string | null) => void;
      let resolveSignupData!: (data: { phoneNumberId: string; wabaId: string } | null) => void;
      const codePromise = new Promise<string | null>((r) => {
        resolveCode = r;
      });
      const signupDataPromise = new Promise<{ phoneNumberId: string; wabaId: string } | null>((r) => {
        resolveSignupData = r;
      });

      const onMessage = (e: MessageEvent) => {
        if (e.origin !== "https://www.facebook.com") return;
        let parsed: {
          type?: string;
          event?: string;
          data?: { phone_number_id?: string; waba_id?: string };
        };
        try {
          parsed = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        } catch {
          return;
        }
        if (parsed?.type !== "WA_EMBEDDED_SIGNUP") return;
        window.removeEventListener("message", onMessage);
        if (parsed.event === "FINISH" && parsed.data?.phone_number_id && parsed.data?.waba_id) {
          resolveSignupData({ phoneNumberId: parsed.data.phone_number_id, wabaId: parsed.data.waba_id });
        } else {
          resolveSignupData(null);
        }
      };
      window.addEventListener("message", onMessage);

      window.FB.login(
        (response) => resolveCode(response.authResponse?.code ?? null),
        {
          config_id: configId,
          response_type: "code",
          override_default_response_type: true,
          // version/sessionInfoVersion match what Meta's own "Embedded Signup Dialog" test
          // console sends for this config (ES Version v4, Session Info Version 3).
          extras: { version: "v4", sessionInfoVersion: "3" },
        },
      );

      // Await the login code first — if the user cancels/denies, Meta never fires the
      // WA_EMBEDDED_SIGNUP postMessage at all, so racing both with Promise.all would hang
      // forever waiting on a message that's never coming.
      const code = await codePromise;
      if (!code) {
        window.removeEventListener("message", onMessage);
        toast.info(Messages.integrations.connectCancelled("WhatsApp"));
        return undefined;
      }

      const signupData = await signupDataPromise;
      window.removeEventListener("message", onMessage);
      if (!signupData) {
        toast.info(Messages.integrations.connectCancelled("WhatsApp"));
        return undefined;
      }

      const result = await completeWhatsAppEmbeddedSignup({
        code,
        phoneNumberId: signupData.phoneNumberId,
        wabaId: signupData.wabaId,
      });
      toast.success(Messages.integrations.connectedWith("WhatsApp", result.accountName));
      await fetchStatuses();
      return result;
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.integrations.connectFailed("WhatsApp")));
      throw err;
    } finally {
      setWhatsappEmbeddedSignupConnecting(false);
    }
  }, [fetchStatuses]);

  const connectEmailSmtpAccount = useCallback(
    async (dto: {
      host: string;
      port: number;
      secure: boolean;
      username: string;
      password: string;
      fromEmail: string;
      fromName: string;
    }) => {
      setEmailConnecting(true);
      try {
        const result = await connectEmailSmtp(dto);
        toast.success(Messages.integrations.connectedWith("Email", result.fromEmail));
        await Promise.all([loadEmailConfig(), fetchStatuses()]);
        return result;
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.integrations.connectFailed("Email")));
        throw err;
      } finally {
        setEmailConnecting(false);
      }
    },
    [fetchStatuses, loadEmailConfig],
  );

  const connectEmailSesDomainAccount = useCallback(
    async (dto: { domain: string; fromEmail: string; fromName: string }) => {
      setEmailConnecting(true);
      try {
        const result = await connectEmailSesDomain(dto);
        await Promise.all([loadEmailConfig(), fetchStatuses()]);
        return result;
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.integrations.connectFailed("Email")));
        throw err;
      } finally {
        setEmailConnecting(false);
      }
    },
    [fetchStatuses, loadEmailConfig],
  );

  const checkEmailStatus = useCallback(async () => {
    try {
      const config = await checkEmailDomainStatus();
      setEmailConfig(config);
      if (config.status === "CONNECTED") {
        toast.success(Messages.integrations.connectedWith("Email", config.domain ?? config.fromEmail ?? ""));
        void fetchStatuses();
      }
      return config;
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn’t check domain verification status."));
      return null;
    }
  }, [fetchStatuses]);

  const connectRazorpayAccount = useCallback(
    async (dto: { keyId: string; keySecret: string }) => {
      setRazorpayConnecting(true);
      try {
        const result = await connectRazorpay(dto);
        toast.success(Messages.integrations.connectedWith("Razorpay", result.keyId));
        await fetchStatuses();
        return result;
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.integrations.connectFailed("Razorpay")));
        throw err;
      } finally {
        setRazorpayConnecting(false);
      }
    },
    [fetchStatuses],
  );

  const connectTradeIndiaLink = useCallback(
    async (apiLink: string) => {
      try {
        await connectTradeIndia({ apiLink });
        toast.success("TradeIndia link saved.");
        await fetchStatuses();
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.integrations.connectFailed("TradeIndia")));
        throw err;
      }
    },
    [fetchStatuses],
  );

  const connectCashfreeAccount = useCallback(
    async (dto: { appId: string; secretKey: string }) => {
      setCashfreeConnecting(true);
      try {
        const result = await connectCashfree(dto);
        toast.success(Messages.integrations.connectedWith("Cashfree", result.appId));
        await fetchStatuses();
        return result;
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.integrations.connectFailed("Cashfree")));
        throw err;
      } finally {
        setCashfreeConnecting(false);
      }
    },
    [fetchStatuses],
  );

  // Fetched lazily when the Razorpay tab is opened — generates the org's webhook secret
  // on first access (see IntegrationsConfigService.ensureRazorpayWebhookSecret).
  const loadRazorpayWebhookInfo = useCallback(async () => {
    const info = await getRazorpayWebhookInfo().catch(() => null);
    setRazorpayWebhookInfo(info);
    return info;
  }, []);

  const regenerateRazorpayKey = useCallback(async () => {
    const info = await regenerateRazorpayWebhookSecret();
    setRazorpayWebhookInfo(info);
    return info;
  }, []);

  const getStatus = useCallback(
    (provider: IntegrationProvider) =>
      statuses.find((s) => s.provider === provider),
    [statuses],
  );

  // Ad account picker only appears when Facebook is connected but auto-connect
  // (exactly one ad account) didn't apply — 0 or 2+ accounts on the Business.
  const [adAccounts, setAdAccounts] = useState<FacebookAdAccount[] | null>(null);
  const [adAccountsLoading, setAdAccountsLoading] = useState(false);

  const loadAdAccounts = useCallback(async () => {
    setAdAccountsLoading(true);
    try {
      const accounts = await listFacebookAdAccounts();
      setAdAccounts(accounts);
      return accounts;
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.integrations.adAccountsLoadFailed));
      return [];
    } finally {
      setAdAccountsLoading(false);
    }
  }, []);

  const pickAdAccount = useCallback(
    async (adAccountId: string) => {
      try {
        const { adAccountName } = await connectFacebookAdAccount(adAccountId);
        toast.success(Messages.integrations.adAccountConnected(adAccountName));
        setAdAccounts(null);
        await fetchStatuses();
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.integrations.adAccountsLoadFailed));
      }
    },
    [fetchStatuses],
  );

  const [syncing, setSyncing] = useState(false);
  const refreshInsights = useCallback(async () => {
    setSyncing(true);
    try {
      await syncFacebookInsights();
      toast.success(Messages.integrations.insightsSyncQueued);
      // The sync runs in the background; give it a moment then refetch lastSyncedAt.
      setTimeout(() => void fetchStatuses(), 5000);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.integrations.insightsSyncFailed));
    } finally {
      setSyncing(false);
    }
  }, [fetchStatuses]);

  const [backfilling, setBackfilling] = useState(false);
  const backfillFacebook = useCallback(
    async (since: string) => {
      setBackfilling(true);
      try {
        await manualBackfillFacebook(since);
        toast.success(Messages.integrations.backfillQueued);
        setTimeout(() => void fetchStatuses(), 5000);
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.integrations.backfillFailed));
      } finally {
        setBackfilling(false);
      }
    },
    [fetchStatuses],
  );

  return {
    statuses,
    webhookInfo,
    googleWebhookInfo,
    whatsappWebhookInfo,
    whatsappConnecting,
    loading,
    error,
    connectFacebook,
    connectGoogle,
    facebookConnecting,
    googleConnecting,
    disconnect,
    regenerateSecret,
    loadGoogleWebhookInfo,
    regenerateGoogleKey,
    connectWhatsAppAccount,
    loadWhatsAppWebhookInfo,
    regenerateWhatsAppKey,
    connectWhatsAppEmbeddedSignup,
    whatsappEmbeddedSignupConnecting,
    emailConfig,
    emailConnecting,
    loadEmailConfig,
    connectEmailSmtpAccount,
    connectEmailSesDomainAccount,
    checkEmailStatus,
    razorpayConnecting,
    connectRazorpayAccount,
    cashfreeConnecting,
    connectCashfreeAccount,
    connectTradeIndiaLink,
    razorpayWebhookInfo,
    loadRazorpayWebhookInfo,
    regenerateRazorpayKey,
    getStatus,
    refetch: fetchStatuses,
    adAccounts,
    adAccountsLoading,
    loadAdAccounts,
    pickAdAccount,
    syncing,
    refreshInsights,
    backfilling,
    backfillFacebook,
  };
}
