import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
import React from 'react';
import { AddMemberDialog } from '../components/team/AddMemberDialog';
import * as client from '../api/client';
import * as authCtx from '../context/AuthContext';
import type { Team } from '../types';

vi.mock('../api/client');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// useWorkspace() (called for the Manufacturing-role select) reads useAuth() — mock it here,
// same pattern as ModuleListPage.test.tsx. Defaults to an EDTECH org so existing assertions
// about the dialog's baseline fields are unaffected.
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockTeams: Team[] = [
  {
    id: 't1',
    name: 'Growth Team',
    managerId: 'u1',
    manager: { id: 'u1', name: 'Alice' },
    members: [],
    orgId: 'org-1',
    type: 'MEMBER' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  teams: mockTeams,
  onCreated: vi.fn(),
};

describe('AddMemberDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: { id: 'u1', name: 'Test User', email: 'test@example.com', role: 'DIRECTOR', teamId: null, org: { workspaceType: 'EDTECH' } },
      token: 'tok',
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    } as never);
  });

  it('renders name + email fields', () => {
    render(<AddMemberDialog {...defaultProps} callerRole="DIRECTOR" callerTeamId={null} />);
    expect(screen.getByRole('heading', { name: 'Add member' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Full name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('email@company.com')).toBeInTheDocument();
  });

  it('does not render any password field (member sets their own via emailed link)', () => {
    render(<AddMemberDialog {...defaultProps} callerRole="DIRECTOR" callerTeamId={null} />);
    expect(screen.queryByText('Password *')).toBeNull();
    expect(screen.queryByText('Confirm password *')).toBeNull();
    expect(screen.queryByPlaceholderText('Min 8 characters')).toBeNull();
    // Explains the emailed set-your-own-password flow to the admin.
    expect(screen.getByText(/set their own password/i)).toBeInTheDocument();
  });

  it('Director sees 3 role options in the role Select', () => {
    render(<AddMemberDialog {...defaultProps} callerRole="DIRECTOR" callerTeamId={null} />);
    expect(screen.getAllByText('Sales Rep').length).toBeGreaterThan(0);
  });

  it('Manager sees static "Sales Rep" text instead of role select', () => {
    render(<AddMemberDialog {...defaultProps} callerRole="MANAGER" callerTeamId="t1" />);
    expect(screen.getAllByText('Sales Rep').length).toBeGreaterThan(0);
    expect(screen.queryByText('Director')).toBeNull();
  });

  it('Manager sees their own team pre-populated as static text', () => {
    render(<AddMemberDialog {...defaultProps} callerRole="MANAGER" callerTeamId="t1" />);
    expect(screen.getByText('Growth Team')).toBeInTheDocument();
  });

  it('Director sees team Select with all teams', () => {
    render(
      <AddMemberDialog {...defaultProps} callerRole="DIRECTOR" callerTeamId={null} teams={mockTeams} />,
    );
    expect(screen.getAllByText('No team').length).toBeGreaterThan(0);
  });

  it('submits name/email/role without a password field', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    vi.mocked(client.createUser).mockResolvedValue({
      id: 'u9',
      name: 'New Rep',
      email: 'new@co.com',
      role: 'SALES_REP',
      teamId: null,
    });
    const onCreated = vi.fn();

    render(
      <AddMemberDialog
        open={true}
        onOpenChange={vi.fn()}
        teams={mockTeams}
        callerRole="DIRECTOR"
        callerTeamId={null}
        onCreated={onCreated}
      />,
    );

    await user.type(screen.getByPlaceholderText('Full name'), 'New Rep');
    await user.type(screen.getByPlaceholderText('email@company.com'), 'new@co.com');
    await user.click(screen.getByRole('button', { name: /add member/i }));

    await waitFor(() => expect(client.createUser).toHaveBeenCalled());
    const payload = vi.mocked(client.createUser).mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('password');
    expect(payload).toMatchObject({ name: 'New Rep', email: 'new@co.com' });
    expect(onCreated).toHaveBeenCalled();
  });

  const seatLimitError = {
    response: {
      data: { code: 'SEAT_LIMIT_REACHED', limit: 1, current: 7, message: 'All 1 paid seats are in use.' },
    },
  };

  async function submitMember(role: 'DIRECTOR' | 'MANAGER') {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    vi.mocked(client.createUser).mockRejectedValue(seatLimitError);
    render(<AddMemberDialog {...defaultProps} callerRole={role} callerTeamId={role === 'MANAGER' ? 't1' : null} />);
    await user.type(screen.getByPlaceholderText('Full name'), 'New Rep');
    await user.type(screen.getByPlaceholderText('email@company.com'), 'new@co.com');
    await user.click(screen.getByRole('button', { name: /add member/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    return vi.mocked(toast.error).mock.calls[0];
  }

  it('Director gets a seat-limit toast with an "Add seats" action that routes to billing', async () => {
    const [message, opts] = await submitMember('DIRECTOR');
    expect(message).toMatch(/paid seats are in use/i);
    const action = (opts as { action?: { label: string; onClick: () => void } })?.action;
    expect(action?.label).toBe('Add seats');
    action?.onClick();
    expect(mockNavigate).toHaveBeenCalledWith('/billing');
  });

  it('Manager gets a seat-limit toast with no billing action (directed to their director)', async () => {
    const [, opts] = await submitMember('MANAGER');
    const o = opts as { action?: unknown; description?: string };
    expect(o?.action).toBeUndefined();
    expect(o?.description).toMatch(/director/i);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  describe('Manufacturing role select', () => {
    beforeEach(() => {
      vi.mocked(authCtx.useAuth).mockReturnValue({
        user: { id: 'u1', name: 'Test User', email: 'test@example.com', role: 'DIRECTOR', teamId: null, org: { workspaceType: 'MANUFACTURING' } },
        token: 'tok', loading: false, signIn: vi.fn(), signOut: vi.fn(), updateUser: vi.fn(),
        isImpersonating: false, impersonate: vi.fn(), exitImpersonation: vi.fn(),
      } as never);
    });

    it('shows the Manufacturing role select for a Director in a Manufacturing org', () => {
      render(<AddMemberDialog {...defaultProps} callerRole="DIRECTOR" callerTeamId={null} />);
      expect(screen.getByText('Manufacturing role')).toBeInTheDocument();
    });

    it('does not show the Manufacturing role select for a non-Director', () => {
      render(<AddMemberDialog {...defaultProps} callerRole="MANAGER" callerTeamId="t1" />);
      expect(screen.queryByText('Manufacturing role')).not.toBeInTheDocument();
    });

    it('does not send mfgRole when left unassigned', async () => {
      const { default: userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      vi.mocked(client.createUser).mockResolvedValue({ id: 'u2' } as never);
      render(<AddMemberDialog {...defaultProps} callerRole="DIRECTOR" callerTeamId={null} />);
      await user.type(screen.getByPlaceholderText('Full name'), 'New Rep');
      await user.type(screen.getByPlaceholderText('email@company.com'), 'new@co.com');
      await user.click(screen.getByRole('button', { name: /add member/i }));
      await waitFor(() => expect(client.createUser).toHaveBeenCalled());
      const payload = vi.mocked(client.createUser).mock.calls[0][0] as Record<string, unknown>;
      expect(payload.mfgRole).toBeUndefined();
    });
  });
});
