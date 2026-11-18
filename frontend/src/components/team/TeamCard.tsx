import { useState } from 'react';
import { MoreVertical, UserCircle2, Users, Briefcase } from 'lucide-react';
import type { Team } from '../../types';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

interface TeamCardProps {
  team: Team;
  /** Director only — rename, change manager, delete */
  canEdit: boolean;
  /** Director OR Manager of this team — manage members */
  canManageMembers: boolean;
  onRename: () => void;
  onChangeManager: () => void;
  onManageMembers: () => void;
  onDelete: () => void;
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const MENU_ITEM_CLS =
  'w-full text-left px-3 py-2 text-sm rounded hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export function TeamCard({ team, canEdit, canManageMembers, onRename, onChangeManager, onManageMembers, onDelete }: TeamCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const visibleMembers = team.members.slice(0, 5);
  const overflow = team.members.length - visibleMembers.length;

  function menuAction(cb: () => void) {
    setMenuOpen(false);
    cb();
  }

  return (
    <div className="bg-card border border-card-border rounded-xl p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1 min-w-0 pr-2">
          <h3 className="font-semibold text-foreground truncate">{team.name}</h3>
          <span className={cn(
            'inline-flex items-center gap-1 text-xs font-medium w-fit rounded-full px-2 py-0.5',
            team.type === 'MANAGER'
              ? 'bg-chart-2/10 text-chart-2'
              : 'bg-primary/10 text-primary',
          )}>
            {team.type === 'MANAGER'
              ? <><Briefcase className="w-3 h-3" />Manager team</>
              : <><Users className="w-3 h-3" />Member team</>
            }
          </span>
        </div>
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground"
              aria-label="Team actions"
            >
              <MoreVertical className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-44 p-1">
            <button
              className={MENU_ITEM_CLS}
              disabled={!canEdit}
              onClick={() => menuAction(onRename)}
            >
              Edit
            </button>
            <button
              className={MENU_ITEM_CLS}
              disabled={!canManageMembers}
              onClick={() => menuAction(onManageMembers)}
            >
              Manage members
            </button>
            <button
              className={MENU_ITEM_CLS}
              disabled={!canEdit}
              onClick={() => menuAction(onChangeManager)}
            >
              {team.manager ? 'Change manager' : 'Assign manager'}
            </button>
            <button
              className={cn(MENU_ITEM_CLS, 'text-destructive hover:bg-destructive/10')}
              disabled={!canEdit}
              onClick={() => menuAction(onDelete)}
            >
              Delete
            </button>
          </PopoverContent>
        </Popover>
      </div>

      {/* Manager */}
      <div className="flex items-center gap-2">
        {team.manager ? (
          <>
            <Avatar className="w-6 h-6">
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                {initials(team.manager.name)}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm text-muted-foreground truncate">{team.manager.name}</span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground flex items-center gap-1.5">
            <UserCircle2 className="w-4 h-4" />
            No manager assigned
          </span>
        )}
      </div>

      {/* Member avatar stack */}
      {team.members.length > 0 ? (
        <div className="flex items-center gap-1">
          {visibleMembers.map((m) => (
            <Avatar key={m.id} title={m.name} className="w-7 h-7 -ml-1 first:ml-0 ring-2 ring-card">
              <AvatarFallback className="bg-muted text-muted-foreground text-xs font-medium">
                {initials(m.name)}
              </AvatarFallback>
            </Avatar>
          ))}
          {overflow > 0 && (
            <span className="text-xs text-muted-foreground ml-1.5">+{overflow}</span>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No members yet</p>
      )}

      {/* Stats row — placeholder until leaderboard endpoint supports per-team stats */}
      {/* TODO(backend): wire up per-team leads/enrolled/revenue once leaderboard endpoint supports it */}
      <div className="flex items-center gap-4 pt-1 border-t border-card-border text-xs text-muted-foreground">
        <span>Leads: <strong className="text-foreground">—</strong></span>
        <span>Enrolled: <strong className="text-foreground">—</strong></span>
        <span>Revenue: <strong className="text-foreground">—</strong></span>
      </div>
    </div>
  );
}
