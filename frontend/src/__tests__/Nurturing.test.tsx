import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import NurturingPage from "../pages/Nurturing";
import * as client from "../api/client";
import type { NurturingSequence, NurturingEnrollment, Lead } from "../types";

vi.mock("../api/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Rep", role: "SALES_REP" }, signOut: vi.fn() }),
}));
vi.mock("../context/NotificationsContext", () => ({
  useNotifications: () => ({ count: 0, leads: [], markSeen: vi.fn(), clear: vi.fn(), newLeadVersion: 0 }),
}));

const baseSequence: NurturingSequence = {
  id: "seq-1",
  name: "MBA Welcome Sequence",
  description: "Welcome new MBA leads",
  triggerEvent: "manual",
  isActive: true,
  steps: [],
  _count: { steps: 0, enrollments: 1 },
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const existingEnrollment: NurturingEnrollment = {
  id: "enr-1",
  sequenceId: "seq-1",
  leadId: "lead-1",
  lead: { id: "lead-1", name: "Existing Lead", email: "e@t.com", stage: "NEW" },
  status: "active",
  currentStep: 0,
  enrolledAt: "2026-08-01T00:00:00.000Z",
};

const newLead: Lead = {
  id: "lead-2",
  name: "New Lead",
  phone: "+919876500000",
  email: "new@t.com",
  source: "INSTAGRAM",
  stage: "NEW",
  score: 10,
  interestedCount: 0,
  tags: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
} as Lead;

describe("NurturingPage — SequenceDetail enrollment refresh (SCRUM-42)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getSequences).mockResolvedValue([baseSequence]);
    vi.mocked(client.getSequence).mockImplementation(async () => baseSequence);
    vi.mocked(client.getSequenceEnrollments).mockImplementation(async () => ({
      data: [existingEnrollment],
      total: 1,
      page: 1,
      limit: 20,
      pages: 1,
    }));
    vi.mocked(client.getLeads).mockResolvedValue({
      data: [newLead],
      total: 1,
      page: 1,
      limit: 50,
      pages: 1,
    });
  });

  // Regression test: enrolling a lead from the detail view's "Enroll Lead" dialog updated
  // the Sequence List page correctly but left the Detail View's enrolled-leads list and
  // count stale until some other trigger (e.g. navigating away and back) refreshed it.
  // Root cause: EnrollDialog's onEnrolled callback only refetched the sequence (for the
  // _count tile) but never called loadEnrollments(), so the enrolled-leads list itself
  // never updated.
  it("refreshes the enrolled-leads list and count immediately after enrolling a lead", async () => {
    const updatedSequence: NurturingSequence = {
      ...baseSequence,
      _count: { steps: 0, enrollments: 2 },
    };
    const newEnrollment: NurturingEnrollment = {
      id: "enr-2",
      sequenceId: "seq-1",
      leadId: "lead-2",
      lead: { id: "lead-2", name: "New Lead", email: "new@t.com", stage: "NEW" },
      status: "active",
      currentStep: 0,
      enrolledAt: "2026-09-05T00:00:00.000Z",
    };
    const updatedEnrollments: NurturingEnrollment[] = [existingEnrollment, newEnrollment];

    vi.mocked(client.enrollLead).mockImplementation(async () => {
      // After enrollment succeeds, subsequent fetches should reflect the new state.
      vi.mocked(client.getSequence).mockResolvedValue(updatedSequence);
      vi.mocked(client.getSequenceEnrollments).mockResolvedValue({
        data: updatedEnrollments,
        total: 2,
        page: 1,
        limit: 20,
        pages: 1,
      });
      return newEnrollment;
    });

    render(
      <MemoryRouter>
        <NurturingPage />
      </MemoryRouter>,
    );

    // List view -> open the sequence detail.
    await waitFor(() =>
      expect(screen.getByText("MBA Welcome Sequence")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("MBA Welcome Sequence"));

    await waitFor(() =>
      expect(screen.getByText("Existing Lead")).toBeInTheDocument(),
    );

    // Open the enroll dialog and enroll the new lead.
    fireEvent.click(screen.getByText("Enroll Lead"));
    await waitFor(() => expect(screen.getByText("New Lead")).toBeInTheDocument());
    fireEvent.click(screen.getByText("New Lead"));
    fireEvent.click(screen.getByRole("button", { name: "Enroll" }));

    // The detail view's enrolled-leads list must show the newly enrolled lead without
    // any further trigger, and the enrolled count must bump from 1 to 2.
    await waitFor(() =>
      expect(client.getSequenceEnrollments).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(screen.getAllByText("New Lead").length).toBeGreaterThan(0),
    );
    // The enrolled tile + the "Enrolled Leads" panel badge both derive from the same
    // refreshed count (2), and the subtitle spells it out too — confirms the count updated
    // everywhere, not just in the list.
    expect(screen.getByText("0 steps · 2 enrolled")).toBeInTheDocument();
  });
});
