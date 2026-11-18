import { useState } from "react";
import {
  AlertTriangle,
  Plus,
  Search,
  Edit2,
  UserX,
  Users as UsersIcon,
  Mail,
  ShieldOff,
} from "lucide-react";
import { toast } from "sonner";
import { apiErrorMessage } from "../lib/apiError";
import { Messages } from "../lib/messages";
import { cn } from "../lib/utils";
import type { Role, Team, User } from "../types";
import { deleteUser, deleteTeam, resendInvite, resetUserMfa } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useUsers } from "../hooks/useUsers";
import { useTeams } from "../hooks/useTeams";
import { Header } from "../components/layout/Header";
import { StatusBadge } from "../components/shared/StatusBadge";
import { EmptyState } from "../components/shared/EmptyState";
import { TeamCard } from "../components/team/TeamCard";
import { CreateTeamDialog } from "../components/team/CreateTeamDialog";
import { AddMemberDialog } from "../components/team/AddMemberDialog";
import { EditMemberDialog } from "../components/team/EditMemberDialog";
import { RenameTeamDialog } from "../components/team/RenameTeamDialog";
import { ChangeManagerDialog } from "../components/team/ChangeManagerDialog";
import { ManageMembersDialog } from "../components/team/ManageMembersDialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Skeleton } from "../components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";

const ROLE_LABELS: Record<Role, string> = {
  DIRECTOR: "Director",
  MANAGER: "Manager",
  SALES_REP: "Sales Rep",
};

const ALL_ROLES: Role[] = ["DIRECTOR", "MANAGER", "SALES_REP"];

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const [tab, setTab] = useState<"teams" | "members">("teams");
  const { teams, loading: teamsLoading, refetch: refetchTeams } = useTeams();
  const { users, loading: usersLoading, refetch: refetchUsers } = useUsers();

  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [editMember, setEditMember] = useState<User | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resetMfaTarget, setResetMfaTarget] = useState<User | null>(null);
  const [resettingMfa, setResettingMfa] = useState(false);

  const [renameTarget, setRenameTarget] = useState<Team | null>(null);
  const [changeManagerTarget, setChangeManagerTarget] = useState<Team | null>(null);
  const [manageMembersTarget, setManageMembersTarget] = useState<Team | null>(null);
  const [deleteTeamTarget, setDeleteTeamTarget] = useState<Team | null>(null);
  const [deletingTeam, setDeletingTeam] = useState(false);

  const [memberSearch, setMemberSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "ALL">("ALL");

  const isDirector = me?.role === "DIRECTOR";
  const isManager = me?.role === "MANAGER";
  const canManage = isDirector || isManager;

  const managers = users.filter((u) => u.role === "MANAGER");
  const unassignedReps = users.filter(
    (u) => u.role === "SALES_REP" && !u.teamId,
  );

  // Manager sees teams they belong to OR teams they manage (via managerId)
  const visibleTeams = isDirector
    ? teams
    : teams.filter((t) => t.id === me?.teamId || t.managerId === me?.id);

  // For Members tab: Manager sees users from all teams they own or manage
  const myTeamIds = isManager
    ? new Set(visibleTeams.map((t) => t.id))
    : null;

  const visibleMembers = users.filter((u) => {
    if (isManager) {
      // Show: users in managed teams OR unassigned users (available for recruitment)
      const inManagedTeam = u.teamId !== null && (myTeamIds?.has(u.teamId) ?? false);
      const isUnassigned = u.teamId === null;
      if (!inManagedTeam && !isUnassigned) return false;
    }
    const matchSearch =
      memberSearch.trim() === "" ||
      u.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(memberSearch.toLowerCase());
    const matchRole = roleFilter === "ALL" || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  async function handleDeactivate() {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      await deleteUser(deactivateTarget.id);
      toast.success(Messages.users.deactivated(deactivateTarget.name));
      setDeactivateTarget(null);
      refetchUsers();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.users.deactivateFailed));
    } finally {
      setDeactivating(false);
    }
  }

  async function handleResendInvite(target: User) {
    setResendingId(target.id);
    try {
      await resendInvite(target.id);
      toast.success(Messages.users.inviteResent(target.name));
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.users.resendInviteFailed));
    } finally {
      setResendingId(null);
    }
  }

  async function handleResetMfa() {
    if (!resetMfaTarget) return;
    setResettingMfa(true);
    try {
      await resetUserMfa(resetMfaTarget.id);
      toast.success(Messages.users.mfaReset(resetMfaTarget.name));
      setResetMfaTarget(null);
      refetchUsers();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.users.mfaResetFailed));
    } finally {
      setResettingMfa(false);
    }
  }

  async function handleDeleteTeam() {
    if (!deleteTeamTarget) return;
    setDeletingTeam(true);
    try {
      await deleteTeam(deleteTeamTarget.id);
      toast.success(Messages.users.teamDeleted(deleteTeamTarget.name));
      setDeleteTeamTarget(null);
      refetchTeams();
      refetchUsers();
    } catch (err) {
      toast.error(apiErrorMessage(err, Messages.users.teamDeleteFailed));
    } finally {
      setDeletingTeam(false);
    }
  }

  return (
    <>
      <Header
        title="Team Management"
        subtitle={`${users.length} members · ${teams.length} teams`}
        actions={
          canManage ? (
            <div className="flex items-center gap-2">
              {canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreateTeam(true)}
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  New team
                </Button>
              )}
              <Button size="sm" onClick={() => setShowAddMember(true)}>
                <Plus className="w-4 h-4 mr-1.5" />
                Add member
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="p-4 sm:p-6 space-y-5">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-card-border">
          {(["teams", "members"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                "px-4 py-2 max-[767px]:min-h-11 text-sm font-medium capitalize transition-colors",
                tab === t
                  ? "text-foreground border-b-2 border-primary -mb-px"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "teams" && (
          <>
            {/* Unassigned reps alert */}
            {unassignedReps.length > 0 && (
              <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  {unassignedReps.length} rep
                  {unassignedReps.length > 1 ? "s are" : " is"} not assigned to
                  any team.
                </span>
              </div>
            )}

            {teamsLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="bg-card border border-card-border rounded-xl p-5 space-y-3"
                  >
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-32" />
                    <div className="flex gap-1">
                      <Skeleton className="w-7 h-7 rounded-full" />
                      <Skeleton className="w-7 h-7 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : visibleTeams.length === 0 ? (
              <EmptyState
                title="No teams yet"
                description="Create your first team to organise your sales reps."
                icon={<UsersIcon className="w-6 h-6" />}
                action={
                  isDirector ? (
                    <Button size="sm" onClick={() => setShowCreateTeam(true)}>
                      <Plus className="w-4 h-4 mr-1" />
                      New team
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleTeams.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    canEdit={isDirector}
                    canManageMembers={isDirector || (isManager && (team.id === me?.teamId || team.managerId === me?.id))}
                    onRename={() => setRenameTarget(team)}
                    onChangeManager={() => setChangeManagerTarget(team)}
                    onManageMembers={() => setManageMembersTarget(team)}
                    onDelete={() => setDeleteTeamTarget(team)}
                  />
                ))}
                {isDirector && (
                  <button
                    onClick={() => setShowCreateTeam(true)}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-card-border p-8 text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
                  >
                    <Plus className="w-6 h-6" />
                    <span className="text-sm font-medium">Create team</span>
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {tab === "members" && (
          <>
            {/* Search + role filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search by name or email…"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                />
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setRoleFilter("ALL")}
                  className={[
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                    roleFilter === "ALL"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  All
                </button>
                {ALL_ROLES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRoleFilter(r)}
                    className={[
                      "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                      roleFilter === r
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {ROLE_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>

            {usersLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 px-4 py-3 rounded-xl bg-card border border-card-border"
                  >
                    <Skeleton className="w-9 h-9 rounded-full" />
                    <div className="space-y-1.5 flex-1">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-28" />
                    </div>
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ))}
              </div>
            ) : visibleMembers.length === 0 ? (
              <EmptyState
                title="No members found"
                description="Try adjusting the search or filter."
                icon={<UsersIcon className="w-6 h-6" />}
              />
            ) : (
              <>
                <div className="rounded-xl border border-card-border overflow-hidden hidden md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-card-border bg-muted/40">
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">
                        Member
                      </th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">
                        Role
                      </th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium hidden md:table-cell">
                        Team
                      </th>
                      {canManage && (
                        <th className="text-right px-4 py-3 text-muted-foreground font-medium">
                          Actions
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleMembers.map((u) => (
                      <tr
                        key={u.id}
                        onClick={isDirector ? () => setEditMember(u) : undefined}
                        className={cn(
                          "border-b border-card-border last:border-0 hover:bg-muted/20 transition-colors",
                          isDirector && "cursor-pointer",
                        )}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar className="w-9 h-9">
                              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                                {initials(u.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-foreground truncate max-w-[160px]" title={u.name}>
                                {u.name}
                              </p>
                              <p className="text-xs text-muted-foreground truncate max-w-[160px]" title={u.email}>
                                {u.email}
                              </p>
                              {u.pending && (
                                <span className="inline-flex items-center text-xs font-medium text-sky-600 dark:text-sky-400 bg-sky-500/10 rounded-full px-2 py-0.5 mt-1">
                                  Invite pending
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={u.role} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                          {u.team?.name ?? (
                            <span className="inline-flex items-center text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-full px-2 py-0.5">
                              Unassigned
                            </span>
                          )}
                        </td>
                        {canManage && (
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              {u.pending && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                  onClick={() => handleResendInvite(u)}
                                  disabled={resendingId === u.id}
                                  title="Resend invite"
                                >
                                  <Mail className="w-4 h-4" />
                                </Button>
                              )}
                              {isDirector && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                    onClick={() => setEditMember(u)}
                                    title="Edit member"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </Button>
                                  {u.mfaConfigured && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                      onClick={() => setResetMfaTarget(u)}
                                      title="Reset MFA"
                                    >
                                      <ShieldOff className="w-4 h-4" />
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    onClick={() => setDeactivateTarget(u)}
                                    title="Deactivate member"
                                  >
                                    <UserX className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>

                {/* Mobile member cards — same data as the table above */}
                <div className="md:hidden space-y-2">
                  {visibleMembers.map((u) => (
                    <div
                      key={u.id}
                      onClick={isDirector ? () => setEditMember(u) : undefined}
                      className={cn(
                        "bg-card border border-card-border rounded-xl p-4 flex items-center gap-3",
                        isDirector && "cursor-pointer",
                      )}
                    >
                      <Avatar className="w-10 h-10 flex-shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                          {initials(u.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p
                          className="font-medium text-foreground truncate"
                          title={u.name}
                        >
                          {u.name}
                        </p>
                        <p
                          className="text-xs text-muted-foreground truncate"
                          title={u.email}
                        >
                          {u.email}
                        </p>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <StatusBadge status={u.role} />
                          {u.pending && (
                            <span className="inline-flex items-center text-xs font-medium text-sky-600 dark:text-sky-400 bg-sky-500/10 rounded-full px-2 py-0.5">
                              Invite pending
                            </span>
                          )}
                        </div>
                      </div>
                      {canManage && (
                        <div
                          className="flex items-center gap-1 flex-shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {u.pending && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-11 w-11 text-muted-foreground hover:text-foreground"
                              onClick={() => handleResendInvite(u)}
                              disabled={resendingId === u.id}
                              title="Resend invite"
                            >
                              <Mail className="w-4 h-4" />
                            </Button>
                          )}
                          {isDirector && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-11 w-11 text-muted-foreground hover:text-foreground"
                                onClick={() => setEditMember(u)}
                                title="Edit member"
                              >
                                <Edit2 className="w-4 h-4" />
                              </Button>
                              {u.mfaConfigured && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-11 w-11 text-muted-foreground hover:text-foreground"
                                  onClick={() => setResetMfaTarget(u)}
                                  title="Reset MFA"
                                >
                                  <ShieldOff className="w-4 h-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-11 w-11 text-muted-foreground hover:text-destructive"
                                onClick={() => setDeactivateTarget(u)}
                                title="Deactivate member"
                              >
                                <UserX className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Dialogs */}
      <CreateTeamDialog
        open={showCreateTeam}
        onOpenChange={setShowCreateTeam}
        managers={managers}
        callerRole={me?.role ?? "SALES_REP"}
        onCreated={() => {
          refetchTeams();
          refetchUsers();
        }}
      />

      <AddMemberDialog
        open={showAddMember}
        onOpenChange={setShowAddMember}
        teams={teams}
        callerRole={me?.role ?? "SALES_REP"}
        callerTeamId={me?.teamId ?? null}
        onCreated={() => {
          refetchUsers();
          refetchTeams();
        }}
      />

      <EditMemberDialog
        user={editMember}
        open={editMember !== null}
        onOpenChange={(v) => { if (!v) setEditMember(null); }}
        teams={teams}
        callerRole={me?.role ?? "SALES_REP"}
        callerTeamId={me?.teamId ?? null}
        onSaved={() => {
          refetchUsers();
          refetchTeams();
        }}
      />

      {/* Team action dialogs */}
      <RenameTeamDialog
        team={renameTarget}
        open={renameTarget !== null}
        onOpenChange={(v) => { if (!v) setRenameTarget(null); }}
        onSaved={() => { refetchTeams(); refetchUsers(); }}
      />

      <ChangeManagerDialog
        team={changeManagerTarget}
        open={changeManagerTarget !== null}
        onOpenChange={(v) => { if (!v) setChangeManagerTarget(null); }}
        managers={managers}
        onSaved={() => { refetchTeams(); }}
      />

      <ManageMembersDialog
        team={manageMembersTarget}
        open={manageMembersTarget !== null}
        onOpenChange={(v) => { if (!v) setManageMembersTarget(null); }}
        allUsers={users}
        onSaved={() => { refetchTeams(); refetchUsers(); }}
      />

      {/* Delete team confirm */}
      <Dialog
        open={deleteTeamTarget !== null}
        onOpenChange={(v) => { if (!v) setDeleteTeamTarget(null); }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete team</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete{" "}
            <strong className="text-foreground">"{deleteTeamTarget?.name}"</strong>?
            Members will be unassigned but not deactivated.
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setDeleteTeamTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deletingTeam} onClick={handleDeleteTeam}>
              {deletingTeam ? "Deleting…" : "Delete team"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Deactivate member confirm dialog */}
      <Dialog
        open={deactivateTarget !== null}
        onOpenChange={(v) => { if (!v) setDeactivateTarget(null); }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Deactivate member</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to deactivate{" "}
            <strong className="text-foreground">{deactivateTarget?.name}</strong>?
            They will lose access to the CRM.
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="outline"
              onClick={() => setDeactivateTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deactivating}
              onClick={handleDeactivate}
            >
              {deactivating ? "Deactivating…" : "Deactivate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset MFA confirm dialog */}
      <Dialog
        open={resetMfaTarget !== null}
        onOpenChange={(v) => { if (!v) setResetMfaTarget(null); }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset MFA</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Turn off two-factor authentication for{" "}
            <strong className="text-foreground">{resetMfaTarget?.name}</strong>? They'll need to set
            it up again the next time it's required.
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setResetMfaTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={resettingMfa} onClick={handleResetMfa}>
              {resettingMfa ? "Resetting…" : "Reset MFA"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
