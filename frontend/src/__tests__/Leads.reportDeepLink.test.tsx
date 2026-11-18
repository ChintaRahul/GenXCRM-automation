import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import LeadsPage from '../pages/Leads';
import { TooltipProvider } from '../components/ui/tooltip';
import * as client from '../api/client';
import type { User } from '../types';

vi.mock('../api/client');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/LeadStatsContext', () => ({ useLeadStats: vi.fn() }));

import * as authCtx from '../context/AuthContext';
import * as leadStatsCtx from '../context/LeadStatsContext';

const mockUser: User = { id: 'u1', name: 'Alice', email: 'a@co.com', role: 'DIRECTOR', teamId: null };
const REPORT_LINK = '/leads?dateField=updated&stage=ENROLLED&createdAfter=2026-09-17&createdBefore=2026-09-23';

const renderLeads = (initial: string) =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <TooltipProvider>
        <Routes>
          <Route path="/leads" element={<LeadsPage />} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );

describe('LeadsPage — report card deep links and Back navigation', () => {
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

  it('sends the card range + dateField on the first fetch and labels it correctly', async () => {
    renderLeads(REPORT_LINK);
    await waitFor(() => expect(client.getLeads).toHaveBeenCalled());
    expect(vi.mocked(client.getLeads).mock.calls[0][0]).toMatchObject({
      createdAfter: '2026-09-17',
      createdBefore: '2026-09-23',
      dateField: 'updated',
    });
    expect(await screen.findByText('Updated in range')).toBeTruthy();
    expect(screen.queryByText('MTD')).toBeNull();
  });

  it('keeps the report range (not MTD) when returning via Back from lead detail', async () => {
    const first = renderLeads(REPORT_LINK);
    await waitFor(() => expect(client.getLeads).toHaveBeenCalled());
    first.unmount(); // navigating to /leads/:id unmounts the page and caches its filters

    vi.mocked(client.getLeads).mockClear();
    renderLeads('/leads'); // a fresh MemoryRouter starts as a POP, like navigate(-1)
    await waitFor(() => expect(client.getLeads).toHaveBeenCalled());
    expect(vi.mocked(client.getLeads).mock.calls[0][0]).toMatchObject({
      createdAfter: '2026-09-17',
      createdBefore: '2026-09-23',
      dateField: 'updated',
    });
    expect(await screen.findByText('Updated in range')).toBeTruthy();
    expect(screen.queryByText('MTD')).toBeNull();
  });

  it('starts clean (default MTD) on a fresh visit instead of reusing stale cached filters', async () => {
    const first = renderLeads(REPORT_LINK);
    await waitFor(() => expect(client.getLeads).toHaveBeenCalled());
    first.unmount();

    vi.mocked(client.getLeads).mockClear();
    render(
      <MemoryRouter initialEntries={['/other']}>
        <TooltipProvider>
          <Routes>
            <Route path="/other" element={<Link to="/leads">go</Link>} />
            <Route path="/leads" element={<LeadsPage />} />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('go')); // PUSH, like clicking the sidebar link
    await waitFor(() => expect(client.getLeads).toHaveBeenCalled());
    const args = vi.mocked(client.getLeads).mock.calls[0][0] as Record<string, unknown>;
    expect(args.createdBefore).toBeUndefined();
    expect(args.dateField).toBeUndefined();
    expect(args.stages).toBeUndefined();
    expect(await screen.findByText('MTD')).toBeTruthy();
  });

  it('opens an all-time list (no date filter) from the Dashboard "Total leads" link', async () => {
    renderLeads('/leads?datePreset=all');
    await waitFor(() => expect(client.getLeads).toHaveBeenCalled());
    const args = vi.mocked(client.getLeads).mock.calls[0][0] as Record<string, unknown>;
    expect(args.createdAfter).toBeUndefined();
    expect(await screen.findByText('All time')).toBeTruthy();
    expect(screen.queryByText('MTD')).toBeNull();
  });
});
