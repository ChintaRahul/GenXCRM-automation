import { describe, it, expect, vi, beforeEach } from "vitest";

const setStyle = vi.fn();
const isNativePlatform = vi.fn();

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => isNativePlatform() } }));
vi.mock("@capacitor/status-bar", () => ({
  StatusBar: { setStyle: (arg: unknown) => setStyle(arg) },
  Style: { Dark: "DARK", Light: "LIGHT" },
}));
vi.mock("@capacitor/browser", () => ({ Browser: {} }));
vi.mock("@capacitor/filesystem", () => ({ Filesystem: {}, Directory: {} }));
vi.mock("@capacitor/share", () => ({ Share: {} }));

import { syncStatusBar } from "../lib/platform";

describe("syncStatusBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStyle.mockResolvedValue(undefined);
  });

  it("uses light icons on the dark theme and dark icons on the light theme", async () => {
    isNativePlatform.mockReturnValue(true);
    await syncStatusBar("dark");
    expect(setStyle).toHaveBeenLastCalledWith({ style: "DARK" });
    await syncStatusBar("light");
    expect(setStyle).toHaveBeenLastCalledWith({ style: "LIGHT" });
  });

  it("does nothing on the web", async () => {
    isNativePlatform.mockReturnValue(false);
    await syncStatusBar("light");
    expect(setStyle).not.toHaveBeenCalled();
  });

  it("swallows a plugin failure", async () => {
    isNativePlatform.mockReturnValue(true);
    setStyle.mockRejectedValue(new Error("not implemented"));
    await expect(syncStatusBar("dark")).resolves.toBeUndefined();
  });
});
