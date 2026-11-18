import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
import { useGooglePicker } from '../hooks/useGooglePicker';
import * as client from '../api/client';
import * as picker from '../lib/googlePicker';

vi.mock('../api/client');
vi.mock('../lib/googlePicker');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const config = { accessToken: 't', expiresAt: '2026-09-24T11:00:00Z', apiKey: 'k', appId: '123' };

describe('useGooglePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getGooglePickerConfig).mockResolvedValue(config);
    vi.mocked(picker.loadPickerApi).mockResolvedValue();
  });

  it('loads the picker script and config, opens the picker and returns the chosen file', async () => {
    vi.mocked(picker.openPicker).mockResolvedValue({ id: 'g1', name: 'Admissions' });
    const { result } = renderHook(() => useGooglePicker());
    let file: unknown;
    await act(async () => { file = await result.current.pick('form'); });
    expect(file).toEqual({ id: 'g1', name: 'Admissions' });
    expect(picker.openPicker).toHaveBeenCalledWith(config, 'form');
    expect(result.current.picking).toBe(false);
  });

  it('returns null when the user cancels', async () => {
    vi.mocked(picker.openPicker).mockResolvedValue(null);
    const { result } = renderHook(() => useGooglePicker());
    let file: unknown = 'unset';
    await act(async () => { file = await result.current.pick('sheet'); });
    expect(file).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('returns null and shows an error when the picker cannot load', async () => {
    vi.mocked(picker.loadPickerApi).mockRejectedValue(new Error('blocked'));
    const { result } = renderHook(() => useGooglePicker());
    let file: unknown = 'unset';
    await act(async () => { file = await result.current.pick('form'); });
    expect(file).toBeNull();
    expect(toast.error).toHaveBeenCalled();
    expect(result.current.picking).toBe(false);
  });
});
