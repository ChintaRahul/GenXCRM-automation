import { Link } from "react-router-dom";
import { Target, Users, TrendingUp, DollarSign, Plus, Download } from "lucide-react";
import { useOverview } from "../hooks/useReports";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../hooks/useWorkspace";
import MfgDashboardPage from "./MfgDashboard";
import { Header } from "../components/layout/Header";
import { StatCard } from "../components/shared/StatCard";
import { Button } from "../components/ui/button";
import { FollowUpsSection } from "../components/dashboard/FollowUpsSection";
import { RecentLeadsCard } from "../components/dashboard/RecentLeadsCard";
import { TeamLeaderboardCard } from "../components/dashboard/TeamLeaderboardCard";
import { PipelineFunnelCard } from "../components/dashboard/PipelineFunnelCard";
import { LeadSourcesCard } from "../components/dashboard/LeadSourcesCard";
import { rupeeShort, leadsToCSV } from "../lib/format";
import { getLeads } from "../api/client";
import { saveFile } from "../lib/platform";
import { LoadError } from "../components/shared/LoadError";

const STAGE_COLOR_VARS: Record<string, string> = {
  NEW: "--chart-1",
  CONTACTED: "--chart-2",
  INTERESTED: "--chart-3",
  CALL_BACK: "--chart-1",
  CALL_NOT_RECEIVED: "--muted-foreground",
  SWITCHED_OFF: "--chart-5",
  WHATSAPP_SENT: "--chart-3",
  DEMO_SCHEDULED: "--chart-4",
  NEGOTIATION: "--chart-5",
  ENROLLED: "--chart-2",
  NOT_INTERESTED: "--muted-foreground",
  DROPPED: "--chart-5",
};

interface OverviewData {
  totalLeads: number;
  newToday: number;
  enrolled: number;
  enrolledMtd: number;
  notInterested: number;
  revenueCollected: number;
  // Optional — present once backend PR #7 ships
  totalLeadsDelta30d?: number;
  newTodayDelta?: number;
  enrolledDeltaMtd?: number;
  revenueDeltaMtd?: number;
  conversionRate?: number;
  avgDeal?: number;
  activeSequences?: number;
  unassignedQueue?: number;
  dailyInflow?: number[];
  // Exact org-timezone boundaries the counts above use; tile links reuse them so the
  // Leads list a tile opens matches its number.
  todayStart?: string;
  monthStart?: string;
}

function startOfTodayISO(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

// Fallback only, used until the overview response supplies the org-timezone boundary.
function startOfMonthISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function downloadLeadsCSV() {
  const result = await getLeads({ limit: 10_000 });
  const csv = leadsToCSV(result.data);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  // saveFile() shares the file via the OS share sheet on the Capacitor mobile app,
  // since the plain <a download> blob-URL trick used here doesn't do anything in a
  // native WebView (see SCRUM-18/SCRUM-26).
  await saveFile(blob, `leads-${new Date().toISOString().slice(0, 10)}.csv`);
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: overviewData, loading: overviewLoading, error: overviewError, refetch: refetchOverview } = useOverview();
  const workspaceType = useWorkspace();

  if (workspaceType === "MANUFACTURING") return <MfgDashboardPage />;

  const overview = overviewData as OverviewData | null;
  const showLeaderboard = user?.role !== "SALES_REP";
  const firstName = user?.name.split(" ")[0] ?? "";

  const dateStr = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const subtitleParts: string[] = [dateStr];
  if (overview?.activeSequences !== undefined) {
    subtitleParts.push(`${overview.activeSequences} active sequences`);
  }
  if (overview?.unassignedQueue !== undefined) {
    subtitleParts.push(
      `${overview.unassignedQueue} unassigned leads in queue`,
    );
  }
  const headerSubtitle = subtitleParts.join(" · ");
  // Header.tsx truncates the subtitle to one line — on a narrow phone, the sequence/queue
  // clauses crowded out the date itself (see SCRUM-30), so mobile gets just the date.
  const headerSubtitleMobile = dateStr;

  const revenueTrend =
    overview?.revenueDeltaMtd !== undefined
      ? {
          value: rupeeShort(Math.abs(overview.revenueDeltaMtd)),
          up: overview.revenueDeltaMtd >= 0,
        }
      : undefined;

  const totalLeadsTrend =
    overview?.totalLeadsDelta30d !== undefined
      ? {
          value: `${overview.totalLeadsDelta30d >= 0 ? "+" : ""}${overview.totalLeadsDelta30d.toFixed(1)}%`,
          up: overview.totalLeadsDelta30d >= 0,
        }
      : undefined;

  const newTodayTrend =
    overview?.newTodayDelta !== undefined
      ? {
          value: `${overview.newTodayDelta >= 0 ? "+" : ""}${overview.newTodayDelta}`,
          up: overview.newTodayDelta >= 0,
        }
      : undefined;

  const enrolledTrend =
    overview?.enrolledDeltaMtd !== undefined
      ? {
          value: `${overview.enrolledDeltaMtd >= 0 ? "+" : ""}${overview.enrolledDeltaMtd.toFixed(1)}%`,
          up: overview.enrolledDeltaMtd >= 0,
        }
      : undefined;

  const newTodaySubtitle =
    overview?.unassignedQueue !== undefined
      ? `${overview.unassignedQueue} unassigned`
      : undefined;

  const enrolledSubtitle =
    overview?.conversionRate !== undefined
      ? `${overview.conversionRate.toFixed(1)}% conv. rate`
      : undefined;

  const revenueSubtitle =
    overview?.avgDeal !== undefined
      ? `${rupeeShort(overview.avgDeal)} avg deal`
      : undefined;

  return (
    <>
      <Header
        title={`Welcome back, ${firstName}`}
        subtitle={headerSubtitle}
        subtitleMobile={headerSubtitleMobile}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="hidden sm:inline-flex"
              onClick={() => void downloadLeadsCSV()}
            >
              <Download className="w-4 h-4 mr-1.5" />
              Export
            </Button>
            <Button asChild size="sm">
              <Link to="/leads?new=1">
                <Plus className="w-4 h-4 mr-1.5" />
                New lead
              </Link>
            </Button>
          </>
        }
      />
      <div className="p-4 sm:p-6 space-y-4">
        {overviewError && <LoadError message={overviewError} onRetry={refetchOverview} className="py-0" />}
        {/* Row 1 — KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            title="Total leads"
            value={overviewLoading || overviewError ? "—" : (overview?.totalLeads ?? 0)}
            icon={<Target className="w-5 h-5 text-primary" />}
            trend={totalLeadsTrend}
            subtitle="vs. last 30d"
            loading={overviewLoading}
            accentColor="bg-primary/10"
            to="/leads?datePreset=all"
          />
          <StatCard
            title="New today"
            value={overviewLoading || overviewError ? "—" : (overview?.newToday ?? 0)}
            icon={<Users className="w-5 h-5 text-chart-2" />}
            trend={newTodayTrend}
            subtitle={newTodaySubtitle}
            loading={overviewLoading}
            accentColor="bg-chart-2/10"
            to={`/leads?dateField=created&createdAfter=${encodeURIComponent(overview?.todayStart ?? startOfTodayISO())}`}
          />
          <StatCard
            title="Enrolled (MTD)"
            value={overviewLoading || overviewError ? "—" : (overview?.enrolledMtd ?? 0)}
            icon={<TrendingUp className="w-5 h-5 text-chart-3" />}
            trend={enrolledTrend}
            subtitle={enrolledSubtitle}
            loading={overviewLoading}
            accentColor="bg-chart-3/10"
            to={`/leads?stage=ENROLLED&createdAfter=${encodeURIComponent(overview?.monthStart ?? startOfMonthISO())}`}
          />
          <StatCard
            title="Revenue (MTD)"
            value={
              overviewLoading || overviewError
                ? "—"
                : overview?.revenueCollected
                  ? rupeeShort(Number(overview.revenueCollected))
                  : "₹0"
            }
            icon={<DollarSign className="w-5 h-5 text-chart-4" />}
            trend={revenueTrend}
            subtitle={revenueSubtitle}
            loading={overviewLoading}
            accentColor="bg-chart-4/10"
            to="/payments"
          />
        </div>

        {/* Row 2 — Pipeline funnel + Sources donut */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <PipelineFunnelCard stageColorVars={STAGE_COLOR_VARS} />
          </div>
          <LeadSourcesCard dailyInflow={overview?.dailyInflow} />
        </div>

        {/* Row 3 — Follow-up actions above Recent leads; the Team leaderboard sits beside them
            for managers/directors, and without it (sales reps) they take the full width. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div
            className={`space-y-4 min-w-0 ${showLeaderboard ? "lg:col-span-2" : "lg:col-span-3"}`}
          >
            <FollowUpsSection />
            <RecentLeadsCard />
          </div>
          {showLeaderboard && <TeamLeaderboardCard />}
        </div>
      </div>
    </>
  );
}
