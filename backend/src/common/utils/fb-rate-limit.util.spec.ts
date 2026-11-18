import { isFacebookRateLimitError } from './fb-rate-limit.util';

const axiosError = (response?: { status?: number; data?: unknown }) =>
  Object.assign(new Error('request failed'), { isAxiosError: true, response });

describe('isFacebookRateLimitError', () => {
  it.each([4, 17, 32, 80004])('detects numeric rate-limit code %i', (code) => {
    expect(isFacebookRateLimitError(axiosError({ status: 400, data: { error: { code } } }))).toBe(true);
  });

  it('detects HTTP 429 even when the body has no error object', () => {
    expect(isFacebookRateLimitError(axiosError({ status: 429, data: {} }))).toBe(true);
  });

  it('detects TooManyRequestsException with no code (2026-11-16 alert shape)', () => {
    const err = axiosError({
      status: 400,
      data: { error: { type: 'TooManyRequestsException', message: 'An error has occurred. No further information is available.' } },
    });
    expect(isFacebookRateLimitError(err)).toBe(true);
  });

  it('ignores unrelated Graph errors, e.g. an invalid token (190)', () => {
    expect(isFacebookRateLimitError(axiosError({ status: 400, data: { error: { code: 190 } } }))).toBe(false);
  });

  it('ignores axios errors with no response (network failure)', () => {
    expect(isFacebookRateLimitError(axiosError())).toBe(false);
  });

  it('ignores non-axios errors', () => {
    expect(isFacebookRateLimitError(new Error('boom'))).toBe(false);
  });
});
