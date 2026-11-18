import { loadErrorMessage } from "../lib/loadError";
import { useCallback, useEffect, useState } from "react";
import { performModuleAction } from "../api/modules";
import { getMfgMyDay, getMfgTeam, type MfgMyDay, type MfgTeamDashboard } from "../api/mfgDashboard";

function useMfgDashboardData<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // `quiet` refreshes in place (after an edit) without swapping the page for a skeleton.
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      setData(await fetcher());
    } catch (err) {
      setError(loadErrorMessage(err, "Couldn't load the dashboard."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refetch = useCallback(() => load(true), [load]);
  return { data, loading, error, refetch };
}

export function useMfgMyDay() {
  const { refetch, ...rest } = useMfgDashboardData<MfgMyDay>(getMfgMyDay);
  // "Mark done" on the action queue completes the activity (an outcome is required), then reloads.
  const completeTask = useCallback(
    async (activityId: string, outcome: string) => {
      await performModuleAction("activities", activityId, "Complete", { outcome });
      await refetch();
    },
    [refetch],
  );
  return { ...rest, refetch, completeTask };
}

export function useMfgTeam() {
  return useMfgDashboardData<MfgTeamDashboard>(getMfgTeam);
}
