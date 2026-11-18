// Absolute URL of an API path, for showing to users (e.g. the Meta webhook URL to paste into the
// Facebook app). Built from the API base URL, not the page origin: the web app, the API and the
// Android WebView (https://localhost) are all different hosts.
export const apiUrl = (path: string): string =>
  new URL(`${(import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api/v1"}${path}`, window.location.origin).href;
