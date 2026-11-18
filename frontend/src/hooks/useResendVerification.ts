import { useState, useCallback } from "react";
import * as api from "../api/client";
import { apiErrorMessage } from "../lib/apiError";

export function useResendVerification() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const resend = useCallback(async (email: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await api.resendVerification(email);
      setSuccess(true);
    } catch (err) {
      setError(apiErrorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setLoading(false);
    }
  }, []);

  return { resend, loading, error, success };
}
