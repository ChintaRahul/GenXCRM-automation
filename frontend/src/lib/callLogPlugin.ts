import { registerPlugin } from "@capacitor/core";

// Native counterpart: frontend/android/app/src/main/java/com/genxcrm/app/calllog/CallLogPlugin.kt
// Reads call duration + connected/missed status for calls placed or received through the OS
// phone app (READ_CALL_LOG only — no dialer role, no recording).
export interface PendingSystemCall {
  id: string;
  leadId: string;
  number: string;
  startedAt: number;
  durationSec: number;
  direction: "inbound" | "outbound";
  outcome: "CONNECTED" | "NOT_CONNECTED";
}

export interface GenXCallLogPlugin {
  getStatus(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  syncLeads(options: { leads: { phone: string; leadId: string; name: string }[] }): Promise<void>;
  // Scans the system CallLog immediately, in addition to the periodic background scan — call
  // this on app resume so a call shows up as soon as the rep is back, not on the next
  // background run.
  syncNow(): Promise<void>;
  getPendingCalls(): Promise<{ calls: PendingSystemCall[] }>;
  ackCall(options: { id: string }): Promise<void>;
}

export const GenXCallLog = registerPlugin<GenXCallLogPlugin>("GenXCallLog");
