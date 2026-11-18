import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Team, User } from '../../types';
import { updateTeam } from '../../api/client';
import { apiErrorMessage } from '../../lib/apiError';
import { Messages } from '../../lib/messages';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

interface ChangeManagerDialogProps {
  team: Team | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  managers: User[];
  onSaved: () => void;
}

const NONE = '__none__';

export function ChangeManagerDialog({ team, open, onOpenChange, managers, onSaved }: ChangeManagerDialogProps) {
  const [managerId, setManagerId] = useState<string>(NONE);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (team) setManagerId(team.managerId ?? NONE);
  }, [team]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!team) return;
    setSubmitting(true);
    try {
      await updateTeam(team.id, { managerId: managerId === NONE ? null : managerId });
      toast.success(Messages.team.managerUpdated);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.team.managerUpdateFailed));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {team?.manager ? 'Change' : 'Assign'} manager{team ? ` — ${team.name}` : ''}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Manager</Label>
            <Select value={managerId} onValueChange={setManagerId}>
              <SelectTrigger>
                <SelectValue placeholder="No manager" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value={NONE}>No manager</SelectItem>
                {managers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
