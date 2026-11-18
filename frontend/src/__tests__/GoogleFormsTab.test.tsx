import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleFormsTab } from '../components/integrations/GoogleFormsTab';
import * as connHook from '../hooks/useGoogleConnection';
import * as formsHook from '../hooks/useGoogleForms';
import { Messages } from '../lib/messages';
import type { GoogleFormDto } from '../types';

vi.mock('../hooks/useGoogleConnection');
vi.mock('../hooks/useGoogleForms');
vi.mock('../hooks/useGooglePicker', () => ({ useGooglePicker: () => ({ picking: false, pick: vi.fn() }) }));

const base: GoogleFormDto = {
  id: 'f1', name: 'Admissions', isActive: true, lastSubmissionAt: null,
  createdAt: '2026-09-24T00:00:00Z',
  lastSyncedAt: '2026-09-24T10:00:00Z', syncError: null, isLegacy: false,
};

const conn = (over: Partial<ReturnType<typeof connHook.useGoogleConnection>> = {}) => ({
  connection: { status: 'CONNECTED' as const, accountName: 'owner@x.com', configured: true },
  loading: false, connecting: false, connect: vi.fn(), disconnect: vi.fn(), refetch: vi.fn(), complete: vi.fn(), ...over,
});
const forms = (list: GoogleFormDto[] = []) => ({
  forms: list, loading: false, error: null, addForm: vi.fn(), setActive: vi.fn(), removeForm: vi.fn(), syncNow: vi.fn(), refetch: vi.fn(),
});

describe('GoogleFormsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(formsHook.useGoogleForms).mockReturnValue(forms());
  });

  it('explains when Google Forms is not configured on the server', () => {
    vi.mocked(connHook.useGoogleConnection).mockReturnValue(conn({ connection: { status: 'DISCONNECTED', accountName: null, configured: false } }));
    render(<GoogleFormsTab />);
    expect(screen.getByText(Messages.googleForms.notConfigured)).toBeInTheDocument();
  });

  it('offers Connect Google when disconnected and calls connect', async () => {
    const c = conn({ connection: { status: 'DISCONNECTED', accountName: null, configured: true } });
    vi.mocked(connHook.useGoogleConnection).mockReturnValue(c);
    render(<GoogleFormsTab />);
    await userEvent.click(screen.getByRole('button', { name: /connect google/i }));
    expect(c.connect).toHaveBeenCalled();
  });

  it('asks to reconnect when access was removed (ERROR)', () => {
    vi.mocked(connHook.useGoogleConnection).mockReturnValue(conn({ connection: { status: 'ERROR', accountName: null, configured: true } }));
    render(<GoogleFormsTab />);
    expect(screen.getByText(Messages.googleForms.reconnectNeeded)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reconnect google/i })).toBeInTheDocument();
  });

  it('shows the connected account and an Add a form button', () => {
    vi.mocked(connHook.useGoogleConnection).mockReturnValue(conn());
    render(<GoogleFormsTab />);
    expect(screen.getByText(/owner@x\.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add a form/i })).toBeInTheDocument();
  });

  it('asks for confirmation before disconnecting', async () => {
    const c = conn();
    vi.mocked(connHook.useGoogleConnection).mockReturnValue(c);
    render(<GoogleFormsTab />);
    await userEvent.click(screen.getByRole('button', { name: /^disconnect$/i }));
    expect(c.disconnect).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /^yes$/i }));
    expect(c.disconnect).toHaveBeenCalled();
  });

  it('lists forms with last sync, sync errors, Check now and the on/off switch', async () => {
    vi.mocked(connHook.useGoogleConnection).mockReturnValue(conn());
    const f = forms([{ ...base, syncError: 'Google can no longer open this form' }]);
    vi.mocked(formsHook.useGoogleForms).mockReturnValue(f);
    render(<GoogleFormsTab />);
    expect(screen.getByText('Admissions')).toBeInTheDocument();
    expect(screen.getByText('Google can no longer open this form')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /check now/i }));
    expect(f.syncNow).toHaveBeenCalledWith('f1');
    await userEvent.click(screen.getByRole('switch', { name: /toggle admissions/i }));
    expect(f.setActive).toHaveBeenCalledWith('f1', false);
  });

  it('shows legacy Apps Script forms as "Legacy — reconnect" without a switch or Check now', () => {
    vi.mocked(connHook.useGoogleConnection).mockReturnValue(conn());
    vi.mocked(formsHook.useGoogleForms).mockReturnValue(forms([{ ...base, isLegacy: true, isActive: false }]));
    render(<GoogleFormsTab />);
    expect(screen.getByText(/legacy — reconnect/i)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /check now/i })).not.toBeInTheDocument();
  });

  it('deletes a form only after confirmation', async () => {
    vi.mocked(connHook.useGoogleConnection).mockReturnValue(conn());
    const f = forms([base]);
    vi.mocked(formsHook.useGoogleForms).mockReturnValue(f);
    render(<GoogleFormsTab />);
    await userEvent.click(screen.getByRole('button', { name: /delete admissions/i }));
    expect(f.removeForm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /^yes$/i }));
    expect(f.removeForm).toHaveBeenCalledWith('f1');
  });

  it('lets legacy forms be deleted too', () => {
    vi.mocked(connHook.useGoogleConnection).mockReturnValue(conn());
    vi.mocked(formsHook.useGoogleForms).mockReturnValue(forms([{ ...base, isLegacy: true, isActive: false }]));
    render(<GoogleFormsTab />);
    expect(screen.getByRole('button', { name: /delete admissions/i })).toBeInTheDocument();
  });
});
