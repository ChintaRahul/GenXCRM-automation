import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toast } from 'sonner';
import { SendFormDialog } from '../components/leadDetail/SendFormDialog';
import { Messages } from '../lib/messages';

const state = vi.hoisted(() => ({
  forms: [] as { id: string; name: string; isActive: boolean }[],
  loading: false,
  error: null as string | null,
  send: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../hooks/useGoogleForms', () => ({
  useGoogleForms: () => ({ forms: state.forms, loading: state.loading, error: state.error }),
}));
vi.mock('../hooks/useSendForm', () => ({
  useSendForm: () => ({ sending: false, send: state.send }),
}));

describe('SendFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.loading = false;
    state.error = null;
  });

  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  afterEach(() => {
    if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
    else delete (navigator as unknown as Record<string, unknown>).clipboard;
  });

  it('shows Loading instead of the empty state while forms load', () => {
    state.forms = [];
    state.loading = true;
    render(<SendFormDialog leadId="l1" open onOpenChange={() => {}} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText(/add a form under integrations/i)).not.toBeInTheDocument();
  });

  it('shows the error instead of the empty state', () => {
    state.forms = [];
    state.error = 'Boom';
    render(<SendFormDialog leadId="l1" open onOpenChange={() => {}} />);
    expect(screen.getByText('Boom')).toBeInTheDocument();
    expect(screen.queryByText(/add a form under integrations/i)).not.toBeInTheDocument();
  });

  it('shows an empty state when no forms are active', () => {
    state.forms = [{ id: 'f1', name: 'Off', isActive: false }];
    render(<SendFormDialog leadId="l1" open onOpenChange={() => {}} />);
    expect(screen.getByText(/add a form under integrations/i)).toBeInTheDocument();
  });

  it('toasts an error when the clipboard is unavailable on Copy link', async () => {
    state.forms = [{ id: 'f1', name: 'On', isActive: true }];
    state.send.mockResolvedValue({ link: 'https://x', sent: false });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<SendFormDialog leadId="l1" open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'On' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(Messages.googleForms.copyFailed));
  });
});
