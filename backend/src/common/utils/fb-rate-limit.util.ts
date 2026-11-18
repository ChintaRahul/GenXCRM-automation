import axios from 'axios';

// FB error codes that mean "back off and retry shortly" rather than "fail now".
// 80004 is the ad-account-level Marketing API limit; 4/17/32 are app/user/page limits.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 80004]);

interface GraphErrorBody {
  error?: { code?: number; type?: string };
}

/**
 * True when a Graph API call failed because Meta throttled us. Besides the numeric codes in the
 * standard `{error: {code}}` body, Meta's edge sometimes throttles with HTTP 429 and a body that
 * has no code at all (`type: 'TooManyRequestsException'`) — keying on the code alone missed that
 * and permanently dropped the lead (2026-11-16 Pooinfotech alert).
 */
export const isFacebookRateLimitError = (err: unknown): boolean => {
  if (!axios.isAxiosError(err)) return false;
  const { status, data } = err.response ?? {};
  const fbError = (data as GraphErrorBody | undefined)?.error;
  if (status === 429) return true;
  if (fbError?.type === 'TooManyRequestsException') return true;
  return fbError?.code !== undefined && RATE_LIMIT_CODES.has(fbError.code);
};
