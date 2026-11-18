import { useState } from 'react';
import { UserPlus, UserMinus, UserCircle2, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { Team, User } from '../../types';
import { updateUser } from '../../api/client';
import { apiErrorMessage } from '../../lib/apiError';
import { Messages } from '../../lib/messages';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { StatusBadge } from '../shared/StatusBadge';

interface ManageMembersDialogProps {
  team: Team | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  allUsers: User[];
  onSaved: () => void;
}

function initials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

export function ManageMembersDialog({ team, open, onOpenChange, allUsers, onSaved }: ManageMembersDialogProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [addSearch, setAddSearch] = useState('');

  if (!team) return null;
  const safeTeam = team;

  const memberRole = safeTeam.type === 'MANAGER' ? 'MANAGER' : 'SALES_REP';
  // Use allUsers (refreshed after every add/remove) instead of stale safeTeam.members.
  // Membership is teamId alone — do NOT also require role === memberRole here.
  // UsersService.update() explicitly lets a DIRECTOR belong to any team (they oversee
  // the whole org), so a Director on a MEMBER-type team is a valid, active member whose
  // role differs from the team's expected member role. Filtering on role too silently
  // dropped those members from this list even though they were never removed from the
  // team (SCRUM-56).
  const currentMembers = allUsers.filter((u) => u.teamId === safeTeam.id);
  const currentMemberIds = new Set(currentMembers.map((m) => m.id));
  const teamManager = safeTeam.type === 'MEMBER'
    ? (allUsers.find((u) => u.id === safeTeam.managerId) ?? null)
    : null;
  // Only completely unassigned users are addable — cannot poach from another team
  const addableUsers = allUsers.filter(
    (u) => !currentMemberIds.has(u.id) && u.role === memberRole && u.teamId === null,
  );
  const q = addSearch.trim().toLowerCase();
  const filteredAddable = q
    ? addableUsers.filter(
        (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
      )
    : addableUsers;

  async function handleRemove(userId: string) {
    setBusy(userId);
    try {
      await updateUser(userId, { teamId: null });
      toast.success(Messages.team.memberRemoved);
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.team.memberRemoveFailed));
    } finally {
      setBusy(null);
    }
  }

  async function handleAdd(userId: string) {
    setBusy(userId);
    try {
      await updateUser(userId, { teamId: safeTeam.id });
      toast.success(Messages.team.memberAddedToTeam);
      onSaved();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.team.memberAddToTeamFailed));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setAddSearch(''); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage members — {safeTeam.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {/* Manager — read-only; use "Change manager" to update */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Manager
            </p>
            {teamManager ? (
              <div className="flex items-center gap-2.5 rounded-lg px-3 py-2 bg-muted/30">
                <Avatar className="w-7 h-7 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                    {initials(teamManager.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{teamManager.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{teamManager.email}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground flex items-center gap-1.5 px-3 py-2">
                <UserCircle2 className="w-4 h-4 shrink-0" />
                No manager — use "Change manager" to assign one
              </p>
            )}
          </div>

          {/* Members — role depends on team type */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {safeTeam.type === 'MANAGER' ? 'Managers' : 'Members · Sales Reps'} ({currentMembers.length})
            </p>
            {currentMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No members yet.</p>
            ) : (
              <ul className="space-y-1">
                {currentMembers.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar className="w-7 h-7 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                          {initials(u.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{u.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={u.role} />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        disabled={busy === u.id}
                        onClick={() => handleRemove(u.id)}
                        title="Remove from team"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Addable users — unassigned only; cannot take from another team */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Add {safeTeam.type === 'MANAGER' ? 'Manager' : 'Sales Rep'}{' '}
              <span className="font-normal normal-case">({addableUsers.length} available)</span>
            </p>
            {addableUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2 px-3">
                No unassigned {safeTeam.type === 'MANAGER' ? 'managers' : 'sales reps'} available.
              </p>
            ) : (
              <>
                {/* Search input — only shown when there are users to search */}
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    className="pl-8 h-8 text-sm"
                    placeholder="Search by name or email…"
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                  />
                </div>

                {filteredAddable.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2 px-3">
                    No results for "{addSearch}".
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {filteredAddable.map((u) => (
                      <li key={u.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-muted/40 transition-colors">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar className="w-7 h-7 shrink-0">
                            <AvatarFallback className="bg-muted text-muted-foreground text-xs font-medium">
                              {initials(u.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{u.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                          disabled={busy === u.id}
                          onClick={() => handleAdd(u.id)}
                          title="Add to team"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
