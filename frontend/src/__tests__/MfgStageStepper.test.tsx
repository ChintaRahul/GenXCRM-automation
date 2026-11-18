import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StageStepper, getStageStepperState } from "../components/mfg/StageStepper";

const FLOW = ["New", "Assigned", "Contacted", "Follow-up", "Qualified"];
const LONG = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

describe("getStageStepperState", () => {
  it("marks earlier steps done, the status current, later upcoming", () => {
    const { steps, heading, next } = getStageStepperState(FLOW, "Contacted");
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "current", "upcoming", "upcoming"]);
    expect(heading).toBe("Stage 3 of 5 · Contacted");
    expect(next).toBe("Follow-up");
  });

  it("has no next stage on the last step", () => {
    expect(getStageStepperState(FLOW, "Qualified").next).toBeNull();
  });

  it("treats Won (outside the flow) as all stages complete", () => {
    const { steps, heading, next } = getStageStepperState(FLOW, "Won");
    expect(steps.every((s) => s.state === "done")).toBe(true);
    expect(heading).toBe("Stage 5 of 5 · Won");
    expect(next).toBeNull();
  });

  it("keeps every step neutral when the status is not in the flow (Lost)", () => {
    const { steps, heading } = getStageStepperState(FLOW, "Lost");
    expect(steps.every((s) => s.state === "upcoming")).toBe(true);
    expect(heading).toBe("Status: Lost");
  });

  it("shows all labels for flows of 7 or fewer stages", () => {
    expect(getStageStepperState(FLOW, "New").steps.every((s) => s.showLabel)).toBe(true);
  });

  it("only labels previous / current / next for flows over 7 stages", () => {
    const { steps, compact } = getStageStepperState(LONG, "D");
    expect(compact).toBe(true);
    expect(steps.filter((s) => s.showLabel).map((s) => s.label)).toEqual(["C", "D", "E"]);
  });
});

describe("StageStepper", () => {
  it("renders the header, next stage and a tooltip title on every step", () => {
    render(<StageStepper flow={LONG} status="D" />);
    expect(screen.getByText("Stage 4 of 9 · D")).toBeInTheDocument();
    expect(screen.getByText("E", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getAllByTestId("status-step")).toHaveLength(9);
    expect(screen.getAllByTestId("status-step")[8]).toHaveAttribute("title", "I");
  });

  it("shows 'All stages complete' for Won", () => {
    render(<StageStepper flow={FLOW} status="Won" />);
    expect(screen.getByText("All stages complete")).toBeInTheDocument();
  });

  it("reports how far through the flow the status is, as a percentage", () => {
    expect(getStageStepperState(FLOW, "Contacted").percent).toBe("60%");
    expect(getStageStepperState(FLOW, "Won").percent).toBe("100%");
    expect(getStageStepperState(FLOW, "Lost").percent).toBeNull();
  });
});
