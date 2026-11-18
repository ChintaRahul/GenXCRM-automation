import { useState, useEffect, useCallback, useMemo } from "react";
import {
  getLeadStages,
  createLeadStage,
  updateLeadStage,
  reorderLeadStages,
  deleteLeadStage,
} from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import type { StageView } from "../types";

type CreateInput = Parameters<typeof createLeadStage>[0];
type UpdatePatch = Parameters<typeof updateLeadStage>[1];

export function useLeadStages(includeHidden = false) {
  const [stages, setStages] = useState<StageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setStages(await getLeadStages(includeHidden));
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.leadStages));
    } finally {
      setLoading(false);
    }
  }, [includeHidden]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const byKey = useMemo(
    () => Object.fromEntries(stages.map((s) => [s.key, s])) as Record<string, StageView>,
    [stages],
  );

  const create = useCallback(
    async (input: CreateInput) => {
      await createLeadStage(input);
      await refetch();
    },
    [refetch],
  );

  const update = useCallback(
    async (key: string, patch: UpdatePatch) => {
      await updateLeadStage(key, patch);
      await refetch();
    },
    [refetch],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteLeadStage(id);
      await refetch();
    },
    [refetch],
  );

  // Optimistic: apply the new order locally, roll back if the API rejects.
  const reorder = useCallback(
    async (keys: string[]) => {
      const previous = stages;
      const lookup = new Map(stages.map((s) => [s.key, s]));
      setStages(
        keys
          .map((key, sortOrder) => {
            const stage = lookup.get(key);
            return stage ? { ...stage, sortOrder } : undefined;
          })
          .filter((s): s is StageView => s !== undefined),
      );
      try {
        await reorderLeadStages(keys);
      } catch (err) {
        setStages(previous);
        throw err;
      }
    },
    [stages],
  );

  return { stages, byKey, loading, error, refetch, create, update, reorder, remove };
}
