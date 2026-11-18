import { useState, useEffect, useCallback } from "react";
import type { CallLogEntry, PaginatedResponse } from "../types";
import * as client from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

interface UseCallLogReturn {
  calls: CallLogEntry[];
  total: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useCallLog(): UseCallLogReturn {
  const [data, setData] = useState<PaginatedResponse<CallLogEntry>>({
    data: [],
    total: 0,
    page: 1,
    limit: 20,
    pages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.getCallLog();
      setData(result);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.calls));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCalls();
  }, [fetchCalls]);

  return { calls: data.data, total: data.total, loading, error, refetch: fetchCalls };
}
