import { Download } from "lucide-react";
import type { Team } from "../../../types";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";

const ALL_TEAMS = "__all__";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function quickRange(key: "7d" | "30d" | "month"): { from: string; to: string } {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (key === "7d") {
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 6);
    return { from: isoDate(from), to: isoDate(today) };
  }
  if (key === "30d") {
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 29);
    return { from: isoDate(from), to: isoDate(today) };
  }
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return { from: isoDate(from), to: isoDate(today) };
}

const QUICK_RANGES: { key: "7d" | "30d" | "month"; label: string }[] = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
];

export interface TeamPerformanceFilters {
  from?: string;
  to?: string;
  teamId?: string;
  repSearch: string;
}

interface TeamPerformanceFilterBarProps {
  filters: TeamPerformanceFilters;
  setFilters: (next: Partial<TeamPerformanceFilters>) => void;
  teams: Team[];
  onExport: () => void;
}

export function TeamPerformanceFilterBar({ filters, setFilters, teams, onExport }: TeamPerformanceFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="date"
        value={filters.from ?? ""}
        onChange={(e) => setFilters({ from: e.target.value || undefined })}
        className="w-[148px] h-[34px] text-xs"
        aria-label="From date"
      />
      <Input
        type="date"
        value={filters.to ?? ""}
        onChange={(e) => setFilters({ to: e.target.value || undefined })}
        className="w-[148px] h-[34px] text-xs"
        aria-label="To date"
      />
      <div className="flex gap-1.5">
        {QUICK_RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setFilters(quickRange(r.key))}
            aria-pressed={filters.from === quickRange(r.key).from && filters.to === quickRange(r.key).to}
            className={`px-2.5 h-[34px] rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
              filters.from === quickRange(r.key).from && filters.to === quickRange(r.key).to
                ? "border-primary bg-primary text-primary-foreground"
                : "border-card-border text-muted-foreground hover:text-foreground hover:border-primary/50"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <Select
        value={filters.teamId ?? ALL_TEAMS}
        onValueChange={(v) => setFilters({ teamId: v === ALL_TEAMS ? undefined : v })}
      >
        <SelectTrigger className="w-[160px] h-[34px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-[300px]">
          <SelectItem value={ALL_TEAMS}>All teams</SelectItem>
          {teams.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        placeholder="Search rep…"
        value={filters.repSearch}
        onChange={(e) => setFilters({ repSearch: e.target.value })}
        className="w-[180px] h-[34px] text-xs"
      />
      <Button variant="outline" size="sm" className="ml-auto h-[34px]" onClick={onExport}>
        <Download className="w-3.5 h-3.5 mr-1.5" />
        Export
      </Button>
    </div>
  );
}
