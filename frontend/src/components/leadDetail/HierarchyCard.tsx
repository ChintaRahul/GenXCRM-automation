import { Avatar, AvatarFallback } from "../ui/avatar";
import { useAuth } from "../../context/AuthContext";
import { initials, cn } from "../../lib/utils";
import type { AssignmentChain } from "../../types";

const ROWS: { key: keyof AssignmentChain; label: string }[] = [
  { key: "director", label: "Director" },
  { key: "manager", label: "Manager" },
  { key: "owner", label: "Owner" },
];

export function HierarchyCard({ chain }: { chain: AssignmentChain | undefined }) {
  const { user } = useAuth();
  const rows = ROWS.map((r) => ({ ...r, person: chain?.[r.key] ?? null })).filter(
    (r) => r.person,
  );

  return (
    <div className="bg-card border border-card-border rounded-xl p-4">
      <p className="text-sm font-semibold text-foreground mb-3">Hierarchy</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No hierarchy on record</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((r, i) => {
            const isMe = r.person!.id === user?.id;
            return (
              <div
                key={r.key}
                className="flex items-center gap-2.5"
                style={{ paddingLeft: i * 10 }}
              >
                <Avatar className="w-6 h-6 flex-shrink-0">
                  <AvatarFallback className="text-[9px] bg-primary/10 text-primary font-semibold">
                    {initials(r.person!.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-xs truncate",
                      isMe
                        ? "font-semibold text-foreground"
                        : "font-medium text-foreground",
                    )}
                  >
                    {r.person!.name}
                    {isMe && " (you)"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{r.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
