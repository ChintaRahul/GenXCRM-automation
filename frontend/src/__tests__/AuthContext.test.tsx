import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { AuthProvider, useAuth } from "../context/AuthContext";
import * as client from "../api/client";
import type { User } from "../types";

vi.mock("../api/client");

const mockUser: User = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  role: "SALES_REP",
  teamId: "team-1",
  orgId: "org-1",
};

function TestConsumer() {
  const { user, loading, signIn, signOut } = useAuth();
  if (loading) return <div>Loading</div>;
  if (!user)
    return <button onClick={() => signIn("tok", mockUser)}>Sign In</button>;
  return (
    <div>
      <span data-testid="user-name">{user.name}</span>
      <button onClick={signOut}>Sign Out</button>
    </div>
  );
}

describe("AuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders loading state initially then resolves", async () => {
    vi.mocked(client.getMe).mockResolvedValue(mockUser);
    localStorage.setItem("token", "existing-token");
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    expect(screen.getByText("Loading")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Loading")).not.toBeInTheDocument(),
    );
  });

  it("shows logged-in user after successful session restore", async () => {
    vi.mocked(client.getMe).mockResolvedValue(mockUser);
    localStorage.setItem("token", "valid-token");
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("user-name")).toHaveTextContent("Test User"),
    );
  });

  it("signs out and clears storage when getMe fails", async () => {
    vi.mocked(client.getMe).mockRejectedValue(new Error("Unauthorized"));
    localStorage.setItem("token", "bad-token");
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText("Sign In")).toBeInTheDocument(),
    );
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("signIn stores token and shows user", async () => {
    vi.mocked(client.getMe).mockResolvedValue(mockUser);
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText("Sign In")).toBeInTheDocument(),
    );
    act(() => {
      screen.getByText("Sign In").click();
    });
    await waitFor(() =>
      expect(screen.getByTestId("user-name")).toHaveTextContent("Test User"),
    );
    expect(localStorage.getItem("token")).toBe("tok");
  });

  it("preserves orgId after session restore", async () => {
    vi.mocked(client.getMe).mockResolvedValue({ ...mockUser, orgId: "org-1" });
    localStorage.setItem("token", "valid-token");
    function OrgConsumer() {
      const { user } = useAuth();
      return <span data-testid="org">{user?.orgId ?? "none"}</span>;
    }
    render(
      <AuthProvider>
        <OrgConsumer />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("org")).toHaveTextContent("org-1"),
    );
  });

  it("signOut clears user state and localStorage", async () => {
    vi.mocked(client.getMe).mockResolvedValue(mockUser);
    localStorage.setItem("token", "valid-token");
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("user-name")).toBeInTheDocument(),
    );
    act(() => {
      screen.getByText("Sign Out").click();
    });
    await waitFor(() =>
      expect(screen.getByText("Sign In")).toBeInTheDocument(),
    );
    expect(localStorage.getItem("token")).toBeNull();
  });

  describe("impersonation", () => {
    const directorUser: User = {
      id: "director-1",
      name: "Director",
      email: "chinta.rahul2@gmail.com",
      role: "DIRECTOR",
      teamId: null,
      orgId: "org-1",
    };
    const repUser: User = {
      id: "rep-1",
      name: "Rep",
      email: "rep@example.com",
      role: "SALES_REP",
      teamId: "team-1",
      orgId: "org-1",
    };

    function ImpersonationConsumer() {
      const { user, isImpersonating, impersonate, exitImpersonation } = useAuth();
      return (
        <div>
          <span data-testid="user-name">{user?.name}</span>
          <span data-testid="is-impersonating">{String(isImpersonating)}</span>
          <button onClick={() => impersonate("rep-token", repUser)}>
            Impersonate
          </button>
          <button onClick={() => exitImpersonation()}>Exit</button>
        </div>
      );
    }

    it("stashes the original session and switches to the impersonated user", async () => {
      vi.mocked(client.getMe).mockResolvedValue(directorUser);
      localStorage.setItem("token", "director-token");
      localStorage.setItem("user", JSON.stringify(directorUser));
      render(
        <AuthProvider>
          <ImpersonationConsumer />
        </AuthProvider>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("user-name")).toHaveTextContent("Director"),
      );

      act(() => {
        screen.getByText("Impersonate").click();
      });

      await waitFor(() =>
        expect(screen.getByTestId("user-name")).toHaveTextContent("Rep"),
      );
      expect(screen.getByTestId("is-impersonating")).toHaveTextContent("true");
      expect(localStorage.getItem("token")).toBe("rep-token");
      expect(localStorage.getItem("originalToken")).toBe("director-token");
      expect(JSON.parse(localStorage.getItem("originalUser") ?? "null")).toEqual(
        directorUser,
      );
    });

    it("restores the original session on exitImpersonation", async () => {
      vi.mocked(client.getMe).mockResolvedValue(directorUser);
      localStorage.setItem("token", "director-token");
      localStorage.setItem("user", JSON.stringify(directorUser));
      render(
        <AuthProvider>
          <ImpersonationConsumer />
        </AuthProvider>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("user-name")).toHaveTextContent("Director"),
      );
      act(() => {
        screen.getByText("Impersonate").click();
      });
      await waitFor(() =>
        expect(screen.getByTestId("user-name")).toHaveTextContent("Rep"),
      );

      act(() => {
        screen.getByText("Exit").click();
      });

      await waitFor(() =>
        expect(screen.getByTestId("user-name")).toHaveTextContent("Director"),
      );
      expect(screen.getByTestId("is-impersonating")).toHaveTextContent("false");
      expect(localStorage.getItem("token")).toBe("director-token");
      expect(localStorage.getItem("originalToken")).toBeNull();
      expect(localStorage.getItem("originalUser")).toBeNull();
    });

    it("isImpersonating is false for a normal session", async () => {
      vi.mocked(client.getMe).mockResolvedValue(directorUser);
      localStorage.setItem("token", "director-token");
      render(
        <AuthProvider>
          <ImpersonationConsumer />
        </AuthProvider>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("is-impersonating")).toHaveTextContent("false"),
      );
    });
  });

  it("loads the full profile after sign-in when the login response has no org", async () => {
    const fullUser = { ...mockUser, org: { id: "org-1", name: "Mfg Co", workspaceType: "MANUFACTURING" } } as unknown as User;
    vi.mocked(client.getMe).mockResolvedValue(fullUser);
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText("Sign In")).toBeInTheDocument());
    act(() => screen.getByText("Sign In").click());
    await waitFor(() => expect(client.getMe).toHaveBeenCalled());
    await waitFor(() => expect(JSON.parse(localStorage.getItem("user") ?? "{}").org?.workspaceType).toBe("MANUFACTURING"));
  });
});
