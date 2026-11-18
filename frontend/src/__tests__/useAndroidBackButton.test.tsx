import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useAndroidBackButton } from "../hooks/useAndroidBackButton";

let backListener: ((data: { canGoBack: boolean }) => void) | undefined;
const minimizeApp = vi.fn().mockResolvedValue(undefined);
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn((_event: string, cb: (data: { canGoBack: boolean }) => void) => {
      backListener = cb;
      return Promise.resolve({ remove: vi.fn() });
    }),
    minimizeApp: () => minimizeApp(),
  },
}));
vi.mock("../lib/platform", () => ({ isNative: () => true }));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const wrapper = (path: string) => ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
);

describe("useAndroidBackButton", () => {
  beforeEach(() => {
    backListener = undefined;
    vi.clearAllMocks();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("closes an open dialog (Escape) instead of navigating", () => {
    document.body.innerHTML = '<div role="dialog"></div>';
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 10, right: 300, width: 290 } as DOMRect);
    const onKey = vi.fn();
    document.addEventListener("keydown", onKey);
    renderHook(() => useAndroidBackButton(), { wrapper: wrapper("/leads") });
    backListener?.({ canGoBack: true });
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(onKey.mock.calls[0][0].key).toBe("Escape");
    expect(mockNavigate).not.toHaveBeenCalled();
    document.removeEventListener("keydown", onKey);
    vi.restoreAllMocks();
  });

  it("ignores a closed drawer that is mounted but slid off-screen", () => {
    document.body.innerHTML = '<aside role="dialog"></aside>';
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: -232, right: 0, width: 232 } as DOMRect);
    renderHook(() => useAndroidBackButton(), { wrapper: wrapper("/leads") });
    backListener?.({ canGoBack: true });
    expect(mockNavigate).toHaveBeenCalledWith(-1);
    vi.restoreAllMocks();
  });

  it("goes back a page when there is history", () => {
    renderHook(() => useAndroidBackButton(), { wrapper: wrapper("/leads") });
    backListener?.({ canGoBack: true });
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it("falls back to the dashboard when a deep page has no history", () => {
    renderHook(() => useAndroidBackButton(), { wrapper: wrapper("/leads/abc") });
    backListener?.({ canGoBack: false });
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("minimizes the app from the dashboard", () => {
    renderHook(() => useAndroidBackButton(), { wrapper: wrapper("/") });
    backListener?.({ canGoBack: false });
    expect(minimizeApp).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
