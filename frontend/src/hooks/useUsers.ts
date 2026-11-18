import { useState, useEffect, useCallback } from 'react';
import type { User } from '../types';
import * as client from '../api/client';
import { apiErrorMessage } from '../lib/apiError';
import { Messages } from '../lib/messages';

interface UseUsersReturn {
  users: User[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useUsers(): UseUsersReturn {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.getUsers();
      setUsers(result);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.users));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  return { users, loading, error, refetch: fetchUsers };
}
