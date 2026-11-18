import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { BulkActionBar } from "../components/leads/BulkActionBar";
import type { AssignableUser } from "../hooks/useAssignableUsers";

const mockUsers: AssignableUser[] = [
  { id: "u1", name: "Priya Nair", role: "SALES_REP", openLeads: 0, online: true },
  { id: "u2", name: "Karan Malhotra", role: "MANAGER", openLeads: 0, online: false },
];

const defaultProps = {
  count: 3,
  loading: false,
  users: mockUsers,
  onAssign: vi.fn(),
  onAutoAssign: vi.fn(),
  onEnroll: vi.fn(),
  onChangeStage: vi.fn(),
  onExport: vi.fn(),
  onMarkClosed: vi.fn(),
  onDelete: vi.fn(),
  onClear: vi.fn(),
};

describe("BulkActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders selected count", () => {
    render(<BulkActionBar {...defaultProps} />);
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });

  it("calls onMarkClosed when Mark closed is clicked", () => {
    render(<BulkActionBar {...defaultProps} />);
    fireEvent.click(screen.getByText("Mark closed"));
    expect(defaultProps.onMarkClosed).toHaveBeenCalledTimes(1);
  });

  it("calls onDelete when Delete is clicked", () => {
    render(<BulkActionBar {...defaultProps} />);
    fireEvent.click(screen.getByText("Delete"));
    expect(defaultProps.onDelete).toHaveBeenCalledTimes(1);
  });

  it("calls onAutoAssign when Auto-assign is clicked", () => {
    render(<BulkActionBar {...defaultProps} />);
    fireEvent.click(screen.getByText("Auto-assign"));
    expect(defaultProps.onAutoAssign).toHaveBeenCalledTimes(1);
  });

  it("calls onClear when Clear selection is clicked", () => {
    render(<BulkActionBar {...defaultProps} />);
    fireEvent.click(screen.getByText("Clear selection"));
    expect(defaultProps.onClear).toHaveBeenCalledTimes(1);
  });

  it("disables all action buttons when loading is true", () => {
    render(<BulkActionBar {...defaultProps} loading={true} />);
    const buttons = screen.getAllByRole("button");
    const actionButtons = buttons.filter(
      (b) => b.textContent !== "Clear selection",
    );
    actionButtons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it("opens Assign popover on Assign click and shows user list", async () => {
    render(<BulkActionBar {...defaultProps} />);
    fireEvent.click(screen.getByText("Assign"));
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("Assign selected to…"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
    expect(screen.getByText("Karan Malhotra")).toBeInTheDocument();
  });

  it("calls onAssign with userId when a user is selected from Assign popover", async () => {
    render(<BulkActionBar {...defaultProps} />);
    fireEvent.click(screen.getByText("Assign"));
    await waitFor(() =>
      expect(screen.getByText("Priya Nair")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Priya Nair"));
    expect(defaultProps.onAssign).toHaveBeenCalledWith("u1");
  });

  it("opens Change stage popover on Change stage click and shows stages", async () => {
    render(<BulkActionBar {...defaultProps} />);
    fireEvent.click(screen.getByText("Change stage"));
    await waitFor(() =>
      expect(screen.getByText("Move selected to")).toBeInTheDocument(),
    );
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Enrolled")).toBeInTheDocument();
  });

  it("calls onChangeStage with stage when a stage is selected", async () => {
    render(<BulkActionBar {...defaultProps} />);
    fireEvent.click(screen.getByText("Change stage"));
    await waitFor(() =>
      expect(screen.getByText("Move selected to")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Contacted"));
    expect(defaultProps.onChangeStage).toHaveBeenCalledWith("CONTACTED");
  });

  it("assign search filters the user list", async () => {
    render(<BulkActionBar {...defaultProps} />);
    fireEvent.click(screen.getByText("Assign"));
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("Assign selected to…"),
      ).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText("Assign selected to…"), {
      target: { value: "karan" },
    });
    expect(screen.getByText("Karan Malhotra")).toBeInTheDocument();
    expect(screen.queryByText("Priya Nair")).toBeNull();
  });
});
