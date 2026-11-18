import { useState, useCallback } from "react";
import * as api from "../api/client";
import { apiErrorMessage } from "../lib/apiError";

export type VerifyStatus = "idle" | "verifying" | "success" | "error";

export function useVerifyEmail() {
  const [status, setStatus] = useState<VerifyStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async (token: string): Promise<void> => {
    setStatus("verifying");
    setError(null);
    try {
      await api.verifyEmail(token);
      setStatus("success");
    } catch (err) {
      setError(apiErrorMessage(err, "Invalid or expired token"));
      setStatus("error");
    }
  }, []);

  return { verify, status, error };
}
