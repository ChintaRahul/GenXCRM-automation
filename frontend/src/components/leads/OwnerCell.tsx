import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Search } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "../ui/popover";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Input } from "../ui/input";
import { StatusBadge } from "../shared/StatusBadge";
import { cn, initials } from "../../lib/utils";
import type { AssignableUser } from "../../hooks/useAssignableUsers";

interface OwnerCellProps {
  value: { id: string; name: string } | null;
  onChange: (userId: string | null) => Promise<void> | void;
  users: AssignableUser[];
  readonly?: boolean;
}

export function OwnerCell({
  value,
  onChange,
  users,
  readonly = false,
}: OwnerCellProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // When the dropdown opens, scroll the currently-selected owner into view —
  // otherwise reps further down the list stay hidden below the fold.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const el = selectedRef.current;
      const container = listRef.current;
      if (!el || !container) return;
      const elRect = el.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      container.scrollTop +=
        elRect.top - cRect.top - (container.clientHeight - el.clientHeight) / 2;
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(query.toLowerCase()) ||
      u.role.toLowerCase().includes(query.toLowerCase()),
  );

  const handleSelect = async (userId: string | null) => {
    setOpen(false);
    setQuery("");
    await onChange(userId);
  };

  const display = (
    <div className="inline-flex items-center gap-1.5">
      {value ? (
        <>
          <Avatar className="w-5 h-5 shrink-0">
            <AvatarFallback className="text-[9px] bg-primary/10 text-primary font-semibold">
              {initials(value.name)}
            </AvatarFallback>
          </Avatar>
          <span
            className="text-sm text-foreground truncate max-w-[120px]"
            title={value.name}
          >
            {value.name}
          </span>
        </>
      ) : (
        <StatusBadge status="UNASSIGNED" />
      )}
      {!readonly && (
        <ChevronDown className="w-3 h-3 text-muted-foreground" />
      )}
    </div>
  );

  if (readonly) return display;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="hover:bg-muted rounded-md px-1.5 py-1 -ml-1.5 transition-colors"
          title="Click to reassign"
        >
          {display}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,260px)]">
        <div className="flex items-center gap-2 bg-muted rounded-md px-2.5 py-1.5 mb-1.5">
          <Search className="w-3 h-3 text-muted-foreground shrink-0" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search team…"
            className="border-0 bg-transparent p-0 h-auto text-xs focus-visible:ring-0 shadow-none"
          />
        </div>
        <div ref={listRef} className="max-h-[240px] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-[11px] text-muted-foreground text-center">
              No teammate matches "{query}"
            </p>
          ) : (
            filtered.map((u) => {
              const selected = u.id === value?.id;
              return (
                <button
                  key={u.id}
                  ref={selected ? selectedRef : undefined}
                  type="button"
                  onClick={() => void handleSelect(u.id)}
                  className={cn(
                    "flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md text-left transition-colors",
                    selected ? "bg-primary/10" : "hover:bg-muted",
                  )}
                >
                  <div className="relative shrink-0">
                    <Avatar className="w-6 h-6">
                      <AvatarFallback className="text-[9px] bg-primary/10 text-primary font-semibold">
                        {initials(u.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      className={cn(
                        "absolute -right-0.5 -bottom-0.5 w-2 h-2 rounded-full border-2 border-card",
                        u.online ? "bg-chart-2" : "bg-muted-foreground",
                      )}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">
                      {u.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-px truncate">
                      {u.role}
                      {u.openLeads > 0 && (
                        <>
                          {" · "}
                          <span
                            className={
                              u.openLeads > 30 ? "text-chart-3" : ""
                            }
                          >
                            {u.openLeads} open
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  {selected && (
                    <Check
                      className="w-3.5 h-3.5 text-primary shrink-0"
                      strokeWidth={2.5}
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="my-1.5 border-t border-card-border" />
        <button
          type="button"
          onClick={() => void handleSelect(null)}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-muted transition-colors"
        >
          <StatusBadge status="UNASSIGNED" />
          <span className="text-xs text-muted-foreground">
            Remove assignment
          </span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
