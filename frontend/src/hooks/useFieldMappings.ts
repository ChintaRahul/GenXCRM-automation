import { useState, useEffect, useCallback } from "react";
import { getFieldMappings, updateFieldMappings, backfillLeads } from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import type { FieldMappingConfig, LeadBackfillRequest } from "../types";

export function useFieldMappings() {
  const [mapping, setMapping] = useState<FieldMappingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMapping = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getFieldMappings();
      setMapping(data);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.fieldMappings));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMapping();
  }, [fetchMapping]);

  const save = useCallback(async (payload: Partial<FieldMappingConfig>) => {
    const updated = await updateFieldMappings(payload);
    setMapping(updated);
  }, []);

  const backfill = useCallback((payload: LeadBackfillRequest) => backfillLeads(payload), []);

  return { mapping, loading, error, save, backfill, refetch: fetchMapping };
}
