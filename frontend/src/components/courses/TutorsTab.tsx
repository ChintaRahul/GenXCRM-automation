import { useState } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { EmptyState } from "../shared/EmptyState";
import { cn } from "../../lib/utils";
import type { Tutor } from "../../types";
import { Users } from "lucide-react";

interface TutorsTabProps {
  tutors: Tutor[];
  loading: boolean;
  includeArchived: boolean;
  onToggleArchived: () => void;
  onAdd: (name: string) => void;
  onUpdate: (id: string, patch: { isActive?: boolean }) => void;
}

export function TutorsTab({
  tutors,
  loading,
  includeArchived,
  onToggleArchived,
  onAdd,
  onUpdate,
}: TutorsTabProps) {
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = () => {
    const value = name.trim();
    if (!value) return;
    setAdding(true);
    try {
      onAdd(value);
      setName("");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-2.5 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            placeholder="Tutor name"
            className="h-8 text-xs max-w-xs"
          />
          <Button
            type="button"
            size="sm"
            disabled={adding || !name.trim()}
            onClick={handleAdd}
          >
            + Add tutor
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={onToggleArchived}>
          {includeArchived ? "Hide archived" : "Show archived"}
        </Button>
      </div>

      {loading ? (
        <div className="p-5 space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : tutors.length === 0 ? (
        <EmptyState
          icon={<Users className="w-10 h-10" />}
          title="No tutors yet"
          description="Add a tutor above to assign them to course batches."
        />
      ) : (
        <>
          <div className="flex items-center gap-2.5 px-4 py-2.5 bg-muted/50 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
            <div className="flex-1">Name</div>
            <div className="w-[120px] flex-shrink-0 text-center">Status</div>
            <div className="w-[80px] flex-shrink-0" />
          </div>
          {tutors.map((tutor) => {
            const isArchived = !tutor.isActive;
            return (
              <div
                key={tutor.id}
                className={cn(
                  "flex items-center gap-2.5 px-4 py-2.5 border-t border-border",
                  isArchived && "opacity-60",
                )}
              >
                <div className="flex-1 min-w-0 truncate text-sm font-medium" title={tutor.name}>
                  {tutor.name}
                </div>
                <div className="w-[120px] flex-shrink-0 text-center">
                  <span
                    className={cn(
                      "inline-block text-[10.5px] font-bold px-2.5 py-0.5 rounded-full",
                      isArchived
                        ? "bg-muted text-muted-foreground"
                        : "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-400",
                    )}
                  >
                    {isArchived ? "Archived" : "Active"}
                  </span>
                </div>
                <div className="w-[80px] flex-shrink-0 text-right">
                  <button
                    type="button"
                    onClick={() => onUpdate(tutor.id, { isActive: isArchived })}
                    className="text-[11px] font-semibold text-primary hover:underline"
                  >
                    {isArchived ? "Restore" : "Archive"}
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
