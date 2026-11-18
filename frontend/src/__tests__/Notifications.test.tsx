import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import NotificationsPage from "../pages/Notifications";
import { useNotifications } from "../context/NotificationsContext";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Rep", role: "SALES_REP" }, signOut: vi.fn() }),
}));
vi.mock("../context/NotificationsContext", () => ({
  useNotifications: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const lead = (id: string, name: string) => ({
  id,
  name,
  source: "FACEBOOK",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
});

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationsPage />
    </MemoryRouter>,
  );
}

describe("NotificationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the empty state when there are no new leads", () => {
    vi.mocked(useNotifications).mockReturnValue({
      count: 0,
      leads: [],
      markSeen: vi.fn(),
      clear: vi.fn(),
      newLeadVersion: 0,
    });
    renderPage();
    expect(screen.getByText("No new leads.")).toBeInTheDocument();
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
  });

  it("renders a row per lead and navigates to its detail page on click", () => {
    vi.mocked(useNotifications).mockReturnValue({
      count: 1,
      leads: [lead("l1", "Ananya Sharma")],
      markSeen: vi.fn(),
      clear: vi.fn(),
      newLeadVersion: 0,
    });
    renderPage();
    fireEvent.click(screen.getByText("New lead: Ananya Sharma"));
    expect(mockNavigate).toHaveBeenCalledWith("/leads/l1");
  });

  it("calls clear() when the Clear link is clicked", () => {
    const clear = vi.fn();
    vi.mocked(useNotifications).mockReturnValue({
      count: 1,
      leads: [lead("l1", "Ananya Sharma")],
      markSeen: vi.fn(),
      clear,
      newLeadVersion: 0,
    });
    renderPage();
    fireEvent.click(screen.getByText("Clear"));
    expect(clear).toHaveBeenCalled();
  });
});
