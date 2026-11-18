import { useState } from "react";
import { Search } from "lucide-react";
import { FilterDropdown } from "../../filters/FilterDropdown";
import { FilterSectionHeader } from "../../filters/FilterSectionHeader";
import { Input } from "../../ui/input";
import { Avatar, AvatarFallback } from "../../ui/avatar";
import { initials } from "../../../lib/utils";
import type { AssignableUser } from "../../../hooks/useAssignableUsers";

interface OwnerFilterListProps {
  users: AssignableUser[];
  value: string[];
  onChange: (next: string[]) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function triggerLabel(users: AssignableUser[], value: string[]): string {
  if (value.length === 0) return "Any owner";
  if (value.length === 1) {
    return users.find((u) => u.id === value[0])?.name ?? value[0];
  }
  return `${value.length} owners selected`;
}

export function OwnerFilterList({
  users,
  value,
  onChange,
  open,
  onToggle,
  onClose,
}: OwnerFilterListProps) {
  const [query, setQuery] = useState("");

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const filtered = users.filter(
    (u) =>
      u.name.toLowerCase().includes(query.toLowerCase()) ||
      u.role.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div>
      <FilterSectionHeader title="Owner" onReset={() => onChange([])} />
      <FilterDropdown
        triggerLabel={triggerLabel(users, value)}
        open={open}
        onToggle={onToggle}
        onClose={onClose}
      >
        <div className="flex items-center gap-2 bg-muted rounded-md px-2.5 py-1.5 mb-1.5">
          <Search className="w-3 h-3 text-muted-foreground shrink-0" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search team…"
            className="border-0 bg-transparent p-0 h-auto text-xs focus-visible:ring-0 shadow-none"
          />
        </div>
        <div className="flex flex-col gap-0.5 max-h-[220px] overflow-y-auto">
          {filtered.map((u) => (
            <label
              key={u.id}
              className="flex items-center gap-2.5 py-1.5 px-1 rounded-md cursor-pointer hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={value.includes(u.id)}
                onChange={() => toggle(u.id)}
                className="accent-primary w-3.5 h-3.5 shrink-0"
              />
              <Avatar className="w-6 h-6 shrink-0">
                <AvatarFallback className="text-[9px] bg-primary/10 text-primary font-semibold">
                  {initials(u.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate">{u.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{u.role}</p>
              </div>
            </label>
          ))}
          {filtered.length === 0 && (
            <p className="text-[11px] text-muted-foreground text-center py-2">
              No teammate matches "{query}"
            </p>
          )}
        </div>
      </FilterDropdown>
    </div>
  );
}
