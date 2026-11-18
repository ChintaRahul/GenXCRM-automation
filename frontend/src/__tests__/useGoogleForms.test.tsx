import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
import { useGoogleForms } from '../hooks/useGoogleForms';
import * as client from '../api/client';
import { Messages } from '../lib/messages';
import type { GoogleFormDto } from '../types';

vi.mock('../api/client');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const form: GoogleFormDto = {
  id: 'f1', name: 'Intake',
  isActive: true, lastSubmissionAt: null, createdAt: '2026-09-24T00:00:00Z',
  lastSyncedAt: null, syncError: null, isLegacy: false,
};

describe('useGoogleForms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads forms', async () => {
    vi.mocked(client.getGoogleForms).mockResolvedValue([form]);
    const { result } = renderHook(() => useGoogleForms());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.forms).toHaveLength(1);
  });

  it('sets a friendly error when loading fails', async () => {
    vi.mocked(client.getGoogleForms).mockRejectedValue(new Error('net'));
    const { result } = renderHook(() => useGoogleForms());
    await waitFor(() => expect(result.current.error).toBe(Messages.googleForms.loadFailed));
  });

  it('addForm returns true and refetches on success, false on failure', async () => {
    vi.mocked(client.getGoogleForms).mockResolvedValue([]);
    vi.mocked(client.connectGoogleForm).mockResolvedValueOnce(form).mockRejectedValueOnce(new Error('bad'));
    const { result } = renderHook(() => useGoogleForms());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok = false;
    await act(async () => { ok = await result.current.addForm({ googleFormId: 'g1', createSheet: true }); });
    expect(ok).toBe(true);
    expect(client.getGoogleForms).toHaveBeenCalledTimes(2);
    await act(async () => { ok = await result.current.addForm({ googleFormId: 'g2', createSheet: true }); });
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalled();
  });

  it('setActive updates the form and refetches', async () => {
    vi.mocked(client.getGoogleForms).mockResolvedValue([form]);
    vi.mocked(client.updateGoogleForm).mockResolvedValue({ ...form, isActive: false });
    const { result } = renderHook(() => useGoogleForms());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setActive('f1', false); });
    expect(client.updateGoogleForm).toHaveBeenCalledWith('f1', { isActive: false });
    expect(client.getGoogleForms).toHaveBeenCalledTimes(2);
  });

  it('syncNow returns the result, toasts the outcome and refetches', async () => {
    vi.mocked(client.getGoogleForms).mockResolvedValue([form]);
    vi.mocked(client.syncGoogleForm).mockResolvedValue({ synced: 2 });
    const { result } = renderHook(() => useGoogleForms());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let out: unknown;
    await act(async () => { out = await result.current.syncNow('f1'); });
    expect(out).toEqual({ synced: 2 });
    expect(toast.success).toHaveBeenCalledWith(Messages.googleForms.syncedNow(2));
    expect(client.getGoogleForms).toHaveBeenCalledTimes(2);
  });

  it('setActive failure toasts the backend error and does not throw', async () => {
    vi.mocked(client.getGoogleForms).mockResolvedValue([form]);
    vi.mocked(client.updateGoogleForm).mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: 'Legacy forms cannot be changed' } },
    });
    const { result } = renderHook(() => useGoogleForms());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setActive('f1', false); });
    expect(toast.error).toHaveBeenCalledWith('Legacy forms cannot be changed');
  });

  it('syncNow toasts result.error and returns the result', async () => {
    vi.mocked(client.getGoogleForms).mockResolvedValue([form]);
    vi.mocked(client.syncGoogleForm).mockResolvedValue({ synced: 0, error: 'Google access removed' });
    const { result } = renderHook(() => useGoogleForms());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let out: unknown;
    await act(async () => { out = await result.current.syncNow('f1'); });
    expect(out).toEqual({ synced: 0, error: 'Google access removed' });
    expect(toast.error).toHaveBeenCalledWith('Google access removed');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('syncNow with skipped shows no toast', async () => {
    vi.mocked(client.getGoogleForms).mockResolvedValue([form]);
    vi.mocked(client.syncGoogleForm).mockResolvedValue({ synced: 0, skipped: true });
    const { result } = renderHook(() => useGoogleForms());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.syncNow('f1'); });
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('syncNow returns null and shows an error when it fails', async () => {
    vi.mocked(client.getGoogleForms).mockResolvedValue([form]);
    vi.mocked(client.syncGoogleForm).mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => useGoogleForms());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let out: unknown = 'unset';
    await act(async () => { out = await result.current.syncNow('f1'); });
    expect(out).toBeNull();
    expect(toast.error).toHaveBeenCalled();
  });
});
