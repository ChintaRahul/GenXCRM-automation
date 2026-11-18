import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAssignableUsers } from "../hooks/useAssignableUsers";
import * as client from "../api/client";
import type { User } from "../types";

vi.mock("../api/client");

const mockUsers: User[] = [
  { id: "u1", name: "Rep One", email: "r1@t.com", role: "SALES_REP", teamId: "t1", openLeads: 12 },
  { id: "u2", name: "Rep Two", email: "r2@t.com", role: "SALES_REP", teamId: "t1" },
];

describe("useAssignableUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requests open-lead counts from the API", async () => {
    vi.mocked(client.getUsers).mockResolvedValue(mockUsers);
    renderHook(() => useAssignableUsers());
    await waitFor(() => expect(client.getUsers).toHaveBeenCalledWith(true));
  });

  it("maps the real openLeads count from the API response", async () => {
    vi.mocked(client.getUsers).mockResolvedValue(mockUsers);
    const { result } = renderHook(() => useAssignableUsers());
    await waitFor(() => expect(result.current.users).toHaveLength(2));
    expect(result.current.users[0]).toMatchObject({ id: "u1", openLeads: 12 });
  });

  it("defaults openLeads to 0 when the API omits it", async () => {
    vi.mocked(client.getUsers).mockResolvedValue(mockUsers);
    const { result } = renderHook(() => useAssignableUsers());
    await waitFor(() => expect(result.current.users).toHaveLength(2));
    expect(result.current.users[1]).toMatchObject({ id: "u2", openLeads: 0 });
  });

  it("sets error state on failed fetch", async () => {
    vi.mocked(client.getUsers).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useAssignableUsers());
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
