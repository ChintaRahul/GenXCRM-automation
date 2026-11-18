import { useState, useEffect, useCallback } from 'react';
import type { Invoice, PaginatedResponse } from '../types';
import * as client from '../api/client';
import { apiErrorMessage } from '../lib/apiError';
import { Messages } from '../lib/messages';

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
      .catch((err: unknown) => setError(apiErrorMessage(err, Messages.load.invoices)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export function useInvoicesList(
  query: Record<string, unknown> = {},
): UseAsyncReturn<PaginatedResponse<Invoice>> {
  const key = JSON.stringify(query);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useAsync(() => client.getInvoices(query), [key]);
}

// id is undefined in create mode (InvoiceForm's "New Invoice") — skip the fetch
// entirely rather than firing a wasted/invalid GET /invoices/ request.
export function useInvoice(id: string | undefined): UseAsyncReturn<Invoice> {
  return useAsync(() => (id ? client.getInvoice(id) : Promise.resolve(null as unknown as Invoice)), [id]);
}

// "Registered" = registeredAt is set (an actual recorded registration payment), not
// merely a DRAFT invoice generated via generate-from-registration with no payment logged.
export function useRegistrationsList(
  query: Record<string, unknown> = {},
): UseAsyncReturn<PaginatedResponse<Invoice>> {
  return useInvoicesList({ ...query, registered: true });
}

export function useNextInvoiceNumber(): UseAsyncReturn<{ invoiceNumber: string }> {
  return useAsync(() => client.getNextInvoiceNumber(), []);
}
