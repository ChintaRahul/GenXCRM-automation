import { useState, useEffect, useCallback } from 'react';
import type { Team } from '../types';
import * as client from '../api/client';
import { apiErrorMessage } from '../lib/apiError';
import { Messages } from '../lib/messages';

interface UseTeamsReturn {
  teams: Team[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useTeams(): UseTeamsReturn {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchTeams = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.getTeams();
      setTeams(result);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.teams));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchTeams(); }, [fetchTeams]);

  return { teams, loading, error, refetch: fetchTeams };
}
