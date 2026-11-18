import { useState } from "react";
import { Header } from "../components/layout/Header";
import { DailyReportSection } from "../components/reports/DailyReportSection";
import { TeamPerformanceSection } from "../components/reports/team/TeamPerformanceSection";
import { cn } from "../lib/utils";

type ReportsTab = "daily" | "team";

const TABS: { key: ReportsTab; label: string }[] = [
  { key: "daily", label: "Daily Report" },
  { key: "team", label: "Team Performance" },
];

export default function ReportsPage() {
  const [tab, setTab] = useState<ReportsTab>("daily");

  return (
    <>
      <Header
        title="Reports"
        subtitle={
          tab === "daily"
            ? "Daily Sales & Lead Management Report — calling, enrollment, and campaign performance"
            : "Sales rep productivity, source conversion, and team leaderboard"
        }
      />
      <div className="p-4 sm:p-6 space-y-6">
        <div className="flex gap-0 border-b border-border">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
                tab === key
                  ? "text-foreground border-primary"
                  : "text-muted-foreground border-transparent hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "team" && <TeamPerformanceSection />}
        {tab === "daily" && <DailyReportSection />}
      </div>
    </>
  );
}
