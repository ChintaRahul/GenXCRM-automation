export function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

export type DeltaTone = "positive" | "negative" | "neutral";

// README: KPI deltas render as "▲ 12.4% vs yesterday" / "▼ 3.1%" / muted "—" when there's
// nothing to compare against (backend returns null for a zero previous period).
export function formatDelta(delta: number | null | undefined): { text: string; tone: DeltaTone } {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return { text: "—", tone: "neutral" };
  if (Math.abs(delta) < 0.05) return { text: "0.0%", tone: "neutral" };
  const arrow = delta > 0 ? "▲" : "▼";
  return { text: `${arrow} ${Math.abs(delta).toFixed(1)}%`, tone: delta > 0 ? "positive" : "negative" };
}
