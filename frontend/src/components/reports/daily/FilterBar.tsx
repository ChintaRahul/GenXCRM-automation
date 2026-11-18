import type { CampaignOption, DailyReportFilter } from "../../../api/client";
import { Input } from "../../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";

const ALL_TEAM_MEMBERS = "__all__";
const ALL_CAMPAIGNS = "__all__";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function quickRange(key: "today" | "yesterday" | "7d" | "month"): { from: string; to: string } {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (key === "today") return { from: isoDate(today), to: isoDate(today) };
  if (key === "yesterday") {
    const y = new Date(today);
    y.setUTCDate(y.getUTCDate() - 1);
    return { from: isoDate(y), to: isoDate(y) };
  }
  if (key === "7d") {
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 6);
    return { from: isoDate(from), to: isoDate(today) };
  }
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return { from: isoDate(from), to: isoDate(today) };
}

const QUICK_RANGES: { key: "today" | "yesterday" | "7d" | "month"; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "month", label: "This month" },
];

interface FilterBarProps {
  filters: DailyReportFilter;
  setFilters: (next: Partial<DailyReportFilter>) => void;
  salesReps: { id: string; name: string }[];
  campaignOptions: CampaignOption[];
}

export function FilterBar({ filters, setFilters, salesReps, campaignOptions }: FilterBarProps) {
  return (
    <div className="bg-card border border-card-border rounded-xl grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end shadow-sm p-5">
      <div className="min-w-0">
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
          From
        </label>
        <Input
          type="date"
          value={filters.from}
          onChange={(e) => setFilters({ from: e.target.value })}
          className="w-full sm:w-[148px]"
        />
      </div>
      <div className="min-w-0">
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
          To
        </label>
        <Input
          type="date"
          value={filters.to}
          onChange={(e) => setFilters({ to: e.target.value })}
          className="w-full sm:w-[148px]"
        />
      </div>
      <div className="col-span-2 sm:col-span-1 min-w-0">
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
          Team member
        </label>
        <Select
          value={filters.teamMemberId ?? ALL_TEAM_MEMBERS}
          onValueChange={(v) => setFilters({ teamMemberId: v === ALL_TEAM_MEMBERS ? undefined : v })}
        >
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-[300px]">
            <SelectItem value={ALL_TEAM_MEMBERS}>All team members</SelectItem>
            {salesReps.map((rep) => (
              <SelectItem key={rep.id} value={rep.id}>
                {rep.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2 sm:col-span-1 min-w-0">
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
          Campaign
        </label>
        <Select
          value={filters.campaignId ?? ALL_CAMPAIGNS}
          onValueChange={(v) => setFilters({ campaignId: v === ALL_CAMPAIGNS ? undefined : v })}
        >
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue className="truncate min-w-0" />
          </SelectTrigger>
          <SelectContent className="max-h-[300px]">
            <SelectItem value={ALL_CAMPAIGNS}>All campaigns</SelectItem>
            {campaignOptions.map((c) => (
              <SelectItem key={c.id} value={c.id} title={c.name}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2 flex gap-1.5 sm:ml-auto flex-wrap">
        {QUICK_RANGES.map((r) => {
          const range = quickRange(r.key);
          const isActive = filters.from === range.from && filters.to === range.to;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => setFilters(range)}
              aria-pressed={isActive}
              className={`px-2.5 py-1.5 max-[767px]:py-2.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-card-border text-muted-foreground hover:text-foreground hover:border-primary/50"
              }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
