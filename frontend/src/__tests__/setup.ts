import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Owner/reference cells resolve ids to names over the network (lib/lookupNames). Tests stay
// offline and keep asserting on the raw id; lookupNames.test.tsx exercises the real module.
vi.mock('../lib/lookupNames', () => ({
  LookupName: ({ id }: { id: unknown }) => (typeof id === 'string' && id ? id : '—'),
  useLookupName: (_source: string | undefined, id: unknown) => (typeof id === 'string' && id ? id : '—'),
  useLookupOptions: () => ({ options: [], loading: false }),
  resetLookupNames: () => {},
  invalidateLookup: () => {},
}));

// jsdom has no ResizeObserver; Radix Slider (and other size-aware primitives)
// need one to mount without crashing in tests.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom doesn't implement these either; Radix Select's pointer-driven open/select
// interactions call them, and they'd otherwise throw "not a function" in tests.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom doesn't implement matchMedia; used to pick the mobile vs. desktop
// scroll container on the Leads page (SCRUM-62).
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
}
