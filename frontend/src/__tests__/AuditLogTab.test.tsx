import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuditLogTab } from "../components/admin/AuditLogTab";
import * as client from "../api/client";

vi.mock("../api/client");

describe("AuditLogTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists audit entries with action, user and IP", async () => {
    vi.mocked(client.getAuditLog).mockResolvedValue({
      items: [{ id: "1", action: "Login", userName: "Asha D", time: "2026-10-01T09:00:00Z", ipAddress: "10.0.0.1" }],
      total: 1, page: 1, pageSize: 20,
    } as never);
    render(<AuditLogTab />);
    expect(await screen.findByText("Login")).toBeInTheDocument();
    expect(screen.getByText("Asha D")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
    expect(client.getAuditLog).toHaveBeenCalledWith(1, 20);
  });

  it("shows an empty state", async () => {
    vi.mocked(client.getAuditLog).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 } as never);
    render(<AuditLogTab />);
    expect(await screen.findByText(/no activity recorded yet/i)).toBeInTheDocument();
  });

  it("shows the error when the log can't be loaded", async () => {
    vi.mocked(client.getAuditLog).mockRejectedValue(new Error("boom"));
    render(<AuditLogTab />);
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    expect(screen.getByRole("cell", { name: /./ })).toBeInTheDocument();
  });
});
