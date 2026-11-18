import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useApiKey } from "../hooks/useApiKey";
import * as client from "../api/client";

vi.mock("../api/client");

describe("useApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the key on mount", async () => {
    vi.mocked(client.getApiKey).mockResolvedValue({ apiKey: "gxc_live_abc123" });
    const { result } = renderHook(() => useApiKey());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.apiKey).toBe("gxc_live_abc123");
  });

  it("sets an error when the load fails", async () => {
    vi.mocked(client.getApiKey).mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useApiKey());
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it("does not fetch the key for a viewer who cannot read it", async () => {
    const { result } = renderHook(() => useApiKey(false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(client.getApiKey).not.toHaveBeenCalled();
    expect(result.current.apiKey).toBeNull();
  });

  it("regenerate replaces the key", async () => {
    vi.mocked(client.getApiKey).mockResolvedValue({ apiKey: "gxc_live_old" });
    vi.mocked(client.regenerateApiKey).mockResolvedValue({ apiKey: "gxc_live_new" });
    const { result } = renderHook(() => useApiKey());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.regenerate();
    });
    expect(result.current.apiKey).toBe("gxc_live_new");
  });
});
