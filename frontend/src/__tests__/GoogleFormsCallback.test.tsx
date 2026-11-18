import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import GoogleFormsCallbackPage from '../pages/GoogleFormsCallback';
import * as connHook from '../hooks/useGoogleConnection';

vi.mock('../hooks/useGoogleConnection');
const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

describe('GoogleFormsCallbackPage', () => {
  const complete = vi.fn();
  const postMessage = vi.fn();
  const close = vi.spyOn(window, 'close').mockImplementation(() => {});

  const setUrl = (search: string) => window.history.replaceState({}, '', `/integrations/google-forms/callback${search}`);
  const setOpener = (opener: unknown) => Object.defineProperty(window, 'opener', { value: opener, configurable: true });
  const renderPage = () =>
    render(
      <StrictMode>
        <MemoryRouter>
          <GoogleFormsCallbackPage />
        </MemoryRouter>
      </StrictMode>,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    complete.mockResolvedValue(true);
    vi.mocked(connHook.useGoogleConnection).mockReturnValue({ complete } as unknown as ReturnType<typeof connHook.useGoogleConnection>);
    setOpener({ postMessage });
  });
  afterEach(() => {
    setOpener(null);
  });

  it('completes once, posts success to the opener and closes', async () => {
    setUrl('?code=c1&state=s1');
    renderPage();
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith('c1', 's1');
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'genxcrm-google-forms', status: 'success', message: undefined },
      window.location.origin,
    );
  });

  it('posts an error without calling the API when Google returned an error', async () => {
    setUrl('?error=access_denied');
    renderPage();
    await waitFor(() => expect(postMessage).toHaveBeenCalled());
    expect(complete).not.toHaveBeenCalled();
    expect(postMessage.mock.calls[0][0]).toMatchObject({ type: 'genxcrm-google-forms', status: 'error' });
    expect(close).toHaveBeenCalled();
  });

  it('posts an error when complete fails', async () => {
    complete.mockResolvedValue(false);
    setUrl('?code=c1&state=s1');
    renderPage();
    await waitFor(() => expect(postMessage).toHaveBeenCalled());
    expect(postMessage.mock.calls[0][0]).toMatchObject({ status: 'error' });
    expect(screen.getByRole('link', { name: /back to integrations/i })).toBeInTheDocument();
  });

  it('navigates to /integrations when there is no opener', async () => {
    setOpener(null);
    setUrl('?code=c1&state=s1');
    renderPage();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/integrations', { replace: true }));
    expect(postMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['code', '?state=s1'],
    ['state', '?code=c1'],
  ])('posts an error and closes when %s is missing', async (_name, qs) => {
    setUrl(qs);
    renderPage();
    await waitFor(() => expect(postMessage).toHaveBeenCalled());
    expect(complete).not.toHaveBeenCalled();
    expect(postMessage.mock.calls[0][0]).toMatchObject({ type: 'genxcrm-google-forms', status: 'error' });
    expect(close).toHaveBeenCalled();
  });
});
