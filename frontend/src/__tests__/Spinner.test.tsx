import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Spinner } from "../components/ui/Spinner";

describe("Spinner", () => {
  it("renders with role=status and default aria-label", () => {
    render(<Spinner />);
    const el = screen.getByRole("status");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-label", "Loading");
  });

  it("renders a custom aria-label", () => {
    render(<Spinner label="Fetching leads" />);
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "Fetching leads",
    );
  });
});
