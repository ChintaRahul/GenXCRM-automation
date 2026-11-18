import { useState, useEffect, useCallback } from "react";
import { getAuditLog } from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import type { AuditLogPage } from "../types";

const PAGE_SIZE = 20;

export function useAuditLog() {
  const [page, setPageData] = useState<AuditLogPage | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (pageNumber: number) => {
    try {
      setLoading(true);
      setError(null);
      const data = await getAuditLog(pageNumber, PAGE_SIZE);
      setPageData(data);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.auditLog));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPage(currentPage);
  }, [currentPage, fetchPage]);

  return { page, loading, error, currentPage, setPage: setCurrentPage };
}
