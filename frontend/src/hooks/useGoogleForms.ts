import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { connectGoogleForm, deleteGoogleForm, getGoogleForms, syncGoogleForm, updateGoogleForm } from "../api/client";
import type { ConnectGoogleFormInput, GoogleFormDto, SyncResultDto } from "../types";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

export function useGoogleForms() {
  const [forms, setForms] = useState<GoogleFormDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      setForms(await getGoogleForms());
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.googleForms.loadFailed));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const addForm = useCallback(
    async (input: ConnectGoogleFormInput) => {
      try {
        await connectGoogleForm(input);
        toast.success(Messages.googleForms.added);
        await refetch();
        return true;
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.googleForms.addFailed));
        return false;
      }
    },
    [refetch],
  );

  const setActive = useCallback(
    async (id: string, isActive: boolean) => {
      try {
        await updateGoogleForm(id, { isActive });
        await refetch();
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.googleForms.toggleFailed));
      }
    },
    [refetch],
  );

  const removeForm = useCallback(
    async (id: string) => {
      try {
        await deleteGoogleForm(id);
        toast.success(Messages.googleForms.deleted);
        await refetch();
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.googleForms.deleteFailed));
      }
    },
    [refetch],
  );

  const syncNow = useCallback(
    async (id: string): Promise<SyncResultDto | null> => {
      try {
        const result = await syncGoogleForm(id);
        if (result.error) toast.error(result.error);
        else if (!result.skipped) toast.success(Messages.googleForms.syncedNow(result.synced));
        await refetch();
        return result;
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.googleForms.syncNowFailed));
        return null;
      }
    },
    [refetch],
  );

  return { forms, loading, error, addForm, setActive, removeForm, syncNow, refetch };
}
