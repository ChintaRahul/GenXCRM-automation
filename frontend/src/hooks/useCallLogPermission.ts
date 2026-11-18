import { useCallback, useEffect, useState } from "react";
import { isNative } from "../lib/platform";
import { GenXCallLog } from "../lib/callLogPlugin";

interface UseCallLogPermissionReturn {
  supported: boolean;
  granted: boolean;
  requesting: boolean;
  requestPermission: () => Promise<void>;
}

// Drives the "Call Log Sync" toggle in the Account dialog (Android only). Actual syncing is
// owned by useCallLogSync; this hook only surfaces/grants the permission.
export function useCallLogPermission(): UseCallLogPermissionReturn {
  const supported = isNative();
  const [granted, setGranted] = useState(false);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (!supported) return;
    void GenXCallLog.getStatus()
      .then((status) => setGranted(status.granted))
      .catch(() => undefined);
  }, [supported]);

  const requestPermission = useCallback(async () => {
    if (!supported) return;
    setRequesting(true);
    try {
      const status = await GenXCallLog.requestPermission();
      setGranted(status.granted);
    } finally {
      setRequesting(false);
    }
  }, [supported]);

  return { supported, granted, requesting, requestPermission };
}
