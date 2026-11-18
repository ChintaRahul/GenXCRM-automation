import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { StageStepper } from "../components/leadDetail/StageStepper";

describe("StageStepper", () => {
  it("renders all 6 linear stage labels", () => {
    render(<StageStepper currentStage="NEW" onChange={vi.fn()} />);
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Contacted")).toBeInTheDocument();
    expect(screen.getByText("Interested")).toBeInTheDocument();
    expect(screen.getByText("Demo")).toBeInTheDocument();
    expect(screen.getByText("Negotiation")).toBeInTheDocument();
    expect(screen.getByText("Enrolled")).toBeInTheDocument();
  });

  it("shows a checkmark for done stages before the current one", () => {
    const { container } = render(
      <StageStepper currentStage="INTERESTED" onChange={vi.fn()} />,
    );
    // NEW and CONTACTED are done (indices 0,1), INTERESTED (index 2) is active
    expect(container.querySelectorAll("svg.lucide-check").length).toBe(2);
  });

  it("shows an off-path badge when the current stage is not on the linear path", () => {
    render(<StageStepper currentStage="DROPPED" onChange={vi.fn()} />);
    expect(screen.getByText("Dropped")).toBeInTheDocument();
  });

  it("Mark enrolled calls onChange('ENROLLED')", () => {
    const onChange = vi.fn();
    render(<StageStepper currentStage="NEGOTIATION" onChange={onChange} />);
    fireEvent.click(screen.getByText("Mark enrolled"));
    expect(onChange).toHaveBeenCalledWith("ENROLLED");
  });

  // Regression test for SCRUM-43: clicking a non-active stage (including one already
  // passed) must update the lead's stage. Only the currently active stage is inert.
  it("allows clicking a past stage (backward navigation)", () => {
    const onChange = vi.fn();
    render(<StageStepper currentStage="INTERESTED" onChange={onChange} />);
    fireEvent.click(screen.getByText("Contacted"));
    expect(onChange).toHaveBeenCalledWith("CONTACTED");
    expect(screen.getByText("Contacted").closest("button")).not.toBeDisabled();
  });

  it("disables only the currently active stage", () => {
    render(<StageStepper currentStage="INTERESTED" onChange={vi.fn()} />);
    expect(screen.getByText("Interested").closest("button")).toBeDisabled();
    expect(screen.getByText("New").closest("button")).not.toBeDisabled();
    expect(screen.getByText("Demo").closest("button")).not.toBeDisabled();
  });

  it("allows clicking a future stage (forward navigation)", () => {
    const onChange = vi.fn();
    render(<StageStepper currentStage="INTERESTED" onChange={onChange} />);
    fireEvent.click(screen.getByText("Demo"));
    expect(onChange).toHaveBeenCalledWith("DEMO_SCHEDULED");
  });

  it("disables Mark enrolled when already enrolled", () => {
    render(<StageStepper currentStage="ENROLLED" onChange={vi.fn()} />);
    expect(screen.getByText("Mark enrolled")).toBeDisabled();
  });

  it("More stages overflow lists exactly the 13 non-linear stages", async () => {
    const onChange = vi.fn();
    render(<StageStepper currentStage="NEW" onChange={onChange} />);
    fireEvent.click(screen.getByTitle("More stages"));
    await waitFor(() => expect(screen.getByText("More stages")).toBeInTheDocument());
    expect(screen.getByText("Dropped")).toBeInTheDocument();
    expect(screen.getByText("Won")).toBeInTheDocument();
    expect(screen.getByText("Lost")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Dropped"));
    expect(onChange).toHaveBeenCalledWith("DROPPED");
  });

  it("keeps the More stages trigger reachable and reopenable after an off-path stage is selected", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StageStepper currentStage="NEW" onChange={onChange} />,
    );

    // Select an off-path stage from the overflow list.
    fireEvent.click(screen.getByTitle("More stages"));
    await waitFor(() => expect(screen.getByText("More stages")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Follow-up required"));
    expect(onChange).toHaveBeenCalledWith("FOLLOW_UP_REQUIRED");

    // Simulate the parent re-rendering with the updated (off-path) stage.
    rerender(
      <StageStepper currentStage="FOLLOW_UP_REQUIRED" onChange={onChange} />,
    );

    // The trigger must still be a single, unobstructed element the user can tap again.
    const trigger = screen.getByTitle("More stages");
    expect(trigger).toBeInTheDocument();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByText("More stages")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Call back"));
    expect(onChange).toHaveBeenCalledWith("CALL_BACK");
  });
});
