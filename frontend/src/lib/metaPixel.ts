// Fires Meta Pixel conversion events. The base pixel snippet (init + PageView)
// lives in index.html, substituted from VITE_FACEBOOK_PIXEL_ID at build time —
// it's a no-op (fbq undefined) for local dev, where that env var isn't set.

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export const trackCompleteRegistration = (): void => {
  window.fbq?.("track", "CompleteRegistration");
};
