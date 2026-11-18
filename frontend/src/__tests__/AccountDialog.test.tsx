import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { toast } from 'sonner';
import { AccountDialog } from '../components/layout/AccountDialog';
import type { User } from '../types';

vi.mock('../api/client');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

import * as authCtx from '../context/AuthContext';
import * as apiClient from '../api/client';

const mockDirector: User = {
  id: 'u1',
  name: 'Alice Director',
  email: 'alice@co.com',
  role: 'DIRECTOR',
  teamId: null,
  org: {
    id: 'org-1',
    name: 'GenX CRM',
    slug: 'genxcrm',
    industry: 'EDTECH',
    workspaceType: 'EDTECH',
    size: 'SMALL',
    country: 'IN',
    timezone: 'Asia/Kolkata',
    gstNumber: '27ABCDE1234F1Z5',
    planStatus: 'ACTIVE',
    trialEndsAt: '2026-12-31T00:00:00.000Z',
  },
};

describe('AccountDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: mockDirector,
      token: 'tok',
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    });
  });

  it('marks the password inputs to opt out of browser autofill', () => {
    render(<AccountDialog open={true} onClose={vi.fn()} />);

    expect(screen.getByLabelText('Current Password')).toHaveAttribute('autoComplete', 'off');
    expect(screen.getByLabelText('New Password')).toHaveAttribute('autoComplete', 'new-password');
  });

  it('has no GST number or assignment-notification fields (moved to Administration > Organization)', () => {
    render(<AccountDialog open={true} onClose={vi.fn()} />);

    expect(screen.queryByLabelText('GST Number')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Email reps when a lead is assigned to them')).not.toBeInTheDocument();
  });

  it('shows the name and blank password on every open, even without unmounting', () => {
    const onClose = vi.fn();
    const { rerender: rr } = render(<AccountDialog open={true} onClose={onClose} />);

    expect(screen.getByLabelText('Name')).toHaveValue('Alice Director');
    expect(screen.getByLabelText('Current Password')).toHaveValue('');

    // Close, then reopen the same (never-unmounted) dialog instance — this is
    // the "second time" from the bug report. The reset effect must re-fire.
    rr(<AccountDialog open={false} onClose={onClose} />);
    rr(<AccountDialog open={true} onClose={onClose} />);

    expect(screen.getByLabelText('Name')).toHaveValue('Alice Director');
    expect(screen.getByLabelText('Current Password')).toHaveValue('');
  });

  it('shows a success toast and closes the dialog after a successful save', async () => {
    vi.mocked(apiClient.updateMe).mockResolvedValue({ ...mockDirector });
    const onClose = vi.fn();
    render(<AccountDialog open={true} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error toast and keeps the dialog open when the save fails', async () => {
    vi.mocked(apiClient.updateMe).mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    render(<AccountDialog open={true} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hides the Two-Factor Authentication section for a Director (Security tab owns it)', () => {
    render(<AccountDialog open={true} onClose={vi.fn()} />);
    expect(screen.queryByText('Two-Factor Authentication')).not.toBeInTheDocument();
  });

  it('shows the Two-Factor Authentication section for a Manager (no other route to it yet)', () => {
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: { ...mockDirector, role: 'MANAGER' },
      token: 'tok',
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    });
    render(<AccountDialog open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Two-Factor Authentication')).toBeInTheDocument();
  });

  it('shows the Two-Factor Authentication section for a Sales Rep (no other route to it at all)', () => {
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: { ...mockDirector, role: 'SALES_REP' },
      token: 'tok',
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    });
    render(<AccountDialog open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Two-Factor Authentication')).toBeInTheDocument();
  });
});
