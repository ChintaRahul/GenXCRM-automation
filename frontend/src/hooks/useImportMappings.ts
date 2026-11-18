import { useState, useEffect, useCallback } from "react";
import {
  getImportMappings,
  createImportMapping,
  updateImportMapping,
  deleteImportMapping,
} from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import type { ImportMapping } from "../types";

export function useImportMappings() {
  const [mappings, setMappings] = useState<ImportMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMappings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getImportMappings();
      setMappings(data);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.mappingTemplates));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMappings();
  }, [fetchMappings]);

  const createMapping = useCallback(
    async (payload: { name: string; mappings: Record<string, string> }) => {
      const created = await createImportMapping(payload);
      await fetchMappings();
      return created;
    },
    [fetchMappings],
  );

  const updateMapping = useCallback(
    async (
      id: string,
      payload: { name?: string; mappings?: Record<string, string> },
    ) => {
      const updated = await updateImportMapping(id, payload);
      await fetchMappings();
      return updated;
    },
    [fetchMappings],
  );

  const deleteMapping = useCallback(
    async (id: string) => {
      await deleteImportMapping(id);
      await fetchMappings();
    },
    [fetchMappings],
  );

  return {
    mappings,
    loading,
    error,
    createMapping,
    updateMapping,
    deleteMapping,
    refetch: fetchMappings,
  };
}
