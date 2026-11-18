import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import {
  useDailyReportFilters,
  useDailySummary,
  useStatusReport,
  useEnrollmentReport,
  useCampaignPerformance,
  useAdSetPerformance,
  useAdPerformance,
  useLeadSourceTracking,
  useDailyDashboard,
  useCampaignOptions,
} from "../../hooks/useReports";
import { useUsers } from "../../hooks/useUsers";
import { Button } from "../ui/button";
import { ExportReportModal } from "./ExportReportModal";
import { FilterBar } from "./daily/FilterBar";
import { DashboardKpis } from "./daily/DashboardKpis";
import { LeadSummary } from "./daily/LeadSummary";
import { LeadStatusReport } from "./daily/LeadStatusReport";
import { EnrollmentReport } from "./daily/EnrollmentReport";
import { CampaignPerformanceTable } from "./daily/CampaignPerformanceTable";
import { AdSetPerformanceTable } from "./daily/AdSetPerformanceTable";
import { AdPerformanceTable } from "./daily/AdPerformanceTable";
import { LeadSourceTracking } from "./daily/LeadSourceTracking";
import { ExportSection } from "./daily/ExportSection";

const LEAD_SOURCE_PAGE_LIMIT = 10;

// Builds a deep link into /leads scoped to the currently selected team member
// (if any) plus whichever quick filter matches a KPI tile — see
// leads.service.ts buildListWhere() and reports.service.ts dailySummary().
function leadsLink(teamMemberId: string | undefined, params: Record<string, string>) {
  const query = new URLSearchParams(params);
  if (teamMemberId) query.set("assignedToId", teamMemberId);
  return `/leads?${query.toString()}`;
}

export function DailyReportSection() {
  const { filters, setFilters } = useDailyReportFilters();
  const { users } = useUsers();
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"pdf" | "excel" | "csv">("pdf");
  const [sourcesPage, setSourcesPage] = useState(1);

  useEffect(() => {
    setSourcesPage(1);
  }, [filters.from, filters.to, filters.teamMemberId, filters.campaignId]);

  const dashboard = useDailyDashboard(filters);
  const summary = useDailySummary(filters);
  const status = useStatusReport(filters);
  const enrollment = useEnrollmentReport(filters);
  const campaigns = useCampaignPerformance(filters);
  const adSets = useAdSetPerformance(filters);
  const ads = useAdPerformance(filters);
  const leadSources = useLeadSourceTracking({ ...filters, page: sourcesPage, limit: LEAD_SOURCE_PAGE_LIMIT });
  const campaignOptions = useCampaignOptions();

  const salesReps = users.filter((u) => u.role === "SALES_REP");

  // Prefer the exact UTC instants the backend actually filtered on (resolved in the org's
  // own timezone — see reports.service.ts dailySummary()) over the raw date-only
  // `filters.from`/`filters.to` strings. leads.service.ts parses createdAfter/createdBefore
  // as naive UTC, so for a non-UTC org, re-sending the bare "YYYY-MM-DD" strings would filter
  // the drill-down /leads list to a different window than the tile was counted over,
  // making the two numbers disagree (SCRUM-61). Falls back to the raw strings before the
  // summary has loaded.
  const kpiLeadsLink = (params: Record<string, string>) =>
    leadsLink(filters.teamMemberId, {
      createdAfter: summary.data?.rangeFrom ?? filters.from ?? "",
      createdBefore: summary.data?.rangeTo ?? filters.to ?? "",
      ...params,
    });

  const openExport = (format: "pdf" | "excel" | "csv") => {
    setExportFormat(format);
    setExportModalOpen(true);
  };

  const scopeLabel = [
    filters.from === filters.to ? filters.from : `${filters.from} – ${filters.to}`,
    filters.campaignId ? campaignOptions.data?.find((c) => c.id === filters.campaignId)?.name : "all campaigns",
    filters.teamMemberId ? salesReps.find((r) => r.id === filters.teamMemberId)?.name : "all team members",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-[22px]">
      {/* Sticky header block — desktop only: on a phone it stacks against the page Header
          (also sticky at top-0), leaving a gap/overlap while scrolling (SCRUM-54). */}
      <div className="lg:sticky lg:top-0 lg:z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 bg-card border-b border-border pb-3">
        <div className="flex flex-wrap items-start justify-between gap-4 pt-1">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-display text-[21px] font-bold text-foreground tracking-[-0.02em]">
                Daily Sales &amp; Lead Management Report
              </h1>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide text-primary bg-primary/10 border border-primary">
                Live
              </span>
            </div>
            <p className="text-[13px] text-muted-foreground mt-1">{scopeLabel}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" onClick={() => openExport("pdf")} className="whitespace-nowrap">
              <Download className="w-3.5 h-3.5" />
              Export report
            </Button>
          </div>
        </div>
      </div>

      <ExportReportModal
        open={exportModalOpen}
        onOpenChange={setExportModalOpen}
        filters={filters}
        initialFormat={exportFormat}
        summary={summary.data ?? undefined}
        status={status.data ?? undefined}
        enrollment={enrollment.data ?? undefined}
        campaigns={campaigns.data ?? undefined}
      />

      <FilterBar
        filters={filters}
        setFilters={setFilters}
        salesReps={salesReps}
        campaignOptions={campaignOptions.data ?? []}
      />

      <DashboardKpis dashboard={dashboard} leadsLink={kpiLeadsLink} />

      <LeadSummary summary={summary} leadsLink={kpiLeadsLink} range={{ from: filters.from ?? "", to: filters.to ?? "" }} />

      <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-[22px] items-stretch">
        <LeadStatusReport status={status} leadsLink={kpiLeadsLink} />
        <EnrollmentReport enrollment={enrollment} />
      </div>

      <CampaignPerformanceTable campaigns={campaigns} />

      <AdSetPerformanceTable adSets={adSets} />

      <AdPerformanceTable ads={ads} />

      <LeadSourceTracking leadSources={leadSources} page={sourcesPage} onPageChange={setSourcesPage} />

      <ExportSection scopeLabel={scopeLabel} rowCount={leadSources.data?.total ?? 0} onExport={openExport} />
    </div>
  );
}
