import { todayIso } from "../../lib/utils";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import type { ModuleAction } from "../../modules/registry";
import { LookupSelect } from "./LookupSelect";

interface ActionDialogProps {
  action: ModuleAction;
  open: boolean;
  onClose: () => void;
  // `extra` holds the answers to the action's optional `more` questions (only the ones filled in).
  onConfirm: (value: string, extra?: Record<string, string>) => void | Promise<void>;
}

export function ActionDialog({ action, open, onClose, onConfirm }: ActionDialogProps) {
  const [value, setValue] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const ask = action.ask!;
  // A free-text answer is a sentence ("Send revised quotation"), so digits alone don't count.
  const textOnlyDigits = ask.type === "text" && value.trim() !== "" && !/\p{L}/u.test(value);
  const canConfirm = (!ask.required || value.trim().length > 0) && !(ask.type === "date" && value !== "" && value < todayIso()) && !textOnlyDigits;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{action.label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="action-ask-field">
            {ask.label} {ask.required && <span className="text-destructive">*</span>}
          </Label>
          {ask.type === "ref" ? (
            <LookupSelect id="action-ask-field" source={ask.ref ?? ""} value={value} onChange={setValue} placeholder="Select a record…" />
          ) : ask.type === "owner" ? (
            <LookupSelect id="action-ask-field" source="owner" value={value} onChange={setValue} placeholder="Select a person…" />
          ) : ask.type === "select" ? (
            <select
              id="action-ask-field"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select…</option>
              {ask.options?.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : ask.type === "date" ? (
            <input
              id="action-ask-field"
              type="date"
              min={todayIso()}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          ) : (
            <textarea
              id="action-ask-field"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          )}
          {ask.more?.map((more) => (
            <div key={more.key} className="space-y-1 pt-2">
              <Label htmlFor={`action-more-${more.key}`}>{more.label}</Label>
              {more.type === "textarea" ? (
                <textarea
                  id={`action-more-${more.key}`}
                  value={extra[more.key] ?? ""}
                  onChange={(e) => setExtra((prev) => ({ ...prev, [more.key]: e.target.value }))}
                  className="w-full min-h-[64px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              ) : (
                <input
                  id={`action-more-${more.key}`}
                  type={more.type === "money" || more.type === "number" ? "number" : more.type === "date" ? "date" : "text"}
                  min={more.type === "money" || more.type === "number" ? 0 : undefined}
                  value={extra[more.key] ?? ""}
                  onChange={(e) => setExtra((prev) => ({ ...prev, [more.key]: e.target.value }))}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                />
              )}
            </div>
          ))}
          {textOnlyDigits && <p className="text-xs text-destructive">Describe the action in words, e.g. "Send revised quotation by 20 Oct".</p>}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canConfirm} onClick={() => void (ask.more ? onConfirm(value, Object.fromEntries(Object.entries(extra).filter(([, v]) => v.trim() !== ""))) : onConfirm(value))}>
            Confirm
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
