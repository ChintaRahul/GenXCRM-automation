import { useModuleEvents } from "../../hooks/useModuleEvents";
import { formatDate } from "../../lib/moduleCells";

interface EventsTabProps {
  readonly moduleKey: string;
  readonly id: string;
  readonly tabKey: string;
  readonly label: string;
}

export function EventsTab({ moduleKey, id, tabKey, label }: EventsTabProps) {
  const { events, loading, error } = useModuleEvents(moduleKey, id, tabKey);

  if (error) {
    return <p className="text-sm text-destructive py-4">Couldn&apos;t load {label.toLowerCase()}.</p>;
  }
  if (loading) return <p className="text-sm text-muted-foreground py-4">Loading…</p>;
  if (!loading && events.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No {label.toLowerCase()} recorded yet.</p>;
  }

  return (
    <ul className="space-y-4">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3">
          <div className="flex flex-col items-center pt-1">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <div className="w-px flex-1 bg-border" />
          </div>
          <div className="pb-2">
            <div className="text-xs text-muted-foreground">{formatDate(event.at)}</div>
            <div className="text-sm font-medium">{event.label}</div>
            {event.description && <div className="text-sm text-muted-foreground">{event.description}</div>}
            {event.actor && <div className="text-xs text-muted-foreground">{event.actor}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}
