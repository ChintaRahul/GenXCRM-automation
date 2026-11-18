import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import NewRegistrationPage from "../pages/RegisterNew";
import * as client from "../api/client";
import * as authCtx from "../context/AuthContext";
import type { Lead, User } from "../types";

vi.mock("../api/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

const mockUser: User = {
  id: "rep-1",
  name: "Rep One",
  email: "rep@t.com",
  role: "SALES_REP",
  teamId: "team-1",
};

const mockLead: Lead = {
  id: "lead-1",
  name: "Sneha Patel",
  phone: "+919876543210",
  source: "INSTAGRAM",
  stage: "INTERESTED",
  score: 84,
  interestedCount: 1,
  tags: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  activities: [],
  communications: [],
  payments: [],
  callRecordings: [],
};

describe("NewRegistrationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getCourses).mockResolvedValue([]);
    vi.mocked(client.getLeads).mockResolvedValue({ data: [], total: 0 } as never);
    vi.mocked(client.getConnectedPaymentGateways).mockResolvedValue([]);
    vi.mocked(client.getGoogleForms).mockResolvedValue([]);
    vi.mocked(client.getFormSubmissions).mockResolvedValue([]);
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: mockUser,
      token: "tok",
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    });
  });

  it("preselects the lead and opens on the Courses step when ?leadId= is present", async () => {
    vi.mocked(client.getLead).mockResolvedValue(mockLead);

    render(
      <MemoryRouter initialEntries={["/register/new?leadId=lead-1"]}>
        <Routes>
          <Route path="/register/new" element={<NewRegistrationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(client.getLead).toHaveBeenCalledWith("lead-1");
    await waitFor(() =>
      expect(screen.getByText("Courses enrolled")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Sneha Patel/)).toBeInTheDocument();
  });

  it("falls back to the Lead step when the preselected lead fails to load", async () => {
    vi.mocked(client.getLead).mockRejectedValue(new Error("not found"));

    render(
      <MemoryRouter initialEntries={["/register/new?leadId=bad-id"]}>
        <Routes>
          <Route path="/register/new" element={<NewRegistrationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Who's enrolling?")).toBeInTheDocument());
  });

  it("still opens on the Lead step with no leadId in the URL", () => {
    render(
      <MemoryRouter initialEntries={["/register/new"]}>
        <Routes>
          <Route path="/register/new" element={<NewRegistrationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(client.getLead).not.toHaveBeenCalled();
    expect(screen.getByText("Who's enrolling?")).toBeInTheDocument();
  });
});
