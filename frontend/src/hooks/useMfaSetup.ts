import { useState, useCallback } from "react";
import type { User } from "../types";
import * as api from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

export function useMfaSetup() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const init = useCallback(async (): Promise<{ setupToken: string; qrCodeDataUrl: string; secret: string } | null> => {
    setLoading(true);
    setError(null);
    try {
      return await api.initMfaSetup();
    } catch (err) {
      setError(apiErrorMessage(err, Messages.mfa.setupFailed));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const getSetupInfo = useCallback(
    async (setupToken: string): Promise<{ qrCodeDataUrl: string; secret: string } | null> => {
      setLoading(true);
      setError(null);
      try {
        return await api.getMfaSetupInfo(setupToken);
      } catch (err) {
        setError(apiErrorMessage(err, Messages.mfa.setupFailed));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const verify = useCallback(
    async (setupToken: string, code: string): Promise<{ token: string; user: User; recoveryCodes: string[] } | null> => {
      setLoading(true);
      setError(null);
      try {
        return await api.verifyMfaSetup(setupToken, code);
      } catch (err) {
        setError(apiErrorMessage(err, Messages.mfa.verifyFailed));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { init, getSetupInfo, verify, loading, error };
}
