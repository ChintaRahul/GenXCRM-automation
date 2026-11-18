import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toast } from 'sonner';
import { useGoogleConnection } from '../hooks/useGoogleConnection';
import * as client from '../api/client';
import { Messages } from '../lib/messages';

vi.mock('../api/client');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../lib/platform', () => ({
  isNative: () => false,
  openExternal: vi.fn(),
  webAppUrl: () => 'https://app.test',
}));

const connected = { status: 'CONNECTED' as const, accountName: 'owner@x.com', configured: true };
const URL_ = 'https://accounts.google.com/x';

const makePopup = (closed = false) => ({ closed, close: vi.fn(), location: { href: '' } });
const asWindow = (p: ReturnType<typeof makePopup>) => p as unknown as Window;

const postMessage = (origin: string, data: unknown, source: unknown) => {
  const ev = new MessageEvent('message', { origin, data });
  Object.defineProperty(ev, 'source', { value: source });
  window.dispatchEvent(ev);
};

const ok = { type: 'genxcrm-google-forms', status: 'success' };

// Starts connect() and resolves once the popup has been pointed at Google (listener + poll registered).
const startConnect = async (
  result: { current: ReturnType<typeof useGoogleConnection> },
  popup: ReturnType<typeof makePopup>,
) => {
  let done: Promise<void> = Promise.resolve();
  act(() => { done = result.current.connect(); });
  await waitFor(() => expect(popup.location.href).toBe(URL_));
  return { done };
};

describe('useGoogleConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getGoogleConnection).mockResolvedValue(connected);
    vi.mocked(client.initGoogleFormsConnection).mockResolvedValue({ url: URL_ });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads the connection', async () => {
    const { result } = renderHook(() => useGoogleConnection());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.connection).toEqual(connected);
  });

  it('opens a blank popup synchronously, points it at the Google URL, refetches once closed', async () => {
    const popup = makePopup(true);
    const open = vi.spyOn(window, 'open').mockReturnValue(asWindow(popup));
    const { result } = renderHook(() => useGoogleConnection());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.connect(); });
    expect(open).toHaveBeenCalledWith('', 'oauth-popup', expect.any(String));
    expect(popup.location.href).toBe(URL_);
    expect(client.getGoogleConnection).toHaveBeenCalledTimes(2);
    expect(result.current.connecting).toBe(false);
  });

  it('opens the popup before calling the API (inside the click)', async () => {
    const order: string[] = [];
    vi.spyOn(window, 'open').mockImplementation(() => { order.push('open'); return asWindow(makePopup(true)); });
    vi.mocked(client.initGoogleFormsConnection).mockImplementation(async () => { order.push('init'); return { url: URL_ }; });
    const { result } = renderHook(() => useGoogleConnection());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.connect(); });
    expect(order).toEqual(['open', 'init']);
  });

  it('shows popupBlocked and skips the API when the popup is blocked', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { result } = renderHook(() => useGoogleConnection());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.connect(); });
    expect(toast.error).toHaveBeenCalledWith(Messages.googleForms.popupBlocked);
    expect(client.initGoogleFormsConnection).not.toHaveBeenCalled();
    expect(result.current.connecting).toBe(false);
  });

  it('closes the blank popup and toasts when init fails', async () => {
    const popup = makePopup();
    vi.spyOn(window, 'open').mockReturnValue(asWindow(popup));
    vi.mocked(client.initGoogleFormsConnection).mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useGoogleConnection());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.connect(); });
    expect(popup.close).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(result.current.connecting).toBe(false);
  });

  it('refetches and toasts on a success message from the popup', async () => {
    const popup = makePopup();
    vi.spyOn(window, 'open').mockReturnValue(asWindow(popup));
    const { result } = renderHook(() => useGoogleConnection());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const { done } = await startConnect(result, popup);
    await act(async () => {
      postMessage(window.location.origin, ok, popup);
      await done;
    });
    expect(toast.success).toHaveBeenCalledWith(Messages.googleForms.connected);
    expect(client.getGoogleConnection).toHaveBeenCalledTimes(2);
    expect(popup.close).toHaveBeenCalled();
  });

  it('toasts the message on an error message from the popup', async () => {
    const popup = makePopup();
    vi.spyOn(window, 'open').mockReturnValue(asWindow(popup));
    const { result } = renderHook(() => useGoogleConnection());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const { done } = await startConnect(result, popup);
    await act(async () => {
      postMessage(window.location.origin, { type: 'genxcrm-google-forms', status: 'error', message: 'denied' }, popup);
      await done;
    });
    expect(toast.error).toHaveBeenCalledWith('denied');
  });

  it('ignores wrong origin, wrong type and a foreign source', async () => {
    const popup = makePopup();
    vi.spyOn(window, 'open').mockReturnValue(asWindow(popup));
    const { result } = renderHook(() => useGoogleConnection());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await startConnect(result, popup);
    await act(async () => {
      postMessage('https://evil.example', ok, popup);
      postMessage(window.location.origin, { type: 'other', status: 'success' }, popup);
      postMessage(window.location.origin, ok, makePopup());
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(client.getGoogleConnection).toHaveBeenCalledTimes(1);
    expect(result.current.connecting).toBe(true);
  });

  it('ignores a second connect() while one is in progress', async () => {
    const popup = makePopup();
    const open = vi.spyOn(window, 'open').mockReturnValue(asWindow(popup));
    const { result } = renderHook(() => useGoogleConnection());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await startConnect(result, popup);
    await act(async () => { await result.current.connect(); });
    expect(open).toHaveBeenCalledTimes(1);
    expect(client.initGoogleFormsConnection).toHaveBeenCalledTimes(1);
  });

  it('removes the listener and interval on unmount (popup still open)', async () => {
    const popup = makePopup(false);
    vi.spyOn(window, 'open').mockReturnValue(asWindow(popup));
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const setIv = vi.spyOn(window, 'setInterval');
    const clearIv = vi.spyOn(window, 'clearInterval');
    const { result, unmount } = renderHook(() => useGoogleConnection());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await startConnect(result, popup);

    const handler = add.mock.calls.find(([type]) => type === 'message')?.[1];
    expect(handler).toBeDefined();
    const intervalId = setIv.mock.results.at(-1)?.value;
    expect(remove).not.toHaveBeenCalledWith('message', handler);

    unmount();

    expect(remove).toHaveBeenCalledWith('message', handler);
    expect(clearIv).toHaveBeenCalledWith(intervalId);
    postMessage(window.location.origin, ok, popup);
    expect(toast.success).not.toHaveBeenCalled();
    expect(client.getGoogleConnection).toHaveBeenCalledTimes(1);
  });

  it('closes the popup and toasts when pointing it at Google throws', async () => {
    const popup = makePopup();
    Object.defineProperty(popup, 'location', {
      get: () => ({
        set href(_v: string) { throw new Error('cross-origin'); },
      }),
    });
    vi.spyOn(window, 'open').mockReturnValue(asWindow(popup));
    const { result } = renderHook(() => useGoogleConnection());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.connect(); });
    expect(popup.close).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(Messages.googleForms.connectStartFailed);
    expect(result.current.connecting).toBe(false);
  });

  it('complete calls the API with code and state, and reports failure', async () => {
    vi.mocked(client.completeGoogleConnection)
      .mockResolvedValueOnce({ accountName: 'a@x.com' })
      .mockRejectedValueOnce(new Error('bad'));
    const { result } = renderHook(() => useGoogleConnection());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let res = false;
    await act(async () => { res = await result.current.complete('c', 's'); });
    expect(res).toBe(true);
    expect(client.completeGoogleConnection).toHaveBeenCalledWith('c', 's');
    await act(async () => { res = await result.current.complete('c2', 's2'); });
    expect(res).toBe(false);
    expect(toast.error).toHaveBeenCalled();
  });

  it('disconnect calls the API, toasts and refetches', async () => {
    vi.mocked(client.disconnectGoogleForms).mockResolvedValue();
    const { result } = renderHook(() => useGoogleConnection());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.disconnect(); });
    expect(client.disconnectGoogleForms).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(Messages.googleForms.disconnected);
    expect(client.getGoogleConnection).toHaveBeenCalledTimes(2);
  });
});
