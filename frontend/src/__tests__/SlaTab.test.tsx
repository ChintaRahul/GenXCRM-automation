import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SlaTab } from "../components/module/SlaTab";

describe("SlaTab", () => {
  it("renders the SLA label from the record", () => {
    render(<SlaTab sla={{ l: "Breached 1h 20m", t: "red" }} />);
    expect(screen.getByText("Breached 1h 20m")).toBeInTheDocument();
  });

  it("falls back to a gray badge when the tone is missing", () => {
    render(<SlaTab sla={{ l: "Due in 2h" }} />);
    expect(screen.getByText("Due in 2h").className).toMatch(/muted/);
  });

  it("renders a no-policy message when the record has no sla", () => {
    render(<SlaTab sla={null} />);
    expect(screen.getByText(/no sla policy applies/i)).toBeInTheDocument();
  });
});
