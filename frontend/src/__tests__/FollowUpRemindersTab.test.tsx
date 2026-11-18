import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FollowUpRemindersTab } from "../components/admin/FollowUpRemindersTab";
import type { NotificationSettings } from "../types";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const toggle = { email: false, inApp: false };
const defaults = {
  enabled: false,
  sendHour: 9,
  reps: true,
  managers: true,
  overdue: true,
  today: true,
  email: true,
  inApp: true,
  skipSundays: true,
};
const make = (over: Partial<typeof defaults> = {}): NotificationSettings => ({
  newLeadAssigned: toggle,
  dailyDigest: toggle,
  paymentReceived: toggle,
  leadIngestionFailures: toggle,
  trialEndingReminders: toggle,
  weeklyPerformanceSummary: toggle,
  followUpReminders: { ...defaults, ...over },
});

describe("FollowUpRemindersTab", () => {
  it("is off by default and locks the options", () => {
    render(<FollowUpRemindersTab notifications={make()} canEdit onSave={vi.fn()} />);
    expect(screen.getByRole("switch", { name: /daily follow-up reminders/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /overdue/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("unlocks the options when switched on and saves the whole setting", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<FollowUpRemindersTab notifications={make()} canEdit onSave={onSave} />);
    fireEvent.click(screen.getByRole("switch", { name: /daily follow-up reminders/i }));
    const email = screen.getByRole("checkbox", { name: /^email$/i });
    expect(email).toBeEnabled();
    fireEvent.click(email);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ followUpReminders: expect.objectContaining({ enabled: true, email: false, sendHour: 9 }) }),
      ),
    );
  });

  it("cannot be changed without edit rights", () => {
    render(<FollowUpRemindersTab notifications={make({ enabled: true })} canEdit={false} onSave={vi.fn()} />);
    expect(screen.getByRole("switch", { name: /daily follow-up reminders/i })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /due today/i })).toBeDisabled();
  });
});
