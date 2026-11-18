import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { OwnerCell } from "../components/leads/OwnerCell";
import type { AssignableUser } from "../hooks/useAssignableUsers";

const mockUsers: AssignableUser[] = [
  { id: "u1", name: "Priya Nair", role: "SALES_REP", openLeads: 0, online: true },
  { id: "u2", name: "Karan Malhotra", role: "MANAGER", openLeads: 0, online: false },
  { id: "u3", name: "Asha Bhatia", role: "SALES_REP", openLeads: 5, online: false },
];

describe("OwnerCell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the owner's full name when a value is set", () => {
    render(
      <OwnerCell
        value={{ id: "u1", name: "Priya Nair" }}
        onChange={vi.fn()}
        users={mockUsers}
      />,
    );
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
  });

  it("renders UNASSIGNED badge when value is null", () => {
    render(
      <OwnerCell value={null} onChange={vi.fn()} users={mockUsers} />,
    );
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("renders static display (no button) when readonly=true", () => {
    render(
      <OwnerCell
        value={{ id: "u1", name: "Priya Nair" }}
        onChange={vi.fn()}
        users={mockUsers}
        readonly
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
  });

  it("opens popover with user list on trigger click", async () => {
    render(
      <OwnerCell value={null} onChange={vi.fn()} users={mockUsers} />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Search team…")).toBeInTheDocument(),
    );
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
    expect(screen.getByText("Karan Malhotra")).toBeInTheDocument();
  });

  it("search filters the user list by name", async () => {
    render(
      <OwnerCell value={null} onChange={vi.fn()} users={mockUsers} />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Search team…")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText("Search team…"), {
      target: { value: "karan" },
    });
    expect(screen.getByText("Karan Malhotra")).toBeInTheDocument();
    expect(screen.queryByText("Priya Nair")).toBeNull();
  });

  it("search filters the user list by role", async () => {
    render(
      <OwnerCell value={null} onChange={vi.fn()} users={mockUsers} />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Search team…")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText("Search team…"), {
      target: { value: "manager" },
    });
    expect(screen.getByText("Karan Malhotra")).toBeInTheDocument();
    expect(screen.queryByText("Priya Nair")).toBeNull();
  });

  it("shows no-match message when search has no results", async () => {
    render(
      <OwnerCell value={null} onChange={vi.fn()} users={mockUsers} />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Search team…")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText("Search team…"), {
      target: { value: "zzznomatch" },
    });
    expect(screen.getByText(/No teammate matches/)).toBeInTheDocument();
  });

  it("calls onChange with userId when a user row is clicked", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(
      <OwnerCell value={null} onChange={onChange} users={mockUsers} />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByText("Priya Nair")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Priya Nair"));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("u1"),
    );
  });

  it("calls onChange(null) when Remove assignment is clicked", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(
      <OwnerCell
        value={{ id: "u1", name: "Priya Nair" }}
        onChange={onChange}
        users={mockUsers}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByText("Remove assignment")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Remove assignment"));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(null),
    );
  });

  it("marks the current owner with a checkmark in the list", async () => {
    render(
      <OwnerCell
        value={{ id: "u2", name: "Karan Malhotra" }}
        onChange={vi.fn()}
        users={mockUsers}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      // Name now appears in both the trigger and the list row, so match all.
      expect(screen.getAllByText("Karan Malhotra").length).toBeGreaterThan(0),
    );
    const buttons = screen.getAllByRole("button");
    // The list row (not the trigger) also contains the role label — use it to disambiguate.
    const karanBtn = buttons.find(
      (b) =>
        b.textContent?.includes("Karan Malhotra") &&
        b.textContent?.includes("MANAGER"),
    );
    expect(karanBtn?.querySelector("svg")).toBeTruthy();
  });
});
