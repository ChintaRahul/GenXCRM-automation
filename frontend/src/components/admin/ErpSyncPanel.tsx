import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { getModuleEvents, performModuleAction } from "../../api/modules";
import { apiErrorMessage } from "../../lib/apiError";

interface SyncEntry {
  readonly id: string;
  readonly at: string;
  readonly label: string;
  readonly description?: string;
}

// "Sync now" and the sync log of one ERP connection, shown under its edit form in Administration
// (the connection has no detail page there, so this is where a push is triggered and checked).
export function ErpSyncPanel({ connectionId }: { readonly connectionId: string }) {
  const [entries, setEntries] = useState<SyncEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      setEntries((await getModuleEvents("erp", connectionId, "log")) as SyncEntry[]);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [connectionId]);

  useEffect(() => {
    setEntries(null);
    void load();
  }, [load]);

  async function syncNow() {
    setSyncing(true);
    try {
      await performModuleAction("erp", connectionId, "Sync now");
      toast.success("Sync finished. See the log below.");
    } catch (error) {
      toast.error(apiErrorMessage(error, "Couldn't start the sync."));
    } finally {
      setSyncing(false);
      await load();
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4" data-testid="erp-sync">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Sync log</h3>
        <Button type="button" size="sm" onClick={() => void syncNow()} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
      </div>
      {failed && <p className="text-sm text-destructive">Couldn't load the sync log.</p>}
      {!failed && entries === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {entries?.length === 0 && <p className="text-sm text-muted-foreground">Nothing has been sent yet.</p>}
      <ul className="divide-y divide-border">
        {entries?.map((entry) => (
          <li key={entry.id} className="flex items-start justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <span className="font-medium">{entry.label}</span>
              {entry.description && (
                <p className="truncate text-xs text-muted-foreground" title={entry.description}>
                  {entry.description}
                </p>
              )}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{new Date(entry.at).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
