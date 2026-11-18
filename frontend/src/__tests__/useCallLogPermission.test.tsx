import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCallLogPermission } from "../hooks/useCallLogPermission";

const isNativeMock = vi.fn();
vi.mock("../lib/platform", () => ({ isNative: () => isNativeMock() }));

const getStatusMock = vi.fn();
const requestPermissionMock = vi.fn();
vi.mock("../lib/callLogPlugin", () => ({
  GenXCallLog: {
    getStatus: (...args: unknown[]) => getStatusMock(...args),
    requestPermission: (...args: unknown[]) => requestPermissionMock(...args),
  },
}));

describe("useCallLogPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isNativeMock.mockReturnValue(true);
  });

  it("reports unsupported on web without calling the plugin", () => {
    isNativeMock.mockReturnValue(false);
    const { result } = renderHook(() => useCallLogPermission());
    expect(result.current.supported).toBe(false);
    expect(getStatusMock).not.toHaveBeenCalled();
  });

  it("loads the granted status on mount", async () => {
    getStatusMock.mockResolvedValue({ granted: true });
    const { result } = renderHook(() => useCallLogPermission());
    await waitFor(() => expect(result.current.granted).toBe(true));
  });

  it("requests permission and updates granted state", async () => {
    getStatusMock.mockResolvedValue({ granted: false });
    requestPermissionMock.mockResolvedValue({ granted: true });
    const { result } = renderHook(() => useCallLogPermission());
    await waitFor(() => expect(result.current.granted).toBe(false));

    await act(() => result.current.requestPermission());

    await waitFor(() => expect(result.current.granted).toBe(true));
    expect(requestPermissionMock).toHaveBeenCalled();
  });
});
