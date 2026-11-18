import { useEffect } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { isNative } from "../lib/platform";
import { GenXCallLog } from "../lib/callLogPlugin";
import * as client from "../api/client";
import { useAuth } from "../context/AuthContext";

async function drainPendingCalls(): Promise<void> {
  const { granted } = await GenXCallLog.getStatus();
  if (!granted) return;

  // Immediate scan (on top of CallLogSyncWorker's periodic background scan) — so a call made
  // just before returning to the app shows up now instead of waiting up to 15 minutes.
  await GenXCallLog.syncNow().catch(() => undefined);

  const { calls } = await GenXCallLog.getPendingCalls();
  for (const call of calls) {
    try {
      await client.logCall({
        leadId: call.leadId,
        durationSec: call.durationSec,
        notes: "",
        outcome: call.outcome,
        direction: call.direction,
      });
      await GenXCallLog.ackCall({ id: call.id });
    } catch {
      // Leave it queued natively — retried on the next drain (next resume/app open).
    }
  }
}

// Android-only: pushes the rep's own leads' phone numbers to the native call-log matcher, then
// drains calls it found (placed/received through the OS phone app) into the existing call log
// via logCall(). The CallLog is read two ways: an immediate scan every time the rep returns to
// the app (drainPendingCalls -> syncNow, below — the common case, right after a call) and a
// periodic background scan every 15 min via CallLogSyncWorker (in case the app is never
// reopened). See frontend/android/app/src/main/java/com/genxcrm/app/calllog/.
export function useCallLogSync(): void {
  const { user } = useAuth();

  useEffect(() => {
    if (!isNative() || !user) return;

    void client
      .getLeadPhoneIndex()
      .then((leads) => GenXCallLog.syncLeads({ leads }))
      .catch(() => undefined);

    void drainPendingCalls();

    const sub = CapacitorApp.addListener("resume", () => {
      void drainPendingCalls();
    });

    return () => {
      void sub.then((handle) => handle.remove());
    };
  }, [user]);
}
