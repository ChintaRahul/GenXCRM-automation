import api from "./client";

export interface MfgActionQueueItem {
  id: string;
  type: string;
  subject: string;
  accountName: string | null;
  opportunityTitle: string | null;
  dueDate: string | null;
  priority: string;
  state: "overdue" | "today" | "soon" | "later";
}

export interface MfgDealAtRisk {
  id: string;
  title: string;
  accountName: string;
  stage: string;
  value: number;
  reason: string;
}

export interface MfgVisitOrTrial {
  id: string;
  kind: "visit" | "trial";
  title: string;
  accountName: string;
  date: string;
}

export interface MfgPipelinePhase {
  phase: string;
  stages: { stage: string; value: number }[];
  total: number;
}

export interface MfgMyDay {
  kpis: {
    dueToday: number;
    overdueCount: number;
    newLeadsToContact: number;
    leadsPastSla: number;
    quotesAwaitingReply: { count: number; value: number };
    posExpectedThisMonth: { count: number; value: number };
    quarterTarget: { pct: number; booked: number; target: number };
  };
  actionQueue: MfgActionQueueItem[];
  dealsNeedingAttention: MfgDealAtRisk[];
  visitsAndTrials: MfgVisitOrTrial[];
  pipelineByPhase: MfgPipelinePhase[];
}

export interface MfgFunnelStep {
  label: string;
  count: number;
  conversionPct: number | null;
}

export interface MfgAgingRow {
  group: string;
  buckets: { bucket: string; count: number }[];
}

export interface MfgTeamPerformanceRow {
  userId: string;
  name: string;
  pipeline: number;
  quotesOut: number;
  booked: number;
  target: number;
  pct: number;
  overdueCount: number;
}

export interface MfgPendingApproval {
  id: string;
  title: string;
  type: string;
  currentApprover: string | null;
  requestedAt: string;
}

export interface MfgOverduePayment {
  id: string;
  milestone: string;
  accountName: string;
  amount: number;
  dueDate: string;
}

export interface MfgTargetProgress {
  target: number;
  achieved: number;
  pct: number;
}

export interface MfgTeamDashboard {
  kpis: {
    newLeads: number;
    qualifiedLeads: number;
    qualificationRatePct: number;
    activePipeline: number;
    weightedPipeline: number;
    quotationsIssued: { count: number; revised: number };
    poBooked: { count: number; value: number };
    wonLost: { won: number; lost: number; winRatePct: number; wonValue: number };
    outstanding: { amount: number; overdueAmount: number; overdueCount: number };
    targetVsAchievement: { month: MfgTargetProgress; quarter: MfgTargetProgress };
  };
  funnel: MfgFunnelStep[];
  aging: MfgAgingRow[];
  teamPerformance: MfgTeamPerformanceRow[];
  pendingApprovals: MfgPendingApproval[];
  overduePayments: MfgOverduePayment[];
}

export async function getMfgMyDay(): Promise<MfgMyDay> {
  const { data } = await api.get<MfgMyDay>("/mfg-dashboard/my-day");
  return data;
}

export async function getMfgTeam(): Promise<MfgTeamDashboard> {
  const { data } = await api.get<MfgTeamDashboard>("/mfg-dashboard/team");
  return data;
}
