import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import LeadsPage from '../pages/Leads';
import { TooltipProvider } from '../components/ui/tooltip';
import * as client from '../api/client';
import { toast } from 'sonner';
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

// SCRUM-46: after creating a duplicate lead, users reported the expected "already
// exists" error, followed later by a spurious "Lead created successfully" popup.
// Root cause: handleCreate had no guard against being invoked twice for the same
// click/submit (e.g. a double-click landing before React disables the submit
// button). Two overlapping requests for the same lead could both reach the
// backend — the first creates it, the second is then correctly flagged as a
// duplicate of it — and whichever response came back first decided which toast
// showed, so a duplicate error could appear even though a lead really was just
// created. The fix guards handleCreate with a ref that updates synchronously
// (unlike React state), so a second overlapping submit is dropped before it ever
// calls the API.
describe('LeadsPage — Add Lead double-submit guard', () => {
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
      stages: [],
      sources: [],
      courses: [],
      cities: [],
    });
    vi.mocked(client.getLeads).mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 } as never);
  });

  it('calls createLead only once when the form is submitted twice before the first request settles', async () => {
    let resolveCreate!: (value: unknown) => void;
    vi.mocked(client.createLead).mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }) as never,
    );

    render(
      <MemoryRouter initialEntries={['/leads']}>
        <TooltipProvider>
          <LeadsPage />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(client.getLeads).toHaveBeenCalled());

    fireEvent.click(screen.getAllByRole('button', { name: /add lead/i })[0]);
    await waitFor(() => expect(screen.getByText('Add New Lead')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Rahul Sharma'), {
      target: { value: 'Jane Doe' },
    });
    fireEvent.change(screen.getByPlaceholderText('98765 43210'), {
      target: { value: '9876543210' },
    });

    const form = screen.getByPlaceholderText('Rahul Sharma').closest('form')!;
    // Simulate a double-click / double-submit landing before React re-renders the
    // submit button as disabled — both submits fire while the first request is
    // still in flight (createLead's promise hasn't resolved yet).
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(client.createLead).toHaveBeenCalledTimes(1);

    resolveCreate({ id: 'lead-1' });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(client.createLead).toHaveBeenCalledTimes(1);
  });

  it('shows the duplicate message from the server, not a success toast, when creation is rejected', async () => {
    vi.mocked(client.createLead).mockRejectedValue({
      response: {
        data: {
          statusCode: 409,
          message: { message: 'A lead with this phone number or email already exists.', existingId: 'lead-1' },
        },
      },
    });

    render(
      <MemoryRouter initialEntries={['/leads']}>
        <TooltipProvider>
          <LeadsPage />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(client.getLeads).toHaveBeenCalled());

    fireEvent.click(screen.getAllByRole('button', { name: /add lead/i })[0]);
    await waitFor(() => expect(screen.getByText('Add New Lead')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Rahul Sharma'), {
      target: { value: 'Jane Doe' },
    });
    fireEvent.change(screen.getByPlaceholderText('98765 43210'), {
      target: { value: '9876543210' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('A lead with this phone number or email already exists.'),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
