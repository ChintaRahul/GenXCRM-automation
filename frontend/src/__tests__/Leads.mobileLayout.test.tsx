import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import LeadsPage from '../pages/Leads';
import { TooltipProvider } from '../components/ui/tooltip';
import * as client from '../api/client';
import type { Lead, User } from '../types';

vi.mock('../api/client');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

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

const mockLead: Lead = {
  id: 'l1',
  name: 'Kiran',
  phone: '7058942237',
  email: 'kiran@example.com',
  stage: 'NEW',
  source: 'INSTAGRAM',
  score: 10,
  tags: [],
  createdAt: new Date().toISOString(),
  interestedCount: 0,
} as unknown as Lead;

// SCRUM-22: on mobile, the Leads list page required horizontal scrolling — traced to
// (1) the Header action buttons (Auto Assign/Delete All/Import/Add Lead) not wrapping,
// unlike the equivalent actions row on the Lead detail page, and (2) the mobile lead-card
// name using a fixed pixel width instead of a shrinkable/truncating one. Both push content
// wider than the viewport, forcing the whole page to scroll sideways.
describe('LeadsPage — mobile layout (SCRUM-22)', () => {
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
      total: 1,
      orgTotal: 1,
      mtdTotal: 1,
      loading: false,
      refresh: vi.fn(),
    });
    vi.mocked(client.getUsers).mockResolvedValue([]);
    vi.mocked(client.getTeams).mockResolvedValue([]);
    vi.mocked(client.getImportMappings).mockResolvedValue([]);
    vi.mocked(client.getStageStats).mockResolvedValue([]);
    vi.mocked(client.getLeadFacets).mockResolvedValue({
      stages: [],
      sources: [],
      courses: [],
      cities: [],
    });
    vi.mocked(client.getLeads).mockResolvedValue({
      data: [mockLead],
      total: 1,
      page: 1,
      limit: 20,
    } as never);
  });

  it('wraps the header action buttons instead of forcing a single unbreakable row', async () => {
    render(
      <MemoryRouter initialEntries={['/leads']}>
        <TooltipProvider>
          <LeadsPage />
        </TooltipProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(client.getLeads).toHaveBeenCalled());

    const addLeadButton = screen.getAllByRole('button', { name: /add lead/i })[0];
    const actionsRow = addLeadButton.closest('div');
    expect(actionsRow?.className).toMatch(/\bflex-wrap\b/);
  });

  it('does not pin the mobile lead-card name to a fixed pixel width', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/leads']}>
        <TooltipProvider>
          <LeadsPage />
        </TooltipProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(client.getLeads).toHaveBeenCalled());

    // The mobile card list is the `md:hidden` sibling of the desktop `hidden md:block`
    // table — jsdom doesn't apply either media-query class, so both render; scope to
    // the mobile one specifically since the desktop table legitimately uses a fixed
    // width Link (it has room to spare inside a wide table column).
    const mobileList = container.querySelector('.md\\:hidden.space-y-2');
    expect(mobileList).not.toBeNull();
    const nameSpan = await within(mobileList as HTMLElement).findByText('Kiran');
    expect(nameSpan.className).not.toMatch(/\bw-\[\d+px\]/);
  });
});
