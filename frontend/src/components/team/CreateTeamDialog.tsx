import { useState } from 'react';
import { Users, Briefcase } from 'lucide-react';
import { toast } from 'sonner';
import type { Role, TeamType, User } from '../../types';
import { createTeam } from '../../api/client';
import { apiErrorMessage } from '../../lib/apiError';
import { Messages } from '../../lib/messages';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { cn } from '../../lib/utils';

interface CreateTeamDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  managers: User[];
  callerRole: Role;
  onCreated: () => void;
}

const TYPE_OPTIONS: { value: TeamType; label: string; description: string; icon: React.ReactNode }[] = [
  {
    value: 'MEMBER',
    label: 'Member team',
    description: 'Led by a manager, made up of Sales Reps',
    icon: <Users className="w-4 h-4" />,
  },
  {
    value: 'MANAGER',
    label: 'Manager team',
    description: 'Groups Managers — assigned by the Director',
    icon: <Briefcase className="w-4 h-4" />,
  },
];

export function CreateTeamDialog({
  open,
  onOpenChange,
  managers,
  callerRole,
  onCreated,
}: CreateTeamDialogProps) {
  const isManager = callerRole === 'MANAGER';
  const [name, setName] = useState('');
  const [type, setType] = useState<TeamType>('MEMBER');
  const [managerId, setManagerId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName('');
    setType('MEMBER');
    setManagerId('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createTeam({ name, type, managerId: managerId || undefined });
      toast.success(Messages.team.teamCreated(name));
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.team.teamCreateFailed));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create team</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Team type — Directors choose; Managers always create Member teams */}
          {!isManager && <div className="space-y-1.5">
            <Label>Team type *</Label>
            <div className="grid grid-cols-2 gap-2">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setType(opt.value); setManagerId(''); }}
                  className={cn(
                    'flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors',
                    type === opt.value
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-card-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {opt.icon}
                    {opt.label}
                  </span>
                  <span className="text-xs leading-snug">{opt.description}</span>
                </button>
              ))}
            </div>
          </div>}

          <div className="space-y-1.5">
            <Label>Team name *</Label>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Growth Team"
            />
          </div>

          {/* Manager picker — Director only; Managers are auto-assigned on the backend */}
          {!isManager && type === 'MEMBER' && (
            <div className="space-y-1.5">
              <Label>Manager <span className="text-muted-foreground">(optional)</span></Label>
              <Select value={managerId} onValueChange={setManagerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a manager" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create team'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
