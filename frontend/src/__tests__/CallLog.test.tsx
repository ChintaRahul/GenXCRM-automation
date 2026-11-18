import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import CallLogPage from "../pages/CallLog";
import { useCallLog } from "../hooks/useCallLog";
import type { CallLogEntry } from "../types";

vi.mock("../hooks/useCallLog", () => ({
  useCallLog: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Rep", role: "SALES_REP" }, signOut: vi.fn() }),
}));
vi.mock("../context/NotificationsContext", () => ({
  useNotifications: () => ({ count: 0, leads: [], markSeen: vi.fn(), clear: vi.fn(), newLeadVersion: 0 }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const recordedCall: CallLogEntry = {
  id: "comm-1",
  direction: "outbound",
  status: "completed",
  durationSec: 184,
  callOutcome: "CONNECTED",
  sentAt: "2026-08-11T00:00:00.000Z",
  lead: { id: "lead-1", name: "Rohan Mehta", phone: "+919123456780" },
  callRecording: { id: "rec-1", status: "UPLOADED" },
};

const missedCall: CallLogEntry = {
  id: "comm-2",
  direction: "outbound",
  status: "completed",
  durationSec: 0,
  callOutcome: "NOT_CONNECTED",
  sentAt: "2026-08-11T00:00:00.000Z",
  lead: { id: "lead-2", name: "Priya Nair", phone: "+919000011122" },
  callRecording: null,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <CallLogPage />
    </MemoryRouter>,
  );
}

describe("CallLogPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state when there are no calls", () => {
    vi.mocked(useCallLog).mockReturnValue({
      calls: [], total: 0, loading: false, error: null, refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(/no calls/i)).toBeInTheDocument();
  });

  it("renders a row per call with name and duration", () => {
    vi.mocked(useCallLog).mockReturnValue({
      calls: [recordedCall, missedCall], total: 2, loading: false, error: null, refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("Rohan Mehta")).toBeInTheDocument();
    expect(screen.getByText("3:04")).toBeInTheDocument();
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
    expect(screen.getByText(/not answered/i)).toBeInTheDocument();
  });

  it("navigates to the lead on clicking a recorded row", async () => {
    const user = userEvent.setup();
    vi.mocked(useCallLog).mockReturnValue({
      calls: [recordedCall], total: 1, loading: false, error: null, refetch: vi.fn(),
    });
    renderPage();
    await user.click(screen.getByText("Rohan Mehta"));
    expect(mockNavigate).toHaveBeenCalledWith("/leads/lead-1");
  });

  it("does not navigate when clicking a non-recorded row", async () => {
    const user = userEvent.setup();
    vi.mocked(useCallLog).mockReturnValue({
      calls: [missedCall], total: 1, loading: false, error: null, refetch: vi.fn(),
    });
    renderPage();
    await user.click(screen.getByText("Priya Nair"));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
