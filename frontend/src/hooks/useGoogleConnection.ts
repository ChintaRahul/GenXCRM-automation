import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  completeGoogleConnection,
  disconnectGoogleForms,
  getGoogleConnection,
  initGoogleFormsConnection,
} from "../api/client";
import type { GoogleConnectionDto, GoogleFormsOAuthMessage } from "../types";
import { isNative, openExternal, webAppUrl } from "../lib/platform";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

export function useGoogleConnection() {
  const [connection, setConnection] = useState<GoogleConnectionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const refetch = useCallback(async () => {
    try {
      setConnection(await getGoogleConnection());
    } catch {
      setConnection(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Synchronous guards: `connecting` state is stale inside a fast double click, and callbacks
  // must not touch state after unmount.
  const connectingRef = useRef(false);
  const mountedRef = useRef(true);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupRef.current?.();
    };
  }, []);

  const connect = useCallback(async () => {
    // Popup + postMessage doesn't work inside the native WebView; send the user to the web app.
    if (isNative()) {
      toast.info(Messages.integrations.connectFromWeb("Google"));
      await openExternal(`${webAppUrl()}/integrations`);
      return;
    }
    if (connectingRef.current) return;
    // Open the window synchronously inside the click so browsers don't treat it as a blocked popup.
    const popup = window.open("", "oauth-popup", "width=620,height=760,left=400,top=80");
    if (!popup) {
      toast.error(Messages.googleForms.popupBlocked);
      return;
    }
    connectingRef.current = true;
    setConnecting(true);
    try {
      let url: string;
      try {
        ({ url } = await initGoogleFormsConnection());
      } catch (err) {
        popup.close();
        toast.error(apiErrorMessage(err, Messages.googleForms.connectStartFailed));
        return;
      }
      if (!mountedRef.current) {
        popup.close();
        return;
      }
      try {
        popup.location.href = url;
      } catch {
        popup.close();
        toast.error(Messages.googleForms.connectStartFailed);
        return;
      }
      // Resolves when the callback page reports back, the user closes the popup, or we unmount.
      await new Promise<void>((resolve) => {
        const finish = () => {
          window.removeEventListener("message", onMessage);
          window.clearInterval(poll);
          cleanupRef.current = null;
          resolve();
        };
        const onMessage = (e: MessageEvent) => {
          if (e.source !== popup || e.origin !== window.location.origin) return;
          const data = e.data as Partial<GoogleFormsOAuthMessage> | null;
          if (!data || data.type !== "genxcrm-google-forms") return;
          if (data.status === "success") toast.success(Messages.googleForms.connected);
          else toast.error(data.message || Messages.googleForms.connectFailed);
          try {
            popup.close();
          } catch {
            /* ignore */
          }
          finish();
        };
        window.addEventListener("message", onMessage);
        const poll = window.setInterval(() => {
          if (popup.closed) finish();
        }, 600);
        cleanupRef.current = finish;
      });
      if (mountedRef.current) await refetch();
    } finally {
      connectingRef.current = false;
      if (mountedRef.current) setConnecting(false);
    }
  }, [refetch]);

  // Used by the OAuth callback page: binds Google's code/state to the logged-in user.
  const complete = useCallback(async (code: string, state: string): Promise<boolean> => {
    try {
      await completeGoogleConnection(code, state);
      return true;
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.googleForms.connectFailed));
      return false;
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await disconnectGoogleForms();
      toast.success(Messages.googleForms.disconnected);
      await refetch();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.googleForms.disconnectFailed));
    }
  }, [refetch]);

  return { connection, loading, connecting, connect, complete, disconnect, refetch };
}
