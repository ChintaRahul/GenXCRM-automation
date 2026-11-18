import { useCallback, useState } from "react";
import { toast } from "sonner";
import { sendGoogleForm } from "../api/client";
import type { FormChannel } from "../types";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

export function useSendForm(leadId: string) {
  const [sending, setSending] = useState(false);

  const send = useCallback(
    async (formId: string, channel: FormChannel) => {
      setSending(true);
      try {
        const result = await sendGoogleForm(leadId, { formId, channel });
        if (channel === "LINK") return result;
        if (!result.sent) {
          toast.error(Messages.googleForms.sendFailed);
          return null;
        }
        toast.success(Messages.googleForms.sent);
        return result;
      } catch (err) {
        toast.error(apiErrorMessage(err, Messages.googleForms.sendFailed));
        return null;
      } finally {
        setSending(false);
      }
    },
    [leadId],
  );

  return { sending, send };
}
