import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import * as client from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import { useNotifications } from "../context/NotificationsContext";

interface UseReportReturn<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function useReport<T>(fetcher: () => Promise<T>): UseReportReturn<T> {
  const { newLeadVersion } = useNotifications();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.report));
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void fetch();
    // Re-fetch whenever a new lead is detected, so stats stay live while mounted.
  }, [fetch, newLeadVersion]);

  return { data, loading, error, refetch: fetch };
}

export type PipelinePeriod = "30d" | "90d" | "YTD";

function periodToRange(period: PipelinePeriod): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  if (period === "30d") {
    from.setDate(to.getDate() - 30);
  } else if (period === "90d") {
    from.setDate(to.getDate() - 90);
  } else {
    from.setFullYear(to.getFullYear(), 0, 1);
  }
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function usePipeline(
  period: PipelinePeriod = "30d",
): UseReportReturn<unknown> {
  const { newLeadVersion } = useNotifications();
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.getPipeline(periodToRange(period));
      setData(result);
    } catch (err) {
      setError(
        apiErrorMessage(err, Messages.load.pipeline),
      );
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void fetchData();
    // Re-fetch whenever a new lead is detected, so the funnel stays live while mounted.
  }, [fetchData, newLeadVersion]);

  return { data, loading, error, refetch: fetchData };
}

export const useOverview = () => useReport(client.getOverview);
export const useSourceStats = () => useReport(client.getSourceStats);

// ─── Team Performance tab ────────────────────────────────────────────────────
// Filter-driven (from/to/teamId), same live-refetch-on-newLeadVersion behavior as
// useDailyReport, but keyed on TeamPerformanceFilter instead of DailyReportFilter.

function useTeamPerformanceReport<T>(
  fetcher: (filter: client.TeamPerformanceFilter) => Promise<T>,
  filter: client.TeamPerformanceFilter,
): UseReportReturn<T> {
  const { newLeadVersion } = useNotifications();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher(filter);
      setData(result);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.report));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher, filter.from, filter.to, filter.teamId]);

  useEffect(() => {
    void fetchData();
    // Re-fetch whenever a new lead is detected, so stats stay live while mounted.
  }, [fetchData, newLeadVersion]);

  return { data, loading, error, refetch: fetchData };
}

export const useProductivity = (filter: client.TeamPerformanceFilter = {}) =>
  useTeamPerformanceReport(client.getProductivity, filter);
export const useSourcePerformance = (filter: client.TeamPerformanceFilter = {}) =>
  useTeamPerformanceReport(client.getSourcePerformance, filter);
export const useTeamLeaderboard = (filter: client.TeamPerformanceFilter = {}) =>
  useTeamPerformanceReport(client.getTeamLeaderboard, filter);

// ─── Daily Sales & Lead Management Report ───────────────────────────────────

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// Reports open on month-to-date (1st of this month → today).
function monthStartUtc(): string {
  return `${todayUtc().slice(0, 7)}-01`;
}

// Filter bar state (date range / team member / campaign), synced to URL query
// params so a report view is shareable/bookmarkable and survives a refresh.
export function useDailyReportFilters() {
  const [params, setParams] = useSearchParams();

  const filters: client.DailyReportFilter = {
    from: params.get("from") ?? monthStartUtc(),
    to: params.get("to") ?? todayUtc(),
    teamMemberId: params.get("teamMemberId") ?? undefined,
    campaignId: params.get("campaignId") ?? undefined,
  };

  const setFilters = useCallback(
    (next: Partial<client.DailyReportFilter>) => {
      setParams((prev) => {
        const merged = new URLSearchParams(prev);
        const combined = { ...filters, ...next };
        for (const [key, value] of Object.entries(combined)) {
          if (value) merged.set(key, String(value));
          else merged.delete(key);
        }
        return merged;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams],
  );

  return { filters, setFilters };
}

function useDailyReport<T>(
  fetcher: (filter: client.DailyReportFilter) => Promise<T>,
  filter: client.DailyReportFilter,
): UseReportReturn<T> {
  const { newLeadVersion } = useNotifications();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher(filter);
      setData(result);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.report));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher, filter.from, filter.to, filter.teamMemberId, filter.campaignId, filter.page, filter.limit]);

  useEffect(() => {
    void fetchData();
    // Re-fetch whenever a new lead is detected, so the report stays live while mounted.
  }, [fetchData, newLeadVersion]);

  return { data, loading, error, refetch: fetchData };
}

export const useDailySummary = (filter: client.DailyReportFilter) =>
  useDailyReport(client.getDailySummary, filter);
export const useStatusReport = (filter: client.DailyReportFilter) =>
  useDailyReport(client.getStatusReport, filter);
export const useEnrollmentReport = (filter: client.DailyReportFilter) =>
  useDailyReport(client.getEnrollmentReport, filter);
export const useCampaignPerformance = (filter: client.DailyReportFilter) =>
  useDailyReport(client.getCampaignPerformance, filter);
export const useAdSetPerformance = (filter: client.DailyReportFilter) =>
  useDailyReport(client.getAdSetPerformance, filter);
export const useAdPerformance = (filter: client.DailyReportFilter) =>
  useDailyReport(client.getAdPerformance, filter);
export const useLeadSourceTracking = (filter: client.DailyReportFilter) =>
  useDailyReport(client.getLeadSourceTracking, filter);
export const useDailyDashboard = (filter: client.DailyReportFilter) =>
  useDailyReport(client.getDailyDashboard, filter);
export const useCampaignOptions = () => useReport(client.getCampaignOptions);
