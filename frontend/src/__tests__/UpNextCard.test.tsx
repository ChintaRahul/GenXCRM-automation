import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { UpNextCard } from "../components/leadDetail/UpNextCard";
import type { Lead } from "../types";

const baseLead: Lead = {
  id: "lead-1",
  name: "Sneha Patel",
  phone: "+919876543210",
  source: "INSTAGRAM",
  stage: "INTERESTED",
  score: 80,
  interestedCount: 1,
  tags: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("UpNextCard", () => {
  it("shows an empty state when there is no active enrollment", () => {
    render(<UpNextCard lead={baseLead} />);
    expect(screen.getByText("Nothing scheduled")).toBeInTheDocument();
  });

  it("renders the next nurturing step's subject and scheduled time", () => {
    const lead: Lead = {
      ...baseLead,
      enrollments: [
        {
          id: "e1",
          sequenceId: "seq-1",
          leadId: "lead-1",
          status: "active",
          currentStep: 1,
          nextRunAt: "2026-08-10T09:00:00.000Z",
          enrolledAt: "2026-08-01T00:00:00.000Z",
          sequence: {
            id: "seq-1",
            name: "Welcome sequence",
            steps: [
              { id: "s0", sequenceId: "seq-1", stepOrder: 0, type: "email", subject: "Welcome", delayDays: 0, createdAt: "" },
              { id: "s1", sequenceId: "seq-1", stepOrder: 1, type: "whatsapp", subject: "Follow up call", delayDays: 2, createdAt: "" },
            ],
          },
        },
      ],
    };
    render(<UpNextCard lead={lead} />);
    expect(screen.getByText("Follow up call")).toBeInTheDocument();
  });

  it("shows an empty state when the enrollment's next step is out of range", () => {
    const lead: Lead = {
      ...baseLead,
      enrollments: [
        {
          id: "e1",
          sequenceId: "seq-1",
          leadId: "lead-1",
          status: "active",
          currentStep: 5,
          enrolledAt: "2026-08-01T00:00:00.000Z",
          sequence: { id: "seq-1", name: "Welcome sequence", steps: [] },
        },
      ],
    };
    render(<UpNextCard lead={lead} />);
    expect(screen.getByText("Nothing scheduled")).toBeInTheDocument();
  });
});
