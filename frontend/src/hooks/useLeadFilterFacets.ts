import { useState, useEffect, useCallback } from "react";
import { getLeadFacets } from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import type { LeadFacets } from "../types";

interface UseLeadFilterFacetsReturn {
  facets: LeadFacets | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useLeadFilterFacets(): UseLeadFilterFacetsReturn {
  const [facets, setFacets] = useState<LeadFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFacets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getLeadFacets();
      setFacets(result);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.report));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFacets();
  }, [fetchFacets]);

  return { facets, loading, error, refetch: fetchFacets };
}
