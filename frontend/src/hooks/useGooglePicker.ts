import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getGooglePickerConfig } from "../api/client";
import { loadPickerApi, openPicker } from "../lib/googlePicker";
import type { PickedFile } from "../types";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";

export function useGooglePicker() {
  const [picking, setPicking] = useState(false);

  const pick = useCallback(async (kind: "form" | "sheet"): Promise<PickedFile | null> => {
    setPicking(true);
    try {
      const [config] = await Promise.all([getGooglePickerConfig(), loadPickerApi()]);
      return await openPicker(config, kind);
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.googleForms.pickerFailed));
      return null;
    } finally {
      setPicking(false);
    }
  }, []);

  return { picking, pick };
}
