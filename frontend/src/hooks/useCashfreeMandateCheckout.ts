import { useCallback, useState } from "react";

const CASHFREE_SDK_URL = "https://sdk.cashfree.com/js/v3/cashfree.js";

interface CashfreeInstance {
  subscriptionsCheckout: (opts: {
    subsSessionId: string;
    redirectTarget: string;
  }) => Promise<{ error?: { message?: string } } | undefined>;
}
type CashfreeFactory = (opts: { mode: "sandbox" | "production" }) => CashfreeInstance;

const loadSdk = (): Promise<CashfreeFactory> =>
  new Promise((resolve, reject) => {
    const existing = (window as unknown as { Cashfree?: CashfreeFactory }).Cashfree;
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.src = CASHFREE_SDK_URL;
    script.async = true;
    script.onload = () => {
      const factory = (window as unknown as { Cashfree?: CashfreeFactory }).Cashfree;
      if (factory) resolve(factory);
      else reject(new Error("Cashfree checkout failed to load."));
    };
    script.onerror = () => reject(new Error("Could not reach Cashfree. Check your connection and try again."));
    document.head.appendChild(script);
  });

// Opens Cashfree's hosted subscription checkout for a session id from the mandate link.
export function useCashfreeMandateCheckout(sessionId: string | null, mode: "sandbox" | "production") {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (!sessionId) return;
    setStarting(true);
    setError(null);
    try {
      const Cashfree = await loadSdk();
      const result = await Cashfree({ mode }).subscriptionsCheckout({
        subsSessionId: sessionId,
        redirectTarget: "_self",
      });
      if (result?.error) setError(result.error.message ?? "Authorization could not be started.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authorization could not be started.");
    } finally {
      setStarting(false);
    }
  }, [sessionId, mode]);

  return { start, starting, error };
}
