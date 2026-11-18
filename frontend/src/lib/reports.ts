// Shared thresholds for Team Performance / leaderboard views (Reports.tsx's Team
// Performance tab and the Dashboard's TeamLeaderboardCard) so both render identical
// colors for the same progress percentage instead of drifting independently.
export function progressColor(pct: number): string {
  if (pct >= 80) return "bg-green-500";
  if (pct >= 60) return "bg-primary";
  return "bg-amber-500";
}

export type RepHealth = "coaching" | "track" | "strong";

// Illustrative thresholds (per design handoff) — tune with the sales lead once real
// usage patterns are observed.
export function repHealth(row: { total: number; notEngaged: number; untouched: number; followupOverdue: number }): RepHealth {
  if (row.total === 0) return "track";
  const untouchedRatio = row.untouched / row.total;
  const overdueRatio = row.followupOverdue / row.total;
  const notEngagedRatio = row.notEngaged / row.total;
  if (untouchedRatio > 0.15 || overdueRatio > 0.4) return "coaching";
  if (untouchedRatio < 0.05 && overdueRatio < 0.15 && notEngagedRatio < 0.1) return "strong";
  return "track";
}

export const REP_HEALTH_LABEL: Record<RepHealth, string> = {
  coaching: "Needs coaching",
  track: "On track",
  strong: "Strong",
};

export const REP_HEALTH_CLASSES: Record<RepHealth, string> = {
  coaching: "bg-destructive/10 text-destructive",
  track: "bg-primary/10 text-primary",
  strong: "bg-success/10 text-success",
};
