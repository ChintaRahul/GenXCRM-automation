import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import UsersPage from "../pages/Users";
import * as teamsHook from "../hooks/useTeams";
import * as usersHook from "../hooks/useUsers";
import * as apiClient from "../api/client";
import { toast } from "sonner";
import type { Team, User } from "../types";

vi.mock("../hooks/useTeams");
vi.mock("../hooks/useUsers");
vi.mock("../api/client");
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockDirector: User = {
  id: "u0",
  name: "Dana Director",
  email: "dana@co.com",
  role: "DIRECTOR",
  teamId: null,
  orgId: "org-1",
};

const mockManager: User = {
  id: "u1",
  name: "Alice Manager",
  email: "alice@co.com",
  role: "MANAGER",
  teamId: "t1",
  orgId: "org-1",
};

const mockRep: User = {
  id: "u2",
  name: "Bob Rep",
  email: "bob@co.com",
  role: "SALES_REP",
  teamId: "t1",
  orgId: "org-1",
};

const unassignedRep: User = {
  id: "u3",
  name: "Carol Unassigned",
  email: "carol@co.com",
  role: "SALES_REP",
  teamId: null,
  orgId: "org-1",
};

const mfaRep: User = {
  id: "u5",
  name: "Eve MfaOn",
  email: "eve@co.com",
  role: "SALES_REP",
  teamId: "t1",
  orgId: "org-1",
  mfaConfigured: true,
};

const pendingRep: User = {
  id: "u4",
  name: "Dave Pending",
  email: "dave@co.com",
  role: "SALES_REP",
  teamId: "t1",
  orgId: "org-1",
  pending: true,
};

const mockTeam: Team = {
  id: "t1",
  name: "Growth Team",
  type: "MEMBER",
  managerId: "u1",
  manager: { id: "u1", name: "Alice Manager" },
  members: [{ id: "u2", name: "Bob Rep", role: "SALES_REP" }],
  orgId: "org-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const emptyHook = { loading: false, error: null, refetch: vi.fn() };

vi.mock("../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

import * as authCtx from "../context/AuthContext";

describe("UsersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupDirector(users: User[] = [mockDirector, mockManager, mockRep]) {
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: mockDirector,
      token: 'tok',
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    });
    vi.mocked(teamsHook.useTeams).mockReturnValue({ ...emptyHook, teams: [mockTeam] });
    vi.mocked(usersHook.useUsers).mockReturnValue({ ...emptyHook, users });
  }

  function setupManager() {
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: mockManager,
      token: 'tok',
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    });
    vi.mocked(teamsHook.useTeams).mockReturnValue({
      ...emptyHook,
      teams: [mockTeam],
    });
    vi.mocked(usersHook.useUsers).mockReturnValue({
      ...emptyHook,
      users: [mockManager, mockRep],
    });
  }

  it("renders Teams and Members tabs", () => {
    setupDirector();
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /teams/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /members/i })).toBeInTheDocument();
  });

  it("shows Teams tab content by default", () => {
    setupDirector();
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    expect(screen.getByText("Growth Team")).toBeInTheDocument();
  });

  it("switches to Members tab on click", () => {
    setupDirector();
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /members/i }));
    // Member name renders in both the desktop table and the mobile card list
    expect(screen.getAllByText("Bob Rep").length).toBeGreaterThan(0);
  });

  it("Director sees New team button", () => {
    setupDirector();
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /new team/i })).toBeInTheDocument();
  });

  it("Manager sees New team button", () => {
    setupManager();
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /new team/i })).toBeInTheDocument();
  });

  it("shows unassigned-reps alert when there are unassigned reps", () => {
    setupDirector([mockDirector, mockManager, mockRep, unassignedRep]);
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    expect(screen.getByText(/not assigned to/i)).toBeInTheDocument();
  });

  it("does NOT show unassigned-reps alert when all reps are assigned", () => {
    setupDirector([mockDirector, mockManager, mockRep]);
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    expect(screen.queryByText(/not assigned to/i)).toBeNull();
  });

  it("Members tab shows search input and role filters", () => {
    setupDirector();
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /members/i }));
    expect(screen.getByPlaceholderText(/search by name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /all/i })).toBeInTheDocument();
  });

  it("Members tab filters by search", async () => {
    setupDirector();
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /members/i }));
    fireEvent.change(screen.getByPlaceholderText(/search by name/i), {
      target: { value: "Bob" },
    });
    await waitFor(() =>
      expect(screen.getAllByText("Bob Rep").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("Alice Manager")).toBeNull();
  });

  it("Manager sees only their team in Teams tab", () => {
    setupManager();
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    expect(screen.getByText("Growth Team")).toBeInTheDocument();
  });

  it("Director sees Edit and Deactivate action icons on Members tab", () => {
    setupDirector();
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /members/i }));
    const editBtns = screen.getAllByTitle("Edit member");
    expect(editBtns.length).toBeGreaterThan(0);
    const deactivateBtns = screen.getAllByTitle("Deactivate member");
    expect(deactivateBtns.length).toBeGreaterThan(0);
  });

  it("shows an Invite pending badge for a member who hasn't set a password", () => {
    setupDirector([mockDirector, mockRep, pendingRep]);
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /members/i }));
    expect(screen.getAllByText("Invite pending").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bob Rep").length).toBeGreaterThan(0);
  });

  it("Director sees a Resend invite button only for pending members", () => {
    setupDirector([mockDirector, mockRep, pendingRep]);
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /members/i }));
    expect(screen.getAllByTitle("Resend invite").length).toBeGreaterThan(0);
  });

  it("Manager sees a Resend invite button for a pending member in their team", () => {
    vi.mocked(authCtx.useAuth).mockReturnValue({
      user: mockManager,
      token: 'tok',
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
      isImpersonating: false,
      impersonate: vi.fn(),
      exitImpersonation: vi.fn(),
    });
    vi.mocked(teamsHook.useTeams).mockReturnValue({ ...emptyHook, teams: [mockTeam] });
    vi.mocked(usersHook.useUsers).mockReturnValue({ ...emptyHook, users: [mockManager, mockRep, pendingRep] });
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /members/i }));
    expect(screen.getAllByTitle("Resend invite").length).toBeGreaterThan(0);
    // Managers don't get Edit/Deactivate — those stay Director-only.
    expect(screen.queryByTitle("Edit member")).toBeNull();
  });

  it("resends the invite and shows a success toast", async () => {
    setupDirector([mockDirector, mockRep, pendingRep]);
    vi.mocked(apiClient.resendInvite).mockResolvedValue(undefined);
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /members/i }));
    fireEvent.click(screen.getAllByTitle("Resend invite")[0]);
    await waitFor(() => expect(apiClient.resendInvite).toHaveBeenCalledWith("u4"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("shows an error toast when resending the invite fails", async () => {
    setupDirector([mockDirector, mockRep, pendingRep]);
    vi.mocked(apiClient.resendInvite).mockRejectedValue(new Error("nope"));
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /members/i }));
    fireEvent.click(screen.getAllByTitle("Resend invite")[0]);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("Director sees a Reset MFA button only for members with MFA configured", () => {
    setupDirector([mockDirector, mockRep, mfaRep]);
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /members/i }));
    // Rendered once in the desktop table row and once in the mobile card for
    // the single member (mfaRep) with mfaConfigured — mockRep has none.
    expect(screen.getAllByTitle("Reset MFA")).toHaveLength(2);
  });

  it("resets a member's MFA and shows a success toast", async () => {
    setupDirector([mockDirector, mockRep, mfaRep]);
    vi.mocked(apiClient.resetUserMfa).mockResolvedValue(undefined);
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /members/i }));
    fireEvent.click(screen.getAllByTitle("Reset MFA")[0]);
    fireEvent.click(screen.getByRole("button", { name: /^reset mfa$/i }));
    await waitFor(() => expect(apiClient.resetUserMfa).toHaveBeenCalledWith("u5"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("shows an error toast when resetting MFA fails", async () => {
    setupDirector([mockDirector, mockRep, mfaRep]);
    vi.mocked(apiClient.resetUserMfa).mockRejectedValue(new Error("nope"));
    render(<MemoryRouter><UsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /members/i }));
    fireEvent.click(screen.getAllByTitle("Reset MFA")[0]);
    fireEvent.click(screen.getByRole("button", { name: /^reset mfa$/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
