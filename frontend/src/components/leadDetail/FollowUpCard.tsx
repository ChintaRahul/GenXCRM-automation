import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toLocalInputValue } from "../../lib/followUps";

interface FollowUpCardProps {
  followUpAt: string | null | undefined;
  followUpNote: string | null | undefined;
  onSave: (followUpAtISO: string, note: string) => Promise<void>;
  onClear: () => Promise<void>;
}

export function FollowUpCard({ followUpAt, followUpNote, onSave, onClear }: FollowUpCardProps) {
  const [when, setWhen] = useState(toLocalInputValue(followUpAt));
  const [note, setNote] = useState(followUpNote ?? "");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-card border border-card-border rounded-xl p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
        <CalendarClock className="w-4 h-4 text-primary" />
        Next follow-up
      </p>
      <div className="space-y-2">
        <label className="block text-xs text-muted-foreground" htmlFor="follow-up-when">
          When
        </label>
        <Input
          id="follow-up-when"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <label className="block text-xs text-muted-foreground" htmlFor="follow-up-note">
          What to do
        </label>
        <Input
          id="follow-up-note"
          maxLength={200}
          placeholder="e.g. Call back about fees"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="flex gap-2 mt-3">
        <Button
          size="sm"
          disabled={busy || !when}
          onClick={() => void run(() => onSave(new Date(when).toISOString(), note.trim()))}
        >
          Save
        </Button>
        {followUpAt && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await onClear();
                setWhen("");
                setNote("");
              })
            }
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
