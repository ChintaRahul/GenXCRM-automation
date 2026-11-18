import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  name: 'Alice Director',
  email: 'alice@co.com',
  role: 'DIRECTOR',
  teamId: null,
};

describe('LeadsPage — multi-stage filter', () => {
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
    vi.mocked(client.getLeadFacets).mockResolvedValue({
      stages: [
        { value: 'NEW', count: 4 },
        { value: 'CONTACTED', count: 2 },
      ],
      sources: [],
      courses: [],
      cities: [],
    });
    vi.mocked(client.getLeads).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 } as never);
  });

  it('sends every selected stage to the API after Apply, not just the last one', async () => {
    render(
      <MemoryRouter initialEntries={['/leads']}>
        <TooltipProvider>
          <LeadsPage />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(client.getLeads).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Filters'));
    await waitFor(() => expect(screen.getByText('Lead score')).toBeInTheDocument());

    // Stage is a dropdown trigger now, not an always-expanded chip list —
    // open it before its checklist options are in the DOM.
    fireEvent.click(screen.getByText('Any stage'));
    fireEvent.click(screen.getByText('NEW'));
    fireEvent.click(screen.getByText('CONTACTED'));
    fireEvent.click(screen.getByText('Apply'));

    await waitFor(() => {
      const lastCall = vi.mocked(client.getLeads).mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({ stages: ['NEW', 'CONTACTED'] });
    });
  });
});
