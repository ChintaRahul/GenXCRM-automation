import { Button } from "../ui/button";
import { useCallLogPermission } from "../../hooks/useCallLogPermission";

// Self-contained "let GenXCRM see your call log" status + grant control (Android only). Actual
// syncing happens in useCallLogSync (registered once at the app root); this card just surfaces
// and requests the READ_CALL_LOG permission that sync depends on.
export function CallLogSyncCard() {
  const { supported, granted, requesting, requestPermission } = useCallLogPermission();

  if (!supported) return null;

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p className="text-sm text-foreground">{granted ? "Enabled" : "Not enabled"}</p>
        <p className="text-xs text-muted-foreground">
          {granted
            ? "Calls you make or receive on this phone are logged against matching leads."
            : "Log call duration and whether it connected, for calls made or received on this phone."}
        </p>
      </div>
      {!granted && (
        <Button variant="outline" size="sm" disabled={requesting} onClick={() => void requestPermission()}>
          {requesting ? "Requesting…" : "Enable"}
        </Button>
      )}
    </div>
  );
}
