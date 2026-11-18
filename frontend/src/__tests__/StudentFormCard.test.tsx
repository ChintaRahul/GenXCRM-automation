import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StudentFormCard } from '../components/register/StudentFormCard';
import * as client from '../api/client';
import { toast } from 'sonner';
import { Messages } from '../lib/messages';
import type { FormSubmissionDto, GoogleFormDto } from '../types';

vi.mock('../api/client');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const form: GoogleFormDto = {
  id: 'f1', name: 'Admissions', isActive: true, lastSubmissionAt: null,
  createdAt: '2026-09-24T00:00:00Z',
  lastSyncedAt: null, syncError: null, isLegacy: false,
};
const submission: FormSubmissionDto = {
  id: 's1', formId: 'f1', leadId: 'lead-1', status: 'PROCESSED', submittedAt: '2026-09-24T10:00:00Z',
  answers: { 'Preferred course': 'MBA' }, form: { name: 'Admissions' }, lead: { id: 'lead-1', name: 'Asha' },
};

describe('StudentFormCard', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getGoogleForms).mockResolvedValue([form]);
    vi.mocked(client.getFormSubmissions).mockResolvedValue([]);
  });

  it('tells staff when no Google form is connected', async () => {
    vi.mocked(client.getGoogleForms).mockResolvedValue([]);
    render(<StudentFormCard leadId="lead-1" />);
    expect(await screen.findByText(Messages.googleForms.noFormConnected)).toBeInTheDocument();
  });

  it('ignores inactive and legacy forms', async () => {
    vi.mocked(client.getGoogleForms).mockResolvedValue([{ ...form, isActive: false }, { ...form, id: 'f2', isLegacy: true }]);
    render(<StudentFormCard leadId="lead-1" />);
    expect(await screen.findByText(Messages.googleForms.noFormConnected)).toBeInTheDocument();
  });

  it('shows "waiting" with the send options while there is no response', async () => {
    render(<StudentFormCard leadId="lead-1" />);
    expect(await screen.findByText(Messages.googleForms.waiting)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'WhatsApp' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SMS' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });

  it('sends the form by the chosen channel for this lead', async () => {
    vi.mocked(client.sendGoogleForm).mockResolvedValue({ link: 'https://l', sent: true });
    render(<StudentFormCard leadId="lead-1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Email' }));
    await waitFor(() => expect(client.sendGoogleForm).toHaveBeenCalledWith('lead-1', { formId: 'f1', channel: 'EMAIL' }));
  });

  it('Check now runs a sync for the form and reloads this lead\'s responses', async () => {
    vi.mocked(client.syncGoogleForm).mockResolvedValue({ synced: 0 });
    render(<StudentFormCard leadId="lead-1" />);
    await screen.findByText(Messages.googleForms.waiting);
    await userEvent.click(screen.getByRole('button', { name: /check now/i }));
    await waitFor(() => expect(client.syncGoogleForm).toHaveBeenCalledWith('f1'));
    await waitFor(() => expect(client.getFormSubmissions).toHaveBeenCalledTimes(2));
  });

  it('shows "Received" with the read-only answers once the student has replied', async () => {
    vi.mocked(client.getFormSubmissions).mockResolvedValue([submission]);
    render(<StudentFormCard leadId="lead-1" />);
    expect(await screen.findByText(Messages.googleForms.received, { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Preferred course')).toBeInTheDocument();
    expect(screen.getByText('MBA')).toBeInTheDocument();
    expect(screen.queryByText(Messages.googleForms.waiting)).not.toBeInTheDocument();
  });

  it('queries only this lead\'s responses', async () => {
    render(<StudentFormCard leadId="lead-1" />);
    await screen.findByText(Messages.googleForms.waiting);
    expect(client.getFormSubmissions).toHaveBeenCalledWith({ leadId: 'lead-1' });
  });

  it('refreshes about every 30s while waiting, but not in a hidden tab, and stops on unmount', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const vis = vi.spyOn(document, 'visibilityState', 'get');
    vis.mockReturnValue('visible');
    const { unmount } = render(<StudentFormCard leadId="lead-1" />);
    await screen.findByText(Messages.googleForms.waiting);
    const base = vi.mocked(client.getFormSubmissions).mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(client.getFormSubmissions).toHaveBeenCalledTimes(base + 1);
    vis.mockReturnValue('hidden');
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(client.getFormSubmissions).toHaveBeenCalledTimes(base + 1);
    vis.mockReturnValue('visible');
    unmount();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(client.getFormSubmissions).toHaveBeenCalledTimes(base + 1);
  });

  it('does not treat a skipped check as an error', async () => {
    vi.mocked(client.syncGoogleForm).mockResolvedValue({ synced: 0, skipped: true });
    render(<StudentFormCard leadId="lead-1" />);
    await screen.findByText(Messages.googleForms.waiting);
    await userEvent.click(screen.getByRole('button', { name: /check now/i }));
    await waitFor(() => expect(client.syncGoogleForm).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: /check now/i })).toBeEnabled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('copies the prefilled link', async () => {
    vi.mocked(client.sendGoogleForm).mockResolvedValue({ link: 'https://l', sent: false });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<StudentFormCard leadId="lead-1" />);
    await userEvent.click(await screen.findByRole('button', { name: /copy link/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://l'));
    expect(client.sendGoogleForm).toHaveBeenCalledWith('lead-1', { formId: 'f1', channel: 'LINK' });
    expect(toast.success).toHaveBeenCalledWith(Messages.googleForms.linkCopied);
  });

  it('shows a picker when the org has several forms', async () => {
    vi.mocked(client.getGoogleForms).mockResolvedValue([form, { ...form, id: 'f2', name: 'Scholarship' }]);
    render(<StudentFormCard leadId="lead-1" />);
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
  });

  it('shows the newest response first', async () => {
    vi.mocked(client.getFormSubmissions).mockResolvedValue([
      { ...submission, id: 'old', submittedAt: '2026-09-20T10:00:00Z', answers: { Q: 'older' } },
      { ...submission, id: 'new', submittedAt: '2026-09-24T10:00:00Z', answers: { Q: 'newer' } },
    ]);
    render(<StudentFormCard leadId="lead-1" />);
    await screen.findByText(Messages.googleForms.received, { exact: false });
    expect(screen.getByText('newer')).toBeInTheDocument();
    expect(screen.queryByText('older')).not.toBeInTheDocument(); // collapsed
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 earlier response' }));
    expect(screen.getByText('older')).toBeInTheDocument();
  });

  it('shows no old answers after the lead changes', async () => {
    vi.mocked(client.getFormSubmissions).mockResolvedValueOnce([submission]);
    const { rerender } = render(<StudentFormCard key="lead-1" leadId="lead-1" />);
    await screen.findByText('MBA');
    vi.mocked(client.getFormSubmissions).mockReturnValue(new Promise(() => {}));
    rerender(<StudentFormCard key="lead-2" leadId="lead-2" />);
    expect(screen.queryByText('MBA')).not.toBeInTheDocument();
    expect(screen.queryByText(Messages.googleForms.received, { exact: false })).not.toBeInTheDocument();
  });

  it('skips poll ticks while a refresh is still running', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    render(<StudentFormCard leadId="lead-1" />);
    await screen.findByText(Messages.googleForms.waiting);
    const base = vi.mocked(client.getFormSubmissions).mock.calls.length;
    vi.mocked(client.getFormSubmissions).mockReturnValue(new Promise(() => {}));
    await act(async () => { vi.advanceTimersByTime(90_000); });
    expect(client.getFormSubmissions).toHaveBeenCalledTimes(base + 1);
  });

  it('keeps showing waiting during a background refresh', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    render(<StudentFormCard leadId="lead-1" />);
    await screen.findByText(Messages.googleForms.waiting);
    vi.mocked(client.getFormSubmissions).mockReturnValue(new Promise(() => {}));
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByText(Messages.googleForms.waiting)).toBeInTheDocument();
  });

  it('refreshes once when the tab becomes visible again', async () => {
    render(<StudentFormCard leadId="lead-1" />);
    await screen.findByText(Messages.googleForms.waiting);
    const base = vi.mocked(client.getFormSubmissions).mock.calls.length;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(client.getFormSubmissions).toHaveBeenCalledTimes(base + 1));
  });

  it('stops polling once a response arrives', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    render(<StudentFormCard leadId="lead-1" />);
    await screen.findByText(Messages.googleForms.waiting);
    vi.mocked(client.getFormSubmissions).mockResolvedValue([submission]);
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await screen.findByText(Messages.googleForms.received, { exact: false });
    const n = vi.mocked(client.getFormSubmissions).mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(client.getFormSubmissions).toHaveBeenCalledTimes(n);
  });

  it('keeps received answers when the forms list errors', async () => {
    vi.mocked(client.getFormSubmissions).mockResolvedValue([submission]);
    vi.mocked(client.getGoogleForms).mockRejectedValue(new Error('x'));
    render(<StudentFormCard leadId="lead-1" />);
    expect(await screen.findByText('MBA')).toBeInTheDocument();
  });

  it('sends WhatsApp and SMS with the right channel, no success text in the card on failure', async () => {
    vi.mocked(client.sendGoogleForm).mockResolvedValue({ link: 'l', sent: false });
    render(<StudentFormCard leadId="lead-1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'WhatsApp' }));
    await waitFor(() => expect(client.sendGoogleForm).toHaveBeenCalledWith('lead-1', { formId: 'f1', channel: 'WHATSAPP' }));
    await userEvent.click(screen.getByRole('button', { name: 'SMS' }));
    await waitFor(() => expect(client.sendGoogleForm).toHaveBeenCalledWith('lead-1', { formId: 'f1', channel: 'SMS' }));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryByText(Messages.googleForms.sent)).not.toBeInTheDocument();
  });

  it('toasts when the clipboard fails', async () => {
    vi.mocked(client.sendGoogleForm).mockResolvedValue({ link: 'https://l', sent: false });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
    render(<StudentFormCard leadId="lead-1" />);
    await userEvent.click(await screen.findByRole('button', { name: /copy link/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(Messages.googleForms.copyFailed));
  });
});
