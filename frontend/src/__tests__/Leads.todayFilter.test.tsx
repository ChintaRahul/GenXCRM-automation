import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import LeadsPage from '../pages/Leads';
import { TooltipProvider } from '../components/ui/tooltip';
import * as client from '../api/client';
import type { User } from '../types';

vi.mock('../api/client');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('../context/LeadStatsContext', () => ({
  useLeadStats: vi.fn(),
}));

import * as authCtx from '../context/AuthContext';
import * as leadStatsCtx from '../context/LeadStatsContext';

const mockUser: User = {
  id: 'u1',
  name: 'Alice Rep',
  email: 'alice@co.com',
  role: 'DIRECTOR',
  teamId: null,
};

describe('LeadsPage — Dashboard "New Today" deep link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: mockUser,
      token: 'tok',
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    });
    vi.mocked(leadStatsCtx.useLeadStats).mockReturnValue({
      stats: [],
      total: 0,
      orgTotal: 0,
      mtdTotal: 0,
      loading: false,
      refresh: vi.fn(),
    });
    vi.mocked(client.getUsers).mockResolvedValue([]);
    vi.mocked(client.getTeams).mockResolvedValue([]);
    vi.mocked(client.getImportMappings).mockResolvedValue([]);
    vi.mocked(client.getStageStats).mockResolvedValue([]);
    vi.mocked(client.getLeads).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 } as never);
  });

  it("filters by today's leads on first load instead of racing an unfiltered fetch", async () => {
    render(
      <MemoryRouter initialEntries={['/leads?createdAfter=2026-08-05T00:00:00.000Z']}>
        <TooltipProvider>
          <LeadsPage />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(client.getLeads).toHaveBeenCalled());

    // The very first call must already carry the filter — no earlier,
    // unfiltered call should have gone out and won a race against it.
    const firstCallArgs = vi.mocked(client.getLeads).mock.calls[0][0];
    expect(firstCallArgs).toMatchObject({
      createdAfter: '2026-08-05T00:00:00.000Z',
    });
    expect(
      vi.mocked(client.getLeads).mock.calls.some(
        (call) => call[0]?.createdAfter === undefined,
      ),
    ).toBe(false);
  });
});
