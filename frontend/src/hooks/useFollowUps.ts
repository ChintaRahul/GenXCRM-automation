import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { getFollowUps, updateLead, type FollowUpLead } from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import { tomorrowMorningISO } from "../lib/followUps";

export function useFollowUps() {
  const [items, setItems] = useState<FollowUpLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      setItems(await getFollowUps());
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.followUps));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const change = useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      try {
        await updateLead(id, payload);
        await refetch();
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.leadDetail.followUpFailed));
      }
    },
    [refetch],
  );

  // Done clears the follow-up; snooze moves it to tomorrow 9:00.
  const markDone = useCallback((id: string) => change(id, { followUpAt: null }), [change]);
  const snooze = useCallback((id: string) => change(id, { followUpAt: tomorrowMorningISO() }), [change]);

  return { items, loading, error, refetch, markDone, snooze };
}
