import { Users, Star, Clock, CalendarCheck2, GraduationCap, IndianRupee, Phone } from "lucide-react";
import type { DailyDashboard } from "../../../api/client";
import { StatCard } from "../../shared/StatCard";
import { SectionHeader } from "./SectionHeader";
import { formatDelta } from "./formatters";
import { cn } from "../../../lib/utils";

interface DashboardKpisProps {
  dashboard: { data: DailyDashboard | null; loading: boolean };
  leadsLink: (params: Record<string, string>) => string;
}

const DELTA_TONE_TEXT: Record<"positive" | "negative" | "neutral", string> = {
  positive: "text-success",
  negative: "text-destructive",
  neutral: "text-muted-foreground",
};

export function DashboardKpis({ dashboard, leadsLink }: DashboardKpisProps) {
  const d = dashboard.data;
  const loading = dashboard.loading;
  const revenueDelta = formatDelta(d?.revenueDelta ?? null);

  return (
    <section>
      <SectionHeader number="10" title="Daily dashboard" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          title="Total leads"
          value={loading ? "—" : (d?.totalLeads ?? 0)}
          icon={<Users className="w-5 h-5" />}
          loading={loading}
          topBorderColor="border-t-primary"
          valueSize="xl"
          delta={formatDelta(d?.totalLeadsDelta ?? null)}
          to={leadsLink({})}
        />
        <StatCard
          title="Interested"
          value={loading ? "—" : (d?.interestedLeads ?? 0)}
          icon={<Star className="w-5 h-5" />}
          loading={loading}
          topBorderColor="border-t-chart-2"
          valueSize="xl"
          delta={formatDelta(d?.interestedLeadsDelta ?? null)}
          to={leadsLink({ stage: "INTERESTED" })}
        />
        <StatCard
          title="Follow-up"
          value={loading ? "—" : (d?.followUpLeads ?? 0)}
          icon={<Clock className="w-5 h-5" />}
          loading={loading}
          topBorderColor="border-t-chart-3"
          valueSize="xl"
          delta={formatDelta(d?.followUpLeadsDelta ?? null)}
          to={leadsLink({ stage: "FOLLOW_UP_REQUIRED" })}
        />
        <StatCard
          title="Demo scheduled"
          value={loading ? "—" : (d?.demoScheduled ?? 0)}
          icon={<CalendarCheck2 className="w-5 h-5" />}
          loading={loading}
          topBorderColor="border-t-chart-4"
          valueSize="xl"
          delta={formatDelta(d?.demoScheduledDelta ?? null)}
          to={leadsLink({ stage: "DEMO_SCHEDULED" })}
        />
        <StatCard
          title="Enrollments"
          value={loading ? "—" : (d?.enrollments ?? 0)}
          icon={<GraduationCap className="w-5 h-5" />}
          loading={loading}
          topBorderColor="border-t-success"
          valueSize="xl"
          delta={formatDelta(d?.enrollmentsDelta ?? null)}
          to={leadsLink({ stage: "ENROLLED" })}
        />
        <StatCard
          title="Total calls (est.)"
          value={loading ? "—" : (d?.totalCalls ?? 0)}
          icon={<Phone className="w-5 h-5" />}
          loading={loading}
          topBorderColor="border-t-chart-5"
          valueSize="xl"
          delta={formatDelta(d?.totalCallsDelta ?? null)}
        />
        <div className="bg-card border border-card-border border-t-[3px] border-t-success rounded-xl p-5 hover:shadow-md transition-shadow">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[.07em]">Revenue</p>
          <p className="font-display font-bold text-[30px] text-foreground mt-1 tabular-nums tracking-tight flex items-center gap-1">
            <IndianRupee className="w-6 h-6" />
            {loading ? "—" : (d?.revenue ?? 0).toLocaleString("en-IN")}
          </p>
          <p className={cn("text-xs font-semibold mt-1", DELTA_TONE_TEXT[revenueDelta.tone])}>{revenueDelta.text}</p>
        </div>
        <div className="bg-card border border-card-border border-t-[3px] border-t-chart-1 rounded-xl p-5 hover:shadow-md transition-shadow">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[.07em]">Avg ticket size</p>
          <p className="font-display font-bold text-[30px] text-foreground mt-1 tabular-nums tracking-tight flex items-center gap-1">
            <IndianRupee className="w-6 h-6" />
            {loading ? "—" : (d?.avgTicketSize ?? 0).toLocaleString("en-IN")}
          </p>
        </div>
      </div>
    </section>
  );
}
