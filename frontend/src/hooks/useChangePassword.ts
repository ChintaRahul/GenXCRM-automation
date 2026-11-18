import { useState, useCallback } from "react";
import type { User } from "../types";
import * as api from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

export function useChangePassword() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (password: string): Promise<{ token: string; user: User } | null> => {
      setLoading(true);
      setError(null);
      try {
        return await api.changePassword(password);
      } catch (err) {
        setError(apiErrorMessage(err, Messages.account.passwordUpdateFailed));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { submit, loading, error };
}
