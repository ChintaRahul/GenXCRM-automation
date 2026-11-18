import { useState, useCallback } from "react";
import type { User } from "../types";
import * as api from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

export function useMfaChallenge() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(
    async (challengeToken: string, code: string): Promise<{ token: string; user: User } | null> => {
      setLoading(true);
      setError(null);
      try {
        return await api.verifyMfaChallenge(challengeToken, code);
      } catch (err) {
        setError(apiErrorMessage(err, Messages.mfa.challengeFailed));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { verify, loading, error };
}
