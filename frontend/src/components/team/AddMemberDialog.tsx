import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { MfgRole, Role, Team } from '../../types';
import { createUser } from '../../api/client';
import { apiErrorCode, apiErrorMessage } from '../../lib/apiError';
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

interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  teams: Team[];
  callerRole: Role;
  callerTeamId: string | null;
  onCreated: () => void;
}

// Radix Select can't hold an empty value, so use a sentinel for the "no team" option.
const NONE = '__none__';

const NONE_MFG_ROLE = '__none__';

const BLANK_FORM = {
  name: '',
  email: '',
  role: 'SALES_REP' as Role,
  mfgRole: NONE_MFG_ROLE as MfgRole | typeof NONE_MFG_ROLE,
  teamId: '',
};

export function AddMemberDialog({
  open,
  onOpenChange,
  teams,
  callerRole,
  onCreated,
}: AddMemberDialogProps) {
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const isDirector = callerRole === 'DIRECTOR';
  const workspaceType = useWorkspace();
  const showMfgRole = isDirector && workspaceType === 'MANUFACTURING';

  function reset() {
    setForm({ ...BLANK_FORM });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Use the selected teamId; for Manager with single team, default to that team
      const teamId = form.teamId || (availableTeams.length === 1 ? availableTeams[0].id : null);
      // No password — the member sets their own via a link emailed to them.
      await createUser({
        name: form.name,
        email: form.email,
        role: form.role,
        mfgRole: showMfgRole && form.mfgRole !== NONE_MFG_ROLE ? form.mfgRole : undefined,
        teamId,
      } as Record<string, unknown>);
      toast.success(Messages.team.memberAdded);
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      if (apiErrorCode(err) === 'SEAT_LIMIT_REACHED') {
        // All paid seats are taken. Directors can buy more; reps/managers
        // can't reach billing, so point them at their director.
        toast.error(apiErrorMessage(err, Messages.team.seatsInUse), {
          description: isDirector
            ? 'Add more seats to your plan to invite this member.'
            : 'Ask your director to add more seats to your plan.',
          ...(isDirector && {
            action: {
              label: 'Add seats',
              onClick: () => {
                onOpenChange(false);
                navigate('/billing');
              },
            },
          }),
        });
      } else {
        toast.error(apiErrorMessage(err, Messages.team.memberAddFailed));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Backend already filters teams by role (Manager only gets their managed teams).
  // No further client-side filter needed.
  const availableTeams = teams;
  const showTeamSelect = isDirector || availableTeams.length > 1;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
        </DialogHeader>
        {/* Honeypot stops browsers auto-filling the real email field */}
        <input type="text" name="username" aria-hidden="true" className="hidden" tabIndex={-1} readOnly />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input
              required
              autoComplete="off"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Full name"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Email *</Label>
            <Input
              type="email"
              required
              autoComplete="off"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              placeholder="email@company.com"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            We&rsquo;ll email this address a secure link to set their own password
            and activate their account.
          </p>

          <div className="space-y-1.5">
            <Label>Role</Label>
            {isDirector ? (
              <Select
                value={form.role}
                onValueChange={(v) => setForm((p) => ({ ...p, role: v as Role }))}
              >
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
              <Label>Manufacturing role <span className="text-muted-foreground">(optional)</span></Label>
              <Select
                value={form.mfgRole}
                onValueChange={(v) => setForm((p) => ({ ...p, mfgRole: v as MfgRole | typeof NONE_MFG_ROLE }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not assigned" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  <SelectItem value={NONE_MFG_ROLE}>Not assigned</SelectItem>
                  {MFG_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {availableTeams.length > 0 && (
            <div className="space-y-1.5">
              <Label>Team <span className="text-muted-foreground">(optional)</span></Label>
              {showTeamSelect ? (
                <Select
                  value={form.teamId || NONE}
                  onValueChange={(v) =>
                    setForm((p) => ({ ...p, teamId: v === NONE ? '' : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No team" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    <SelectItem value={NONE}>No team</SelectItem>
                    {availableTeams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground py-2">
                  {availableTeams[0].name}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Adding…' : 'Add member'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
