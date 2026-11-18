import { useFollowUps } from "../../hooks/useFollowUps";
import { FollowUpsCard } from "./FollowUpsCard";

// Wires the follow-ups hook to the card. Kept separate so the Manufacturing dashboard,
// which returns early from DashboardPage, never triggers the fetch.
export function FollowUpsSection() {
  const { items, loading, error, refetch, markDone, snooze } = useFollowUps();
  return (
    <FollowUpsCard
      items={items}
      loading={loading}
      error={error}
      onRetry={() => void refetch()}
      onDone={(id) => void markDone(id)}
      onSnooze={(id) => void snooze(id)}
    />
  );
}
