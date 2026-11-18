// Loads Meta's Facebook JS SDK once, idempotently. Needed for WhatsApp Embedded Signup
// (FB.login with a config_id) — unlike Lead Ads OAuth, which builds a plain dialog/oauth
// URL server-side and never touches this SDK.

declare global {
  interface Window {
    FB?: {
      init: (params: { appId: string; version: string; xfbml?: boolean }) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } | null; status?: string }) => void,
        options: {
          config_id: string;
          response_type: string;
          override_default_response_type: boolean;
          extras?: Record<string, unknown>;
        },
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

const SDK_VERSION = "v25.0";

let loadPromise: Promise<void> | null = null;

export function loadFacebookSdk(appId: string): Promise<void> {
  if (window.FB) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, version: SDK_VERSION, xfbml: false });
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Failed to load the Facebook SDK."));
    };
    document.body.appendChild(script);
  });

  return loadPromise;
}
