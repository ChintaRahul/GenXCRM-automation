import { describe, it, expect } from "vitest";
import { mergeTimeline } from "../lib/timeline";
import type { Lead } from "../types";

type Source = Pick<
  Lead,
  "activities" | "communications" | "payments" | "callRecordings"
>;

describe("mergeTimeline", () => {
  it("merges all four sources and sorts descending by timestamp", () => {
    const lead: Source = {
      activities: [
        {
          id: "a1",
          type: "STAGE_CHANGE",
          note: "Moved to Interested",
          createdAt: "2026-08-01T10:00:00.000Z",
          user: { name: "Rep" },
        },
      ],
      communications: [
        {
          id: "c1",
          type: "EMAIL",
          body: "Welcome!",
          status: "SENT",
          sentAt: "2026-08-03T10:00:00.000Z",
        },
      ],
      payments: [
        {
          id: "p1",
          amount: 5000,
          currency: "INR",
          status: "PAID",
          gateway: "RAZORPAY",
          paidAt: "2026-08-02T10:00:00.000Z",
          installments: [],
        },
      ],
      callRecordings: [
        {
          id: "r1",
          durationSec: 120,
          recordedAt: "2026-08-04T10:00:00.000Z",
        },
      ],
    };

    const result = mergeTimeline(lead);

    expect(result.map((e) => e.kind)).toEqual([
      "callRecording",
      "communication",
      "payment",
      "activity",
    ]);
    expect(result[0].id).toBe("r1");
    expect(result.at(-1)!.id).toBe("a1");
  });

  it("excludes payments with no paidAt (still pending)", () => {
    const lead: Source = {
      activities: [],
      communications: [],
      payments: [
        {
          id: "p1",
          amount: 5000,
          currency: "INR",
          status: "LINK_SENT",
          gateway: "RAZORPAY",
          installments: [],
        },
      ],
      callRecordings: [],
    };

    expect(mergeTimeline(lead)).toEqual([]);
  });

  it("returns an empty array when the lead has no timeline data", () => {
    expect(
      mergeTimeline({
        activities: [],
        communications: [],
        payments: [],
        callRecordings: [],
      }),
    ).toEqual([]);
  });

  it("lifts a failed communication's captured error reason onto the timeline event", () => {
    const lead: Source = {
      activities: [],
      communications: [
        {
          id: "c1",
          type: "WHATSAPP",
          body: "hi",
          status: "failed",
          sentAt: "2026-08-03T10:00:00.000Z",
          metadata: { error: "Re-engagement message" },
        },
      ],
      payments: [],
      callRecordings: [],
    };

    const [event] = mergeTimeline(lead);
    expect(event.kind).toBe("communication");
    expect((event as { error?: string }).error).toBe("Re-engagement message");
  });
});
