import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { useImpersonation } from "../hooks/useImpersonation";
import { AuthProvider, useAuth } from "../context/AuthContext";
import * as client from "../api/client";
import type { User } from "../types";

vi.mock("../api/client");

const repUser: User = {
  id: "rep-1",
  name: "Rep",
  email: "rep@example.com",
  role: "SALES_REP",
  teamId: "team-1",
  orgId: "org-1",
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe("useImpersonation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(client.getMe).mockResolvedValue({
      id: "director-1",
      name: "Director",
      email: "chinta.rahul2@gmail.com",
      role: "DIRECTOR",
      teamId: null,
      orgId: "org-1",
    });
  });

  it("impersonate() swaps the session on success", async () => {
    localStorage.setItem("token", "director-token");
    vi.mocked(client.impersonate).mockResolvedValue({
      token: "rep-token",
      user: repUser,
    });

    const { result } = renderHook(
      () => ({ impersonation: useImpersonation(), auth: useAuth() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.auth.loading).toBe(false));

    // After the token swap, /me answers for the impersonated user (sign-in refetches the full profile).
    vi.mocked(client.getMe).mockResolvedValue(repUser);
    let returned: string | null = "not-yet-set";
    await act(async () => {
      returned = await result.current.impersonation.impersonate("rep-1");
    });

    expect(client.impersonate).toHaveBeenCalledWith("rep-1");
    expect(returned).toBeNull();
    expect(result.current.impersonation.error).toBeNull();
    await waitFor(() =>
      expect(result.current.auth.user?.id).toBe("rep-1"),
    );
    expect(result.current.auth.isImpersonating).toBe(true);
  });

  it("impersonate() sets an error and does not swap the session on failure", async () => {
    localStorage.setItem("token", "director-token");
    vi.mocked(client.impersonate).mockRejectedValue(new Error("boom"));

    const { result } = renderHook(
      () => ({ impersonation: useImpersonation(), auth: useAuth() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.auth.loading).toBe(false));

    let returned: string | null = null;
    await act(async () => {
      returned = await result.current.impersonation.impersonate("rep-1");
    });

    expect(returned).toBeTruthy();
    expect(result.current.impersonation.error).toBeTruthy();
    expect(result.current.auth.isImpersonating).toBe(false);
  });

  it("exitImpersonation() restores the session even if the API call fails", async () => {
    localStorage.setItem("token", "director-token");
    vi.mocked(client.impersonate).mockResolvedValue({
      token: "rep-token",
      user: repUser,
    });
    vi.mocked(client.exitImpersonation).mockRejectedValue(new Error("boom"));

    const { result } = renderHook(
      () => ({ impersonation: useImpersonation(), auth: useAuth() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.auth.loading).toBe(false));

    await act(async () => {
      await result.current.impersonation.impersonate("rep-1");
    });
    await waitFor(() => expect(result.current.auth.isImpersonating).toBe(true));

    await act(async () => {
      await result.current.impersonation.exitImpersonation();
    });

    expect(client.exitImpersonation).toHaveBeenCalled();
    await waitFor(() =>
      expect(result.current.auth.isImpersonating).toBe(false),
    );
  });
});
