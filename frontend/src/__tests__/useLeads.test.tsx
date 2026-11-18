import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useLeads, useLead } from '../hooks/useLeads';
import * as client from '../api/client';
import type { Lead, PaginatedResponse } from '../types';
import { Messages } from '../lib/messages';

vi.mock('../api/client');

const mockLead: Lead = {
  id: 'lead-1',
  name: 'John Doe',
  phone: '9999999999',
  source: 'FACEBOOK',
  stage: 'NEW',
  score: 0,
  interestedCount: 0,
  tags: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockPaginatedResponse: PaginatedResponse<Lead> = {
  data: [mockLead],
  total: 1,
  page: 1,
  limit: 20,
  pages: 1,
};

describe('useLeads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches and returns leads on success', async () => {
    vi.mocked(client.getLeads).mockResolvedValue(mockPaginatedResponse);
    const { result } = renderHook(() => useLeads({}));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.leads).toHaveLength(1);
    expect(result.current.leads[0].id).toBe('lead-1');
    expect(result.current.total).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('sets error state on failed fetch', async () => {
    vi.mocked(client.getLeads).mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useLeads({}));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.load.leads);
    expect(result.current.leads).toHaveLength(0);
  });

  it('starts in loading state', () => {
    vi.mocked(client.getLeads).mockResolvedValue(mockPaginatedResponse);
    const { result } = renderHook(() => useLeads({}));
    expect(result.current.loading).toBe(true);
  });

  it('exposes a refetch function that re-queries the API', async () => {
    vi.mocked(client.getLeads).mockResolvedValue(mockPaginatedResponse);
    const { result } = renderHook(() => useLeads({}));
    await waitFor(() => expect(result.current.loading).toBe(false));
    result.current.refetch();
    await waitFor(() => expect(client.getLeads).toHaveBeenCalledTimes(2));
  });
});

describe('useLead', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('fetches single lead by id', async () => {
    vi.mocked(client.getLead).mockResolvedValue(mockLead);
    const { result } = renderHook(() => useLead('lead-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lead).toEqual(mockLead);
    expect(client.getLead).toHaveBeenCalledWith('lead-1');
  });

  it('sets error when lead fetch fails', async () => {
    vi.mocked(client.getLead).mockRejectedValue(new Error('Not found'));
    const { result } = renderHook(() => useLead('bad-id'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.load.lead);
    expect(result.current.lead).toBeNull();
  });
});
