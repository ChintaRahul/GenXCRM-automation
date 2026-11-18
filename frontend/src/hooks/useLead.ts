import { useState, useEffect, useCallback } from "react";
import { getLead } from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import type { Lead } from "../types";

interface UseLeadReturn {
  lead: Lead | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useLead(id: string | undefined): UseLeadReturn {
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLead = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getLead(id);
      setLead(result);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.lead));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchLead();
  }, [fetchLead]);

  return { lead, loading, error, refetch: fetchLead };
}
