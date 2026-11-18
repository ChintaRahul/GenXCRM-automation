import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
import { useSendForm } from '../hooks/useSendForm';
import * as client from '../api/client';
import { Messages } from '../lib/messages';

vi.mock('../api/client');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('useSendForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the result on success', async () => {
    vi.mocked(client.sendGoogleForm).mockResolvedValue({ link: 'https://x', sent: true });
    const { result } = renderHook(() => useSendForm('lead-1'));
    let r: unknown;
    await act(async () => { r = await result.current.send('f1', 'EMAIL'); });
    expect(r).toEqual({ link: 'https://x', sent: true });
    expect(client.sendGoogleForm).toHaveBeenCalledWith('lead-1', { formId: 'f1', channel: 'EMAIL' });
    expect(result.current.sending).toBe(false);
    expect(toast.success).toHaveBeenCalledWith(Messages.googleForms.sent);
  });

  it('returns null on failure', async () => {
    vi.mocked(client.sendGoogleForm).mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => useSendForm('lead-1'));
    let r: unknown = 'unset';
    await act(async () => { r = await result.current.send('f1', 'SMS'); });
    expect(r).toBeNull();
  });

  it('returns null and toasts an error when a non-LINK delivery did not go out', async () => {
    vi.mocked(client.sendGoogleForm).mockResolvedValue({ link: 'https://x', sent: false });
    const { result } = renderHook(() => useSendForm('lead-1'));
    let r: unknown = 'unset';
    await act(async () => { r = await result.current.send('f1', 'WHATSAPP'); });
    expect(r).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(Messages.googleForms.sendFailed);
  });

  it('returns the link for LINK channel without an error toast', async () => {
    vi.mocked(client.sendGoogleForm).mockResolvedValue({ link: 'https://x', sent: false });
    const { result } = renderHook(() => useSendForm('lead-1'));
    let r: unknown;
    await act(async () => { r = await result.current.send('f1', 'LINK'); });
    expect(r).toEqual({ link: 'https://x', sent: false });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
