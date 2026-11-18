import { useState, useEffect, useCallback } from 'react';
import type { Payment, PaginatedResponse, RevenueMonth, UpcomingInstallment } from '../types';
import * as client from '../api/client';
import { apiErrorMessage } from '../lib/apiError';
import { Messages } from '../lib/messages';

interface UsePaymentsReturn {
  payments: Payment[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePaymentsByLead(leadId: string): UsePaymentsReturn {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.getPaymentsByLead(leadId);
      setPayments(result);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.payments));
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { void fetchPayments(); }, [fetchPayments]);

  return { payments, loading, error, refetch: fetchPayments };
}

interface UseAsyncReturn<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function useAsync<T>(fetcher: () => Promise<T>, deps: unknown[]): UseAsyncReturn<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    fetcher()
      .then(setData)
      .catch((err: unknown) => setError(apiErrorMessage(err, Messages.load.payments)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export function usePaymentDashboard() {
  return useAsync(client.getPaymentDashboard, []);
}

export function useRevenueMonthly(months = 6): UseAsyncReturn<RevenueMonth[]> {
  return useAsync(() => client.getRevenueMonthly(months), [months]);
}

export function useUpcomingInstallments(days = 14): UseAsyncReturn<UpcomingInstallment[]> {
  return useAsync(() => client.getUpcomingInstallments(days), [days]);
}

export function usePaymentsList(
  query: Record<string, unknown> = {},
): UseAsyncReturn<PaginatedResponse<Payment>> {
  const key = JSON.stringify(query);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useAsync(() => client.getPayments(query), [key]);
}

export function usePayment(id: string): UseAsyncReturn<Payment> {
  return useAsync(() => client.getPayment(id), [id]);
}
