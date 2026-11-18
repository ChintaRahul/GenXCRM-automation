import { useState, useCallback } from "react";
import { toast } from "sonner";
import * as client from "../api/client";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

interface CallAlertResult {
  delivered: boolean;
  phone: string;
}

interface UseCallAlertReturn {
  triggerCallAlert: (leadId: string) => Promise<CallAlertResult | undefined>;
  pending: boolean;
}

export function useCallAlert(): UseCallAlertReturn {
  const [pending, setPending] = useState(false);

  const triggerCallAlert = useCallback(async (leadId: string) => {
    setPending(true);
    try {
      const result = await client.sendCallAlert(leadId);
      if (result.delivered) toast.success(Messages.communications.callAlertSent);
      return result;
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.communications.callAlertFailed));
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);

  return { triggerCallAlert, pending };
}
