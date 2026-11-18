import { useState, useEffect, useCallback } from "react";
import * as client from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

export interface AssignableUser {
  id: string;
  name: string;
  role: string;
  openLeads: number;
  online: boolean;
}

interface UseAssignableUsersReturn {
  users: AssignableUser[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAssignableUsers(): UseAssignableUsersReturn {
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.getUsers(true);
      setUsers(
        result.map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role,
          openLeads: u.openLeads ?? 0,
          online: false,
        })),
      );
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.users));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  return { users, loading, error, refetch: fetchUsers };
}
