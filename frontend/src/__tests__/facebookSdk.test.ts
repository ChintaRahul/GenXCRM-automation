import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// loadFacebookSdk keeps a module-level in-flight-promise singleton, so each test
// resets the module registry and re-imports fresh — otherwise state leaks between
// tests (e.g. a resolved promise from a prior test short-circuiting a later one).
describe("loadFacebookSdk", () => {
  beforeEach(() => {
    vi.resetModules();
    document.querySelectorAll("script").forEach((s) => s.remove());
    delete (window as { FB?: unknown }).FB;
    delete (window as { fbAsyncInit?: unknown }).fbAsyncInit;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appends the Facebook SDK script and resolves once fbAsyncInit fires, calling FB.init", async () => {
    const { loadFacebookSdk } = await import("../lib/facebookSdk");
    const appendSpy = vi.spyOn(document.body, "appendChild");
    const promise = loadFacebookSdk("app-123");

    // The real SDK script would call window.fbAsyncInit itself once loaded; simulate that.
    const initMock = vi.fn();
    (window as unknown as { FB: { init: typeof initMock } }).FB = { init: initMock } as never;
    window.fbAsyncInit?.();

    await promise;

    expect(appendSpy).toHaveBeenCalledTimes(1);
    const script = appendSpy.mock.calls[0][0] as HTMLScriptElement;
    expect(script.src).toBe("https://connect.facebook.net/en_US/sdk.js");
    expect(initMock).toHaveBeenCalledWith({ appId: "app-123", version: "v25.0", xfbml: false });
  });

  it("resolves immediately without appending a script when window.FB already exists", async () => {
    const { loadFacebookSdk } = await import("../lib/facebookSdk");
    (window as unknown as { FB: unknown }).FB = { init: vi.fn() };
    const appendSpy = vi.spyOn(document.body, "appendChild");

    await loadFacebookSdk("app-123");

    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("reuses the same in-flight promise on a second call before the first resolves", async () => {
    const { loadFacebookSdk } = await import("../lib/facebookSdk");
    const appendSpy = vi.spyOn(document.body, "appendChild");
    void loadFacebookSdk("app-123");
    void loadFacebookSdk("app-123");

    expect(appendSpy).toHaveBeenCalledTimes(1);
  });
});
