import { useState } from "react";
import { History } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";

interface RecoverLeadsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  lastRecovered?: { at: string; count: number } | null;
  onRecover: (sinceIso: string) => void;
}

export function RecoverLeadsDialog({
  open,
  onOpenChange,
  submitting,
  lastRecovered,
  onRecover,
}: RecoverLeadsDialogProps) {
  const [since, setSince] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!since) return;
    onRecover(new Date(since).toISOString());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) {
          onOpenChange(next);
          if (!next) setSince("");
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#1877F2]/10 flex items-center justify-center flex-shrink-0">
              <History className="w-4.5 h-4.5 text-[#1877F2]" />
            </div>
            <DialogTitle>Recover missed leads</DialogTitle>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            If your Facebook connection was down, leads submitted during that time
            didn't come in automatically. Tell us when it went down and we'll pull in
            everything since.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="recover-since">Connection went down at</Label>
            <Input
              id="recover-since"
              type="datetime-local"
              required
              value={since}
              max={new Date().toISOString().slice(0, 16)}
              onChange={(e) => setSince(e.target.value)}
              disabled={submitting}
            />
          </div>

          {lastRecovered && (
            <p className="text-xs text-muted-foreground border-t border-border pt-3">
              Last recovery: {lastRecovered.count} lead{lastRecovered.count === 1 ? "" : "s"}{" "}
              — {new Date(lastRecovered.at).toLocaleString()}
            </p>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !since}>
              {submitting ? "Recovering…" : "Recover leads"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
