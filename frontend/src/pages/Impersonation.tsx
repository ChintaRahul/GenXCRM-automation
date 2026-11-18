import { useState } from "react";
import { toast } from "sonner";
import { Search, UserCog, Users as UsersIcon } from "lucide-react";
import { useImpersonatableUsers } from "../hooks/useImpersonatableUsers";
import { useImpersonation } from "../hooks/useImpersonation";
import { Header } from "../components/layout/Header";
import { StatusBadge } from "../components/shared/StatusBadge";
import { EmptyState } from "../components/shared/EmptyState";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Skeleton } from "../components/ui/skeleton";
import { initials } from "../lib/utils";

export default function ImpersonationPage() {
  const { users, loading } = useImpersonatableUsers();
  const { impersonate, loading: impersonating } = useImpersonation();
  const [search, setSearch] = useState("");

  const visibleUsers = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.org?.name.toLowerCase().includes(q) ?? false)
    );
  });

  const handleImpersonate = async (userId: string) => {
    const error = await impersonate(userId);
    if (error) toast.error(error);
  };

  return (
    <>
      <Header
        title="Impersonation"
        subtitle="Log in as any user across the system to reproduce what they see."
      />

      <div className="p-4 sm:p-6 space-y-5">
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name, email, or org…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
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
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            ))}
          </div>
        ) : visibleUsers.length === 0 ? (
          <EmptyState
            title="No users found"
            description="Try adjusting the search."
            icon={<UsersIcon className="w-6 h-6" />}
          />
        ) : (
          <div className="rounded-xl border border-card-border overflow-hidden">
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
                    Organization
                  </th>
                  <th className="text-right px-4 py-3 text-muted-foreground font-medium">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-card-border last:border-0 hover:bg-muted/20 transition-colors"
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
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={u.role} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell truncate max-w-[180px]" title={u.org?.name ?? "—"}>
                      {u.org?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={impersonating}
                        onClick={() => void handleImpersonate(u.id)}
                      >
                        <UserCog className="w-4 h-4 mr-1.5" />
                        Impersonate
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
