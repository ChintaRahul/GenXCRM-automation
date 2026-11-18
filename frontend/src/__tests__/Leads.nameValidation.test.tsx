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

describe('LeadsPage — Add Lead name validation', () => {
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

  it('blocks submission with an inline error when the name exceeds 100 characters', async () => {
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

    const nameInput = screen.getByPlaceholderText('Rahul Sharma');
    // The Input has maxLength={100}, so fireEvent.change (which bypasses real typing)
    // is used to simulate a value that already exceeds the cap, e.g. from a paste.
    fireEvent.change(nameInput, { target: { value: 'A'.repeat(150) } });
    fireEvent.change(screen.getByPlaceholderText('98765 43210'), {
      target: { value: '9876543210' },
    });

    // The Create Lead button is disabled once the (untrimmed) name exceeds
    // 100 chars, so a real click can't submit. Submit the form directly to
    // exercise handleCreate's own guard as defense-in-depth.
    expect(screen.getByRole('button', { name: 'Create Lead' })).toBeDisabled();
    fireEvent.submit(nameInput.closest('form')!);

    await waitFor(() =>
      expect(screen.getByText('Name must be 100 characters or fewer.')).toBeInTheDocument(),
    );
    expect(client.createLead).not.toHaveBeenCalled();
  });

  it('disables the Create Lead button until name and phone are filled', async () => {
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

    const submitButton = screen.getByRole('button', { name: 'Create Lead' });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Rahul Sharma'), {
      target: { value: 'Jane Doe' },
    });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('98765 43210'), {
      target: { value: '9876543210' },
    });
    expect(submitButton).not.toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Rahul Sharma'), {
      target: { value: '   ' },
    });
    expect(submitButton).toBeDisabled();
  });

  it('shows a live inline limit message once the name reaches 100 characters', async () => {
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

    const nameInput = screen.getByPlaceholderText('Rahul Sharma');

    fireEvent.change(nameInput, { target: { value: 'A'.repeat(99) } });
    expect(screen.getByText('99/100')).toBeInTheDocument();
    expect(screen.queryByText('Maximum length reached (100 characters).')).not.toBeInTheDocument();

    fireEvent.change(nameInput, { target: { value: 'A'.repeat(100) } });
    expect(screen.getByText('Maximum length reached (100 characters).')).toBeInTheDocument();
  });

  it('trims and collapses whitespace in the name before submitting', async () => {
    vi.mocked(client.createLead).mockResolvedValue({} as never);

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
      target: { value: '  Jane   Doe  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('98765 43210'), {
      target: { value: '9876543210' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));

    await waitFor(() =>
      expect(client.createLead).toHaveBeenCalledWith(expect.objectContaining({ name: 'Jane Doe' })),
    );
  });

  it('omits email from the payload when left blank, instead of sending an empty string', async () => {
    vi.mocked(client.createLead).mockResolvedValue({} as never);

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

    await waitFor(() => expect(client.createLead).toHaveBeenCalled());
    const payload = vi.mocked(client.createLead).mock.calls[0][0];
    expect(payload.email).toBeUndefined();
  });

  it('keeps the dialog open and shows a toast when the create request fails', async () => {
    vi.mocked(client.createLead).mockRejectedValue({
      response: { data: { message: 'email must be an email' } },
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

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('email must be an email'));
    // The dialog must stay open on failure — only the success path closes it —
    // so the user's typed data isn't lost and they can see/retry.
    expect(screen.getByText('Add New Lead')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Rahul Sharma')).toHaveValue('Jane Doe');
  });

  it('clears whitespace-only input and the inline error after closing via Cancel', async () => {
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

    const nameInput = screen.getByPlaceholderText('Rahul Sharma');
    fireEvent.change(nameInput, { target: { value: ' '.repeat(100) } });
    fireEvent.change(screen.getByPlaceholderText('98765 43210'), {
      target: { value: '9876543210' },
    });
    // The Create Lead button is disabled for a whitespace-only (trimmed-empty)
    // name, so submit the form directly to reach handleCreate's guard.
    fireEvent.submit(nameInput.closest('form')!);

    await waitFor(() => expect(screen.getByText('Enter a name.')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Add New Lead')).not.toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: /add lead/i })[0]);
    await waitFor(() => expect(screen.getByText('Add New Lead')).toBeInTheDocument());

    expect(screen.getByPlaceholderText('Rahul Sharma')).toHaveValue('');
    expect(screen.queryByText('Enter a name.')).not.toBeInTheDocument();
  });

  it('clears whitespace-only input and the inline error after closing via Escape', async () => {
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

    const nameInput = screen.getByPlaceholderText('Rahul Sharma');
    fireEvent.change(nameInput, { target: { value: ' '.repeat(100) } });
    fireEvent.change(screen.getByPlaceholderText('98765 43210'), {
      target: { value: '9876543210' },
    });
    // The Create Lead button is disabled for a whitespace-only (trimmed-empty)
    // name, so submit the form directly to reach handleCreate's guard.
    fireEvent.submit(nameInput.closest('form')!);

    await waitFor(() => expect(screen.getByText('Enter a name.')).toBeInTheDocument());

    fireEvent.keyDown(screen.getByText('Add New Lead'), { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Add New Lead')).not.toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: /add lead/i })[0]);
    await waitFor(() => expect(screen.getByText('Add New Lead')).toBeInTheDocument());

    expect(screen.getByPlaceholderText('Rahul Sharma')).toHaveValue('');
    expect(screen.queryByText('Enter a name.')).not.toBeInTheDocument();
  });

  it('allows digits and symbols in the name, matching web (SCRUM-40)', async () => {
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

    const nameInput = screen.getByPlaceholderText('Rahul Sharma');

    // Names like "John 2nd", "O'Brien & Co.", and "Lead-123" are all valid on web —
    // the field must not strip digits or symbols live as the user types.
    fireEvent.change(nameInput, { target: { value: "John 2nd" } });
    expect(nameInput).toHaveValue('John 2nd');

    fireEvent.change(nameInput, { target: { value: "O'Brien & Co." } });
    expect(nameInput).toHaveValue("O'Brien & Co.");

    fireEvent.change(nameInput, { target: { value: 'Lead-123' } });
    expect(nameInput).toHaveValue('Lead-123');
  });

  it('accepts a purely numeric name, matching web', async () => {
    vi.mocked(client.createLead).mockResolvedValue({} as never);

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

    const nameInput = screen.getByPlaceholderText('Rahul Sharma');
    fireEvent.change(nameInput, { target: { value: '789456' } });
    fireEvent.change(screen.getByPlaceholderText('98765 43210'), {
      target: { value: '9876543210' },
    });

    expect(screen.getByRole('button', { name: 'Create Lead' })).not.toBeDisabled();
    fireEvent.submit(nameInput.closest('form')!);

    await waitFor(() => expect(client.createLead).toHaveBeenCalled());
    expect(screen.queryByText('Enter a name.')).not.toBeInTheDocument();
  });

  it('shows the name error on blur, before any submit attempt', async () => {
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

    const nameInput = screen.getByPlaceholderText('Rahul Sharma');
    expect(screen.queryByText('Enter a name.')).not.toBeInTheDocument();

    fireEvent.blur(nameInput);
    expect(screen.getByText('Enter a name.')).toBeInTheDocument();

    fireEvent.change(nameInput, { target: { value: 'Jane Doe' } });
    expect(screen.queryByText('Enter a name.')).not.toBeInTheDocument();
  });

  it('shows the phone error on blur, before any submit attempt', async () => {
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

    const phoneInput = screen.getByPlaceholderText('98765 43210');
    fireEvent.change(phoneInput, { target: { value: '123' } });
    expect(
      screen.queryByText('Enter a valid 10-digit phone number.'),
    ).not.toBeInTheDocument();

    fireEvent.blur(phoneInput);
    expect(
      screen.getByText('Enter a valid 10-digit phone number.'),
    ).toBeInTheDocument();

    fireEvent.change(phoneInput, { target: { value: '9876543210' } });
    expect(
      screen.queryByText('Enter a valid 10-digit phone number.'),
    ).not.toBeInTheDocument();
  });

  it('strips non-digit characters and caps input at 10 digits as the user types', async () => {
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

    const phoneInput = screen.getByPlaceholderText('98765 43210');

    // Letters/symbols typed alongside digits are filtered out live, not just on blur/submit.
    fireEvent.change(phoneInput, { target: { value: '98abc76!!5' } });
    expect(phoneInput).toHaveValue('98765');

    // A stray extra digit or leading country code is truncated to the last 10 digits
    // as it's typed, instead of being accepted and only flagged after the fact.
    fireEvent.change(phoneInput, { target: { value: '19876543210' } });
    expect(phoneInput).toHaveValue('1987654321');
  });

  it('shows the email error on blur, before any submit attempt', async () => {
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

    const emailInput = screen.getByPlaceholderText('rahul@example.com');
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
    expect(screen.queryByText('Enter a valid email address.')).not.toBeInTheDocument();

    fireEvent.blur(emailInput);
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();

    fireEvent.change(emailInput, { target: { value: 'jane@example.com' } });
    expect(screen.queryByText('Enter a valid email address.')).not.toBeInTheDocument();
  });

  it('rejects an email whose domain repeats a segment (e.g. .com.com)', async () => {
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

    const emailInput = screen.getByPlaceholderText('rahul@example.com');
    fireEvent.change(emailInput, { target: { value: 'sklsd@sdf.com.com.com' } });
    fireEvent.blur(emailInput);
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Rahul Sharma'), {
      target: { value: 'Jane Doe' },
    });
    fireEvent.change(screen.getByPlaceholderText('98765 43210'), {
      target: { value: '9876543210' },
    });
    fireEvent.submit(emailInput.closest('form')!);
    expect(client.createLead).not.toHaveBeenCalled();
  });

  it('does not show an email error on blur when the (optional) field is left empty', async () => {
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

    const emailInput = screen.getByPlaceholderText('rahul@example.com');
    fireEvent.blur(emailInput);
    expect(screen.queryByText('Enter a valid email address.')).not.toBeInTheDocument();
  });
});
