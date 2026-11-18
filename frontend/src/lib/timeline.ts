import type { Lead, CommType } from "../types";

export type TimelineEvent =
  | {
      kind: "activity";
      id: string;
      at: string;
      activityType: string;
      note?: string;
      userName?: string;
    }
  | {
      kind: "communication";
      id: string;
      at: string;
      commType: CommType;
      subject?: string;
      body?: string;
      status: string;
      error?: string;
    }
  | {
      kind: "payment";
      id: string;
      at: string;
      amount: number;
      status: string;
      gateway: string;
    }
  | {
      kind: "callRecording";
      id: string;
      at: string;
      durationSec?: number;
      // Playback URL is fetched on demand (short-lived, signed) rather than carried here —
      // see CallWaveform.
      recordingId: string;
    };

type TimelineSource = Pick<
  Lead,
  "activities" | "communications" | "payments" | "callRecordings"
>;

export function mergeTimeline(lead: TimelineSource): TimelineEvent[] {
  const events: TimelineEvent[] = [
    ...(lead.activities ?? []).map(
      (a): TimelineEvent => ({
        kind: "activity",
        id: a.id,
        at: a.createdAt,
        activityType: a.type,
        note: a.note,
        userName: a.user?.name,
      }),
    ),
    ...(lead.communications ?? []).map(
      (c): TimelineEvent => ({
        kind: "communication",
        id: c.id,
        at: c.sentAt,
        commType: c.type,
        subject: c.subject,
        body: c.body,
        status: c.status,
        error: c.metadata?.error,
      }),
    ),
    // Only payments with a known event time (i.e. actually paid) become timeline
    // events — a still-pending payment link has no timestamp to place it at.
    ...(lead.payments ?? [])
      .filter((p) => p.paidAt)
      .map(
        (p): TimelineEvent => ({
          kind: "payment",
          id: p.id,
          at: p.paidAt!,
          amount: p.amount,
          status: p.status,
          gateway: p.gateway,
        }),
      ),
    ...(lead.callRecordings ?? []).map(
      (r): TimelineEvent => ({
        kind: "callRecording",
        id: r.id,
        at: r.recordedAt,
        durationSec: r.durationSec,
        recordingId: r.id,
      }),
    ),
  ];

  return events.sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
}
