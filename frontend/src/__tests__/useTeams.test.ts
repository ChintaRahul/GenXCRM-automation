import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTeams } from '../hooks/useTeams';
import * as client from '../api/client';
import { Messages } from '../lib/messages';

vi.mock('../api/client');

const mockTeam = {
  id: 't1',
  name: 'Growth Team',
  managerId: 'u1',
  manager: { id: 'u1', name: 'Alice' },
  members: [{ id: 'u2', name: 'Bob', role: 'SALES_REP' as const }],
  orgId: 'org-1',
  type: 'MEMBER' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('useTeams', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns teams on successful fetch', async () => {
    vi.mocked(client.getTeams).mockResolvedValue([mockTeam]);
    const { result } = renderHook(() => useTeams());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.teams).toHaveLength(1);
    expect(result.current.teams[0].name).toBe('Growth Team');
    expect(result.current.error).toBeNull();
  });

  it('sets error state on failed fetch', async () => {
    vi.mocked(client.getTeams).mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useTeams());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.load.teams);
    expect(result.current.teams).toHaveLength(0);
  });

  it('starts loading true and resolves to false', async () => {
    vi.mocked(client.getTeams).mockResolvedValue([]);
    const { result } = renderHook(() => useTeams());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('refetch re-triggers the API call', async () => {
    vi.mocked(client.getTeams).mockResolvedValue([mockTeam]);
    const { result } = renderHook(() => useTeams());
    await waitFor(() => expect(result.current.loading).toBe(false));
    result.current.refetch();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(client.getTeams).toHaveBeenCalledTimes(2);
  });
});
