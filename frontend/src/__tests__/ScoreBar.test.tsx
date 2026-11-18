import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import React from "react";
import { ScoreBar } from "../components/leads/ScoreBar";

describe("ScoreBar", () => {
  it("renders the score number", () => {
    render(<ScoreBar score={84} />);
    expect(screen.getByText("84")).toBeInTheDocument();
  });

  it("applies green fill for score >= 85", () => {
    const { container } = render(<ScoreBar score={85} />);
    expect(container.querySelector(".bg-green-500")).not.toBeNull();
  });

  it("applies amber fill for score in 70–84 range", () => {
    const { container } = render(<ScoreBar score={70} />);
    expect(container.querySelector(".bg-amber-500")).not.toBeNull();
  });

  it("applies muted fill for score below 70", () => {
    const { container } = render(<ScoreBar score={69} />);
    expect(container.querySelector(".bg-muted-foreground")).not.toBeNull();
  });

  it("clamps bar width at 100% for scores above 100", () => {
    const { container } = render(<ScoreBar score={120} />);
    const fill = container.querySelector(".bg-green-500") as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });
});
