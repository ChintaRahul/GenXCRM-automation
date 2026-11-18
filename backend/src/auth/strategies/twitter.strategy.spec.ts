import { TwitterStrategy, twitterStrategyOptions, type XProfile } from './twitter.strategy';

const ME_URL = 'https://api.x.com/2/users/me?user.fields=confirmed_email';

const mockFetchOnce = (status: number, body: unknown) => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const loadProfile = (strategy: TwitterStrategy) =>
  new Promise<{ error?: Error | null; profile?: XProfile }>((resolve) => {
    strategy.userProfile('tok-1', (error, profile) => resolve({ error, profile }));
  });

describe('TwitterStrategy (OAuth 2.0)', () => {
  const originalFetch = global.fetch;
  let strategy: TwitterStrategy;

  beforeEach(() => {
    process.env.TWITTER_CLIENT_ID = 'cid';
    process.env.TWITTER_CLIENT_SECRET = 'csecret';
    strategy = new TwitterStrategy();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('configures PKCE, state, scopes and Basic client auth', () => {
    const options = twitterStrategyOptions();
    expect(options).toMatchObject({
      authorizationURL: 'https://x.com/i/oauth2/authorize',
      tokenURL: 'https://api.x.com/2/oauth2/token',
      pkce: true,
      state: true,
      clientID: 'cid',
      clientSecret: 'csecret',
    });
    expect(options.scope).toEqual(expect.arrayContaining(['users.read', 'tweet.read', 'users.email']));
    expect(options.customHeaders).toEqual({
      Authorization: `Basic ${Buffer.from('cid:csecret').toString('base64')}`,
    });
  });

  it('maps /2/users/me to an XProfile using confirmed_email', async () => {
    const fetchMock = mockFetchOnce(200, {
      data: { id: '42', name: 'Asha', username: 'asha', confirmed_email: 'A@X.com' },
    });

    const { error, profile } = await loadProfile(strategy);

    expect(error).toBeFalsy();
    expect(profile).toEqual({ id: '42', name: 'Asha', email: 'A@X.com' });
    expect(fetchMock).toHaveBeenCalledWith(
      ME_URL,
      expect.objectContaining({ headers: { Authorization: 'Bearer tok-1' } }),
    );
  });

  it('returns an empty email when X has no confirmed_email', async () => {
    mockFetchOnce(200, { data: { id: '42', name: 'Asha', username: 'asha' } });
    const { profile } = await loadProfile(strategy);
    expect(profile?.email).toBe('');
  });

  it('falls back to username when name is missing', async () => {
    mockFetchOnce(200, { data: { id: '42', username: 'asha' } });
    const { profile } = await loadProfile(strategy);
    expect(profile?.name).toBe('asha');
  });

  it('passes an Error to the callback on a non-200 response', async () => {
    mockFetchOnce(402, { title: 'CreditsDepleted' });
    const { error, profile } = await loadProfile(strategy);
    expect(error).toBeInstanceOf(Error);
    expect(profile).toBeUndefined();
  });

  it('passes an Error to the callback when fetch rejects', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    const { error } = await loadProfile(strategy);
    expect(error).toBeInstanceOf(Error);
  });

  it('validate maps XProfile to OAuthProfile', () => {
    expect(strategy.validate('a', 'r', { id: '42', name: 'Asha', email: 'A@X.com' })).toEqual({
      provider: 'twitter',
      providerId: '42',
      email: 'A@X.com',
      name: 'Asha',
    });
  });
});
