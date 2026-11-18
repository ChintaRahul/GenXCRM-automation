export const CASHFREE_API_VERSION = '2023-08-01';

// Cashfree issues separate sandbox and production credentials on different hosts. Test secret
// keys look like "cfsk_ma_test_..." (production: "cfsk_ma_prod_..."), and older test App IDs
// start with "TEST" — either marks the credentials as sandbox, so there is no environment
// setting for the user to get wrong.
export const cashfreeBaseUrl = (appId: string, secret: string): string =>
  appId.toUpperCase().startsWith('TEST') || secret.toLowerCase().includes('_test_')
    ? 'https://sandbox.cashfree.com/pg'
    : 'https://api.cashfree.com/pg';

export const cashfreeHeaders = (appId: string, secret: string) => ({
  'x-client-id': appId,
  'x-client-secret': secret,
  'x-api-version': CASHFREE_API_VERSION,
});

// Subscriptions (auto-debit mandates) are a separate Cashfree product with their own API version.
export const CASHFREE_SUBSCRIPTION_API_VERSION = '2026-01-01';

export const cashfreeSubscriptionHeaders = (appId: string, secret: string) => ({
  ...cashfreeHeaders(appId, secret),
  'x-api-version': CASHFREE_SUBSCRIPTION_API_VERSION,
});

// Cashfree gives a subscription *session id*, not a hosted link — the customer authorises
// through Cashfree's JS checkout. GenXCRM hosts that tiny public page (frontend
// /authorize-mandate), so the "link" sent to the customer points there.
export const cashfreeAuthorizeUrl = (frontendUrl: string, sessionId: string, sandbox: boolean): string =>
  `${frontendUrl.replace(/\/$/, '')}/authorize-mandate?s=${encodeURIComponent(sessionId)}&m=${sandbox ? 'sandbox' : 'production'}`;

export const isCashfreeSandbox = (appId: string, secret: string): boolean =>
  cashfreeBaseUrl(appId, secret).includes('sandbox');
