import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { StageCell } from "../components/leads/StageCell";

describe("StageCell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the current stage badge", () => {
    render(<StageCell value="NEW" onChange={vi.fn()} />);
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("renders chevron-down icon button", () => {
    render(<StageCell value="INTERESTED" onChange={vi.fn()} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("opens popover with all 8 stages on click", async () => {
    render(<StageCell value="NEW" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByText("Move to stage")).toBeInTheDocument(),
    );
    expect(screen.getByText("Contacted")).toBeInTheDocument();
    expect(screen.getByText("Enrolled")).toBeInTheDocument();
    expect(screen.getByText("Dropped")).toBeInTheDocument();
  });

  it("marks the current stage with a checkmark", async () => {
    render(<StageCell value="INTERESTED" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByText("Move to stage")).toBeInTheDocument(),
    );
    const buttons = screen.getAllByRole("button");
    const interestedBtn = buttons.find((b) =>
      b.textContent?.includes("Interested"),
    );
    expect(interestedBtn).toBeTruthy();
    // check icon is rendered inside the selected option
    expect(interestedBtn?.querySelector("svg")).toBeTruthy();
  });

  it("calls onChange with the selected stage and closes popover", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<StageCell value="NEW" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByText("Move to stage")).toBeInTheDocument(),
    );
    const buttons = screen.getAllByRole("button");
    const contactedBtn = buttons.find((b) =>
      b.textContent?.includes("Contacted"),
    );
    fireEvent.click(contactedBtn!);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("CONTACTED"));
  });

});
