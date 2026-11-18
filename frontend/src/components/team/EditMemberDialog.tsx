import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { MfgRole, Role, Team, User } from '../../types';
import { updateUser } from '../../api/client';
import { apiErrorMessage } from '../../lib/apiError';
import { Messages } from '../../lib/messages';
import { useWorkspace } from '../../hooks/useWorkspace';
import { MFG_ROLES } from '../../hooks/useRolesPermissions';
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

interface EditMemberDialogProps {
  user: User | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  teams: Team[];
  callerRole: Role;
  callerTeamId: string | null;
  onSaved: () => void;
}

export function EditMemberDialog({
  user,
  open,
  onOpenChange,
  teams,
  callerRole,
  callerTeamId,
  onSaved,
}: EditMemberDialogProps) {
  const [role, setRole] = useState<Role>('SALES_REP');
  const [mfgRole, setMfgRole] = useState<MfgRole | '__none__'>('__none__');
  const [teamId, setTeamId] = useState<string>('__none__');
  const [monthlyTarget, setMonthlyTarget] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isDirector = callerRole === 'DIRECTOR';
  const workspaceType = useWorkspace();
  const showMfgRole = isDirector && workspaceType === 'MANUFACTURING';

  useEffect(() => {
    if (user) {
      setRole(user.role);
      setMfgRole(user.mfgRole ?? '__none__');
      setTeamId(user.teamId ?? '__none__');
      setMonthlyTarget(user.monthlyTarget ? String(user.monthlyTarget) : '');
    }
  }, [user]);

  // The backend requires a MANAGER's team to be TeamType 'MANAGER' and a SALES_REP's team
  // to be TeamType 'MEMBER' (DIRECTOR is exempt from this check). Only offer teams of the
  // matching type, and drop a now-mismatched selection when the role changes.
  const teamTypeForRole = (r: Role) => (r === 'MANAGER' ? 'MANAGER' : r === 'SALES_REP' ? 'MEMBER' : null);
  const availableTeams = (isDirector ? teams : teams.filter((t) => t.id === callerTeamId)).filter((t) => {
    const expected = teamTypeForRole(role);
    return !expected || t.type === expected;
  });

  function handleRoleChange(next: Role) {
    setRole(next);
    const expected = teamTypeForRole(next);
    const current = teams.find((t) => t.id === teamId);
    if (expected && current && current.type !== expected) setTeamId('__none__');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    try {
      await updateUser(user.id, {
        role: isDirector ? role : undefined,
        mfgRole: showMfgRole ? (mfgRole === '__none__' ? null : mfgRole) : undefined,
        teamId: teamId === '__none__' ? null : teamId,
        monthlyTarget: monthlyTarget.trim() === '' ? 0 : Number(monthlyTarget),
      });
      toast.success(Messages.team.memberUpdated);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.team.memberUpdateFailed));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit member{user ? ` — ${user.name}` : ''}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Role</Label>
            {isDirector ? (
              <Select value={role} onValueChange={(v) => handleRoleChange(v as Role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  <SelectItem value="SALES_REP">Sales Rep</SelectItem>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="DIRECTOR">Director</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground py-2">Sales Rep</p>
            )}
          </div>
          {showMfgRole && (
            <div className="space-y-1.5">
              <Label>Manufacturing role</Label>
              <Select value={mfgRole} onValueChange={(v) => setMfgRole(v as MfgRole | '__none__')}>
                <SelectTrigger>
                  <SelectValue placeholder="Not assigned" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  <SelectItem value="__none__">Not assigned</SelectItem>
                  {MFG_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Controls this person's access under Administration &gt; Roles &amp; Permissions. Not assigned
                defaults to {role === 'SALES_REP' ? 'seeing only their own records' : 'seeing the whole organization'}.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Team</Label>
            <Select
              value={teamId}
              onValueChange={setTeamId}
              disabled={!isDirector && availableTeams.length === 1}
            >
              <SelectTrigger>
                <SelectValue placeholder="No team" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="__none__">No team</SelectItem>
                {availableTeams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
