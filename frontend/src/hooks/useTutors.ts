import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { Tutor } from "../types";
import * as client from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

interface UseTutorsReturn {
  tutors: Tutor[];
  loading: boolean;
  error: string | null;
  includeArchived: boolean;
  setIncludeArchived: (value: boolean) => void;
  refetch: () => void;
  addTutor: (name: string) => Promise<Tutor | undefined>;
  updateTutor: (id: string, patch: { isActive?: boolean }) => Promise<void>;
}

export function useTutors(): UseTutorsReturn {
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);

  const fetchTutors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.getTutors(includeArchived);
      setTutors(result);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.tutors));
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    void fetchTutors();
  }, [fetchTutors]);

  const addTutor = useCallback(
    async (name: string) => {
      try {
        const created = await client.createTutor({ name });
        await fetchTutors();
        return created;
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.tutors.createFailed));
        return undefined;
      }
    },
    [fetchTutors],
  );

  const updateTutor = useCallback(
    async (id: string, patch: { isActive?: boolean }) => {
      try {
        await client.updateTutor(id, patch);
        await fetchTutors();
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.tutors.updateFailed));
      }
    },
    [fetchTutors],
  );

  return {
    tutors,
    loading,
    error,
    includeArchived,
    setIncludeArchived,
    refetch: fetchTutors,
    addTutor,
    updateTutor,
  };
}
