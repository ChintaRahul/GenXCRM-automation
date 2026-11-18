import { useState, useCallback } from "react";
import * as client from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import { useAuth } from "../context/AuthContext";

export function useImpersonation() {
  const { impersonate: swapSession, exitImpersonation: restoreSession } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const impersonate = useCallback(
    async (userId: string): Promise<string | null> => {
      setLoading(true);
      setError(null);
      try {
        const { token, user } = await client.impersonate(userId);
        swapSession(token, user);
        // Full reload (not client-side nav): every context/hook needs to
        // re-fetch under the impersonated identity, not just AuthContext.
        window.location.href = "/";
        return null;
      } catch (err) {
        const message = apiErrorMessage(err, Messages.impersonation.startFailed);
        setError(message);
        return message;
      } finally {
        setLoading(false);
      }
    },
    [swapSession],
  );

  const exitImpersonation = useCallback(async (): Promise<void> => {
    try {
      await client.exitImpersonation();
    } catch {
      // Best-effort audit log — never block the user from exiting.
    } finally {
      restoreSession();
      window.location.href = "/";
    }
  }, [restoreSession]);

  return { impersonate, exitImpersonation, loading, error };
}
