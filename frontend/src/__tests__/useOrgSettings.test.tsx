import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useOrgSettings } from "../hooks/useOrgSettings";
import * as client from "../api/client";

vi.mock("../api/client");

const profile = {
  id: "org-1",
  name: "Acme",
  slug: "acme",
  industry: "EDTECH",
  size: "SMALL",
  country: "India",
  timezone: "Asia/Kolkata",
  planStatus: "TRIAL",
  trialEndsAt: "2026-10-01",
} as const;

const settings = {
  security: {
    passwordMinLength: 8,
    sessionTimeoutMinutes: 60,
    requireNumber: true,
    requireSymbol: false,
    mfaEnabled: false,
    mfaEnforced: false,
    ssoProvider: "NONE",
    ssoConnected: false,
  },
  notifications: {
    newLeadAssigned: { email: true, inApp: true },
    dailyDigest: { email: true, inApp: false },
    paymentReceived: { email: true, inApp: true },
    trialEndingReminders: { email: true, inApp: false },
    weeklyPerformanceSummary: { email: false, inApp: false },
    followUpReminders: { enabled: false, sendHour: 9, reps: true, managers: true, overdue: true, today: true, email: true, inApp: true, skipSundays: true },
  },
  routing: {
    autoAssign: true,
    skipWeekends: false,
    alwaysOn: false,
    workingHoursStart: "09:00",
    workingHoursEnd: "18:00",
    sourceRouting: { facebookInstagram: "", googleAds: "", website: "", referral: "", walkIn: "" },
  },
  payments: {
    emiReminderTemplateId: null,
    emiReminderEmailTemplateId: null,
  },
} as const;

describe("useOrgSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads profile and settings on mount", async () => {
    vi.mocked(client.getOrgProfile).mockResolvedValue(profile as never);
    vi.mocked(client.getOrgSettings).mockResolvedValue(settings as never);
    const { result } = renderHook(() => useOrgSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile?.name).toBe("Acme");
    expect(result.current.settings?.security.passwordMinLength).toBe(8);
    expect(result.current.error).toBeNull();
  });

  it("sets an error when the initial load fails", async () => {
    vi.mocked(client.getOrgProfile).mockRejectedValue(new Error("network"));
    vi.mocked(client.getOrgSettings).mockResolvedValue(settings as never);
    const { result } = renderHook(() => useOrgSettings());
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it("saveSecurity PATCHes and updates local state", async () => {
    vi.mocked(client.getOrgProfile).mockResolvedValue(profile as never);
    vi.mocked(client.getOrgSettings).mockResolvedValue(settings as never);
    const updated = { ...settings, security: { ...settings.security, passwordMinLength: 12 } };
    vi.mocked(client.updateOrgSettings).mockResolvedValue(updated as never);
    const { result } = renderHook(() => useOrgSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await result.current.saveSecurity(updated.security as never);
    expect(client.updateOrgSettings).toHaveBeenCalledWith({ security: updated.security });
    await waitFor(() => expect(result.current.settings?.security.passwordMinLength).toBe(12));
  });

  it("savePayments PATCHes and updates local state", async () => {
    vi.mocked(client.getOrgProfile).mockResolvedValue(profile as never);
    vi.mocked(client.getOrgSettings).mockResolvedValue(settings as never);
    const updated = { ...settings, payments: { emiReminderTemplateId: "tpl-1", emiReminderEmailTemplateId: "tpl-2" } };
    vi.mocked(client.updateOrgSettings).mockResolvedValue(updated as never);
    const { result } = renderHook(() => useOrgSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await result.current.savePayments(updated.payments as never);
    expect(client.updateOrgSettings).toHaveBeenCalledWith({ payments: updated.payments });
    await waitFor(() => expect(result.current.settings?.payments.emiReminderTemplateId).toBe("tpl-1"));
  });
});
