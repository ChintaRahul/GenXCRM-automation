import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useImpersonatableUsers } from "../hooks/useImpersonatableUsers";
import * as client from "../api/client";
import { Messages } from "../lib/messages";

vi.mock("../api/client");

const mockUser = {
  id: "u1",
  name: "Rep",
  email: "rep@other-org.com",
  role: "SALES_REP" as const,
  org: { id: "org-2", name: "Other Org" },
};

describe("useImpersonatableUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns users system-wide on successful fetch", async () => {
    vi.mocked(client.listImpersonatableUsers).mockResolvedValue([mockUser]);
    const { result } = renderHook(() => useImpersonatableUsers());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.users).toHaveLength(1);
    expect(result.current.users[0].org?.name).toBe("Other Org");
    expect(result.current.error).toBeNull();
  });

  it("sets error state on failed fetch", async () => {
    vi.mocked(client.listImpersonatableUsers).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useImpersonatableUsers());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(Messages.load.impersonatableUsers);
    expect(result.current.users).toHaveLength(0);
  });
});
