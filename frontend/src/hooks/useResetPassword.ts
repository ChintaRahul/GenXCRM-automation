import { useState, useCallback } from "react";
import * as api from "../api/client";
import { apiErrorMessage } from "../lib/apiError";

export function useResetPassword() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = useCallback(
    async (token: string, password: string): Promise<boolean> => {
      setLoading(true);
      setError(null);
      try {
        await api.resetPassword(token, password);
        setSuccess(true);
        return true;
      } catch (err) {
        setError(
          apiErrorMessage(err, "Invalid or expired link. Please request a new one."),
        );
        return false;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { submit, loading, error, success };
}
