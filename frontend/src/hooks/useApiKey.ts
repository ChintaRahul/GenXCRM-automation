import { useState, useEffect, useCallback } from "react";
import { getApiKey, regenerateApiKey } from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

// `enabled` is false for roles that cannot read the key (the API would 403), so nothing is fetched.
export function useApiKey(enabled = true) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const fetchKey = useCallback(async () => {
    if (!enabled) return;
    try {
      setLoading(true);
      setError(null);
      const { apiKey: key } = await getApiKey();
      setApiKey(key);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.apiKey));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void fetchKey();
  }, [fetchKey]);

  const regenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      const { apiKey: key } = await regenerateApiKey();
      setApiKey(key);
    } finally {
      setRegenerating(false);
    }
  }, []);

  return { apiKey, loading, error, regenerating, regenerate };
}
