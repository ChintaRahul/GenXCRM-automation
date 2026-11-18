import { useRef, useState } from "react";
import { useGooglePicker } from "../../hooks/useGooglePicker";
import type { ConnectGoogleFormInput, PickedFile } from "../../types";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (input: ConnectGoogleFormInput) => Promise<boolean>;
}

type SheetChoice = { kind: "pick"; file: PickedFile } | { kind: "create" } | null;

export const AddGoogleFormDialog = ({ open, onOpenChange, onConnect }: Props) => {
  const { picking, pick } = useGooglePicker();
  const [form, setForm] = useState<PickedFile | null>(null);
  const [sheet, setSheet] = useState<SheetChoice>(null);
  const [connecting, setConnecting] = useState(false);
  // Bumped on every close so a connect that resolves late cannot touch the reset state.
  const session = useRef(0);

  const reset = () => {
    session.current += 1;
    setForm(null);
    setSheet(null);
    setConnecting(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const canConnect = form !== null && sheet !== null && !connecting;

  const handlePickForm = async () => {
    const current = session.current;
    const file = await pick("form");
    if (file && current === session.current) setForm(file);
  };

  const handlePickSheet = async () => {
    const current = session.current;
    const file = await pick("sheet");
    if (file && current === session.current) setSheet({ kind: "pick", file });
  };

  const handleConnect = async () => {
    if (!form || !sheet) return;
    setConnecting(true);
    const current = session.current;
    const ok = await onConnect(
      sheet.kind === "create"
        ? { googleFormId: form.id, createSheet: true }
        : { googleFormId: form.id, googleSheetId: sheet.file.id },
    );
    if (current !== session.current) return;
    setConnecting(false);
    if (ok) handleOpenChange(false);
  };

  // Google Picker renders in <body>, outside this dialog. While a Radix modal dialog is open it sets
  // `body { pointer-events: none }`, traps focus and locks scroll, so the Picker cannot be clicked
  // (and closing the dialog on an outside click would discard the pick). Hide the dialog while the
  // Picker is open; the state lives here, so nothing is lost and it reappears when the Picker closes.
  return (
    <Dialog open={open && !picking} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Add a Google Form</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] min-w-0 space-y-5 overflow-y-auto">
          <div className="space-y-2">
            <p className="text-sm font-medium">1. Your form</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" disabled={picking} onClick={() => void handlePickForm()}>
                {form ? "Change form" : "Choose form"}
              </Button>
              {form && (
                <span className="min-w-0 flex-1 truncate text-sm" title={form.name}>
                  {form.name}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Pick it in the Google window. GenXCRM adds a short “Lead ID” question to it so each response is tied to the right lead.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">2. Where responses are saved</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" disabled={picking} onClick={() => void handlePickSheet()}>
                {sheet?.kind === "pick" ? "Change sheet" : "Choose sheet"}
              </Button>
              <Button
                type="button"
                variant={sheet?.kind === "create" ? "default" : "outline"}
                onClick={() => setSheet({ kind: "create" })}
              >
                Create a sheet for me
              </Button>
            </div>
            {sheet?.kind === "pick" && (
              <p className="truncate text-sm" title={sheet.file.name}>
                {sheet.file.name}
              </p>
            )}
            {sheet?.kind === "create" && (
              <p className="text-xs text-muted-foreground">A new sheet will be created in your Google Drive.</p>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canConnect} onClick={() => void handleConnect()}>
            {connecting ? "Connecting…" : "Connect"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
