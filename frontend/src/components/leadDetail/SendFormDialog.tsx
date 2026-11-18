import { useState } from "react";
import { toast } from "sonner";
import { useGoogleForms } from "../../hooks/useGoogleForms";
import { useSendForm } from "../../hooks/useSendForm";
import { Messages } from "../../lib/messages";
import type { FormChannel } from "../../types";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

interface Props {
  leadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CHANNELS: { channel: Exclude<FormChannel, "LINK">; label: string }[] = [
  { channel: "EMAIL", label: "Email" },
  { channel: "WHATSAPP", label: "WhatsApp" },
  { channel: "SMS", label: "SMS" },
];

export const SendFormDialog = ({ leadId, open, onOpenChange }: Props) => {
  const { forms, loading, error } = useGoogleForms();
  const { sending, send } = useSendForm(leadId);
  const [formId, setFormId] = useState("");
  const activeForms = forms.filter((f) => f.isActive);

  const handleSend = async (channel: Exclude<FormChannel, "LINK">) => {
    if ((await send(formId, channel)) !== null) onOpenChange(false);
  };

  const handleCopyLink = async () => {
    const result = await send(formId, "LINK");
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.link);
      toast.success(Messages.googleForms.linkCopied);
    } catch {
      toast.error(Messages.googleForms.copyFailed);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Send form</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : activeForms.length === 0 ? (
            <p className="text-sm text-muted-foreground">{Messages.googleForms.noActiveForms}</p>
          ) : (
            <>
              <Select value={formId} onValueChange={setFormId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a form" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {activeForms.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      <span className="block truncate" title={f.name}>
                        {f.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map(({ channel, label }) => (
                  <Button
                    key={channel}
                    type="button"
                    variant="outline"
                    disabled={!formId || sending}
                    onClick={() => void handleSend(channel)}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={!formId || sending}
                  onClick={() => void handleCopyLink()}
                >
                  Copy link
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
