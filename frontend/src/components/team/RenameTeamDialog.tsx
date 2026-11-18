import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Team } from '../../types';
import { updateTeam } from '../../api/client';
import { apiErrorMessage } from '../../lib/apiError';
import { Messages } from '../../lib/messages';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

interface RenameTeamDialogProps {
  team: Team | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}

export function RenameTeamDialog({ team, open, onOpenChange, onSaved }: RenameTeamDialogProps) {
  const [name, setName] = useState('');
  const [monthlyTarget, setMonthlyTarget] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (team) {
      setName(team.name);
      setMonthlyTarget(team.monthlyTarget ? String(team.monthlyTarget) : '');
    }
  }, [team]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!team) return;
    setSubmitting(true);
    try {
      await updateTeam(team.id, {
        name: name.trim(),
        monthlyTarget: monthlyTarget.trim() === '' ? 0 : Number(monthlyTarget),
      });
      toast.success(Messages.team.teamRenamed);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.team.teamRenameFailed));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit team{team ? ` — ${team.name}` : ''}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Team name *</Label>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Growth Team"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Monthly target (₹)</Label>
            <Input
              type="number"
              min={0}
              step={1}
              value={monthlyTarget}
              onChange={(e) => setMonthlyTarget(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
