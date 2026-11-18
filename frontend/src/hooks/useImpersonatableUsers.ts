import { useState, useEffect, useCallback } from "react";
import type { ImpersonatableUser } from "../types";
import * as client from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

interface UseImpersonatableUsersReturn {
  users: ImpersonatableUser[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useImpersonatableUsers(): UseImpersonatableUsersReturn {
  const [users, setUsers] = useState<ImpersonatableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.listImpersonatableUsers();
      setUsers(result);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.impersonatableUsers));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  return { users, loading, error, refetch: fetchUsers };
}
