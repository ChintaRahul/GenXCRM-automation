import { useState, useEffect, useCallback } from 'react';
import type { Lead, PaginatedResponse } from '../types';
import * as client from '../api/client';
import { apiErrorMessage } from '../lib/apiError';
import { Messages } from '../lib/messages';

interface LeadQuery {
  stage?: string;
  source?: string;
  search?: string;
  course?: string;
  page?: number;
  limit?: number;
}

interface UseLeadsReturn {
  leads: Lead[];
  total: number;
  pages: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useLeads(query: LeadQuery): UseLeadsReturn {
  const [data, setData] = useState<PaginatedResponse<Lead>>({ data: [], total: 0, page: 1, limit: 20, pages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.getLeads(query as Record<string, unknown>);
      setData(result);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.leads));
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(query)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void fetchLeads(); }, [fetchLeads]);

  return { leads: data.data, total: data.total, pages: data.pages, loading, error, refetch: fetchLeads };
}

interface UseSingleLeadReturn {
  lead: Lead | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useLead(id: string): UseSingleLeadReturn {
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLead = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.getLead(id);
      setLead(result);
    } catch (err) {
      setError(apiErrorMessage(err, Messages.load.lead));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void fetchLead(); }, [fetchLead]);

  return { lead, loading, error, refetch: fetchLead };
}
