import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

interface EditEmailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  altEmail: string;
  onSubmit: (payload: { email: string; altEmail: string }) => Promise<void>;
}

// A dedicated modal (not inline editing) so a lead's email history stays intact even if
// the save fails partway — same rationale as AddCourseModal.
export function EditEmailsModal({
  open,
  onOpenChange,
  email: initialEmail,
  altEmail: initialAltEmail,
  onSubmit,
}: EditEmailsModalProps) {
  const [email, setEmail] = useState(initialEmail);
  const [altEmail, setAltEmail] = useState(initialAltEmail);
  const [submitting, setSubmitting] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setEmail(initialEmail);
      setAltEmail(initialAltEmail);
    }
    onOpenChange(next);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ email: email.trim(), altEmail: altEmail.trim() });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit email addresses</DialogTitle>
        </DialogHeader>
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Email</label>
            <Input
              autoFocus
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="lead@example.com"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSubmit();
              }}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Alternate email
            </label>
            <Input
              type="email"
              value={altEmail}
              onChange={(e) => setAltEmail(e.target.value)}
              placeholder="another@example.com"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSubmit();
              }}
            />
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={submitting} onClick={() => void handleSubmit()}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
