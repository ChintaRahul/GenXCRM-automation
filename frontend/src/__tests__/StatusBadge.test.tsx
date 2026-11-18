import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import React from "react";
import { StatusBadge } from "../components/shared/StatusBadge";

describe("StatusBadge", () => {
  it("renders label for a known stage status", () => {
    render(<StatusBadge status="NEW" />);
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("renders UNASSIGNED with amber classes", () => {
    render(<StatusBadge status="UNASSIGNED" />);
    const badge = screen.getByText("Unassigned");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("bg-amber-100");
    expect(badge).toHaveClass("text-amber-700");
  });

  it("falls back to underscore-replaced label for unknown status", () => {
    render(<StatusBadge status="CUSTOM_STATUS" />);
    expect(screen.getByText("CUSTOM STATUS")).toBeInTheDocument();
  });

  it("accepts an extra className", () => {
    render(<StatusBadge status="PAID" className="min-w-[90px]" />);
    expect(screen.getByText("Paid")).toHaveClass("min-w-[90px]");
  });

  it("renders DRAFT with gray classes", () => {
    render(<StatusBadge status="DRAFT" />);
    const badge = screen.getByText("Draft");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("bg-gray-100");
    expect(badge).toHaveClass("text-gray-600");
  });

  it("renders SENT with blue classes", () => {
    render(<StatusBadge status="SENT" />);
    const badge = screen.getByText("Sent");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("bg-blue-100");
    expect(badge).toHaveClass("text-blue-700");
  });
});

describe("StatusBadge tone prop", () => {
  it("renders using the tone prop's color when tone is provided, regardless of the status string", () => {
    render(<StatusBadge status="Qualified" tone="green" />);
    const badge = screen.getByText("Qualified");
    expect(badge.className).toMatch(/success-soft/);
  });

  it("falls back to the existing STATUS_STYLES lookup when tone is not provided (unchanged behavior)", () => {
    render(<StatusBadge status="NEW" />);
    expect(screen.getByText(/new/i)).toBeInTheDocument();
  });
});
