import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFormSubmissions } from '../hooks/useFormSubmissions';
import * as client from '../api/client';
import { Messages } from '../lib/messages';

vi.mock('../api/client');

describe('useFormSubmissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches with the given query', async () => {
    vi.mocked(client.getFormSubmissions).mockResolvedValue([]);
    const { result } = renderHook(() => useFormSubmissions({ leadId: 'l1' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(client.getFormSubmissions).toHaveBeenCalledWith({ leadId: 'l1' });
    expect(result.current.submissions).toEqual([]);
  });

  it('sets error on failure', async () => {
    vi.mocked(client.getFormSubmissions).mockRejectedValue(new Error('net'));
    const { result } = renderHook(() => useFormSubmissions({}));
    await waitFor(() => expect(result.current.error).toBe(Messages.googleForms.submissionsFailed));
  });

  it('clears old submissions on lead change and ignores a late response for the old lead', async () => {
    const sub = (leadId: string) => ({ id: leadId, leadId }) as never;
    let resolveA: (v: never[]) => void = () => {};
    let resolveB: (v: never[]) => void = () => {};
    vi.mocked(client.getFormSubmissions).mockImplementation(({ leadId }: { leadId?: string }) =>
      new Promise((res) => { if (leadId === 'A') resolveA = res as never; else resolveB = res as never; }));
    const { result, rerender } = renderHook(({ id }) => useFormSubmissions({ leadId: id }), { initialProps: { id: 'A' } });
    rerender({ id: 'B' });
    expect(result.current.submissions).toEqual([]);
    expect(result.current.loading).toBe(true);
    await act(async () => { resolveB([sub('B')] as never[]); });
    await act(async () => { resolveA([sub('A')] as never[]); });
    expect(result.current.submissions).toEqual([sub('B')]);
  });

  it('does not show the previous lead data while the new lead loads', async () => {
    vi.mocked(client.getFormSubmissions).mockResolvedValueOnce([{ id: 'a' } as never]);
    const { result, rerender } = renderHook(({ id }) => useFormSubmissions({ leadId: id }), { initialProps: { id: 'A' } });
    await waitFor(() => expect(result.current.submissions).toHaveLength(1));
    vi.mocked(client.getFormSubmissions).mockReturnValue(new Promise(() => {}));
    rerender({ id: 'B' });
    expect(result.current.submissions).toEqual([]);
    expect(result.current.loading).toBe(true);
  });
});
