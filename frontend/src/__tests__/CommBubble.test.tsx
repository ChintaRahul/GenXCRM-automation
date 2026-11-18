import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CommBubble } from "../components/leadDetail/CommBubble";
import type { TimelineEvent } from "../lib/timeline";

type CommEvent = Extract<TimelineEvent, { kind: "communication" }>;

const baseEvent: CommEvent = {
  kind: "communication",
  id: "c1",
  at: "2026-08-01T00:00:00.000Z",
  commType: "EMAIL",
  status: "SENT",
  subject: "Welcome",
  body: "Hi there, welcome to the course.",
};

describe("CommBubble", () => {
  it("renders the comm type and status badges", () => {
    render(<CommBubble event={baseEvent} />);
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
  });

  it("renders the subject and quoted body when present", () => {
    render(<CommBubble event={baseEvent} />);
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText(/Hi there, welcome to the course\./)).toBeInTheDocument();
  });

  it("omits the subject line when there is none", () => {
    render(<CommBubble event={{ ...baseEvent, subject: undefined }} />);
    expect(screen.queryByText("Welcome")).toBeNull();
  });

  it("shows the failure reason for a failed send", () => {
    render(
      <CommBubble
        event={{
          ...baseEvent,
          commType: "WHATSAPP",
          status: "failed",
          error: "Message failed to send because more than 24 hours have passed.",
        }}
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(
      screen.getByText("Message failed to send because more than 24 hours have passed."),
    ).toBeInTheDocument();
  });

  it("renders no error line when a failed send has no captured reason", () => {
    render(<CommBubble event={{ ...baseEvent, status: "failed" }} />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});
