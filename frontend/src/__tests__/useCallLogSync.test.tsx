import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCallLogSync } from "../hooks/useCallLogSync";
import * as client from "../api/client";
import type { User } from "../types";

let resumeListener: (() => void) | undefined;
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn((_event: string, cb: () => void) => {
      resumeListener = cb;
      return Promise.resolve({ remove: vi.fn() });
    }),
  },
}));

const isNativeMock = vi.fn();
vi.mock("../lib/platform", () => ({ isNative: () => isNativeMock() }));

const getStatusMock = vi.fn();
const syncLeadsMock = vi.fn().mockResolvedValue(undefined);
const syncNowMock = vi.fn().mockResolvedValue(undefined);
const getPendingCallsMock = vi.fn();
const ackCallMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/callLogPlugin", () => ({
  GenXCallLog: {
    getStatus: (...args: unknown[]) => getStatusMock(...args),
    syncLeads: (...args: unknown[]) => syncLeadsMock(...args),
    syncNow: (...args: unknown[]) => syncNowMock(...args),
    getPendingCalls: (...args: unknown[]) => getPendingCallsMock(...args),
    ackCall: (...args: unknown[]) => ackCallMock(...args),
  },
}));

vi.mock("../api/client");

const user: User = { id: "u1", name: "Rep", email: "rep@co.com", role: "SALES_REP", teamId: null };
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user }) }));

describe("useCallLogSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resumeListener = undefined;
    isNativeMock.mockReturnValue(true);
  });

  it("does nothing on web", () => {
    isNativeMock.mockReturnValue(false);
    renderHook(() => useCallLogSync());
    expect(getStatusMock).not.toHaveBeenCalled();
  });

  it("pushes the lead phone index and drains pending calls when permission is granted", async () => {
    vi.mocked(client.getLeadPhoneIndex).mockResolvedValue([{ leadId: "lead-1", name: "Asha", phone: "9876543210" }]);
    getStatusMock.mockResolvedValue({ granted: true });
    getPendingCallsMock.mockResolvedValue({
      calls: [
        {
          id: "call-1",
          leadId: "lead-1",
          number: "9876543210",
          startedAt: 1,
          durationSec: 42,
          direction: "outbound",
          outcome: "CONNECTED",
        },
      ],
    });
    vi.mocked(client.logCall).mockResolvedValue(undefined);

    renderHook(() => useCallLogSync());

    await waitFor(() =>
      expect(syncLeadsMock).toHaveBeenCalledWith({
        leads: [{ leadId: "lead-1", name: "Asha", phone: "9876543210" }],
      }),
    );
    // The immediate scan runs before the pending queue is drained, so a call made just before
    // returning to the app is picked up in the same pass rather than waiting for the next
    // periodic background scan.
    await waitFor(() => expect(syncNowMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(client.logCall).toHaveBeenCalledWith({
        leadId: "lead-1",
        durationSec: 42,
        notes: "",
        outcome: "CONNECTED",
        direction: "outbound",
      }),
    );
    await waitFor(() => expect(ackCallMock).toHaveBeenCalledWith({ id: "call-1" }));
  });

  it("still drains the pending queue when the immediate scan itself fails", async () => {
    vi.mocked(client.getLeadPhoneIndex).mockResolvedValue([]);
    getStatusMock.mockResolvedValue({ granted: true });
    syncNowMock.mockRejectedValueOnce(new Error("native scan failed"));
    getPendingCallsMock.mockResolvedValue({ calls: [] });

    renderHook(() => useCallLogSync());

    await waitFor(() => expect(syncNowMock).toHaveBeenCalled());
    await waitFor(() => expect(getPendingCallsMock).toHaveBeenCalled());
  });

  it("leaves a call queued (does not ack) when logCall fails", async () => {
    vi.mocked(client.getLeadPhoneIndex).mockResolvedValue([]);
    getStatusMock.mockResolvedValue({ granted: true });
    getPendingCallsMock.mockResolvedValue({
      calls: [
        {
          id: "call-1",
          leadId: "lead-1",
          number: "9876543210",
          startedAt: 1,
          durationSec: 0,
          direction: "inbound",
          outcome: "NOT_CONNECTED",
        },
      ],
    });
    vi.mocked(client.logCall).mockRejectedValue(new Error("network error"));

    renderHook(() => useCallLogSync());

    await waitFor(() => expect(client.logCall).toHaveBeenCalled());
    expect(ackCallMock).not.toHaveBeenCalled();
  });

  it("skips draining when permission is not granted", async () => {
    vi.mocked(client.getLeadPhoneIndex).mockResolvedValue([]);
    getStatusMock.mockResolvedValue({ granted: false });

    renderHook(() => useCallLogSync());

    await waitFor(() => expect(getStatusMock).toHaveBeenCalled());
    expect(syncNowMock).not.toHaveBeenCalled();
    expect(getPendingCallsMock).not.toHaveBeenCalled();
  });

  it("re-drains on app resume", async () => {
    vi.mocked(client.getLeadPhoneIndex).mockResolvedValue([]);
    getStatusMock.mockResolvedValue({ granted: true });
    getPendingCallsMock.mockResolvedValue({ calls: [] });

    renderHook(() => useCallLogSync());
    await waitFor(() => expect(getPendingCallsMock).toHaveBeenCalledTimes(1));

    resumeListener?.();
    await waitFor(() => expect(getPendingCallsMock).toHaveBeenCalledTimes(2));
  });
});
