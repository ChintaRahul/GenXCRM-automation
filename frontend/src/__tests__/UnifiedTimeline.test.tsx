import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { UnifiedTimeline } from "../components/leadDetail/UnifiedTimeline";
import type { TimelineEvent } from "../lib/timeline";

const events: TimelineEvent[] = [
  {
    kind: "communication",
    id: "c1",
    at: "2026-08-03T00:00:00.000Z",
    commType: "EMAIL",
    status: "SENT",
    subject: "Welcome",
    body: "Hi",
  },
  {
    kind: "activity",
    id: "a1",
    at: "2026-08-01T00:00:00.000Z",
    activityType: "STAGE_CHANGE",
    note: "Moved to Interested",
    userName: "Priya",
  },
  {
    kind: "payment",
    id: "p1",
    at: "2026-08-02T00:00:00.000Z",
    amount: 5000,
    status: "PAID",
    gateway: "RAZORPAY",
  },
  {
    kind: "callRecording",
    id: "r1",
    at: "2026-08-04T00:00:00.000Z",
    durationSec: 90,
    recordingId: "r1",
  },
];

describe("UnifiedTimeline", () => {
  it("shows an empty state when there are no events", () => {
    render(<UnifiedTimeline events={[]} />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });

  it("renders a row for each event kind", () => {
    render(<UnifiedTimeline events={events} />);
    expect(screen.getByText("Stage change")).toBeInTheDocument();
    expect(screen.getByText("Moved to Interested")).toBeInTheDocument();
    expect(screen.getByText("Priya")).toBeInTheDocument();
    expect(screen.getByText("Email sent")).toBeInTheDocument();
    expect(screen.getByText("Payment paid")).toBeInTheDocument();
    expect(screen.getByText(/₹5,000/)).toBeInTheDocument();
    expect(screen.getByText("Call recorded")).toBeInTheDocument();
  });
});
