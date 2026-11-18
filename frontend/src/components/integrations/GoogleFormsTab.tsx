import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useGoogleConnection } from "../../hooks/useGoogleConnection";
import { useGoogleForms } from "../../hooks/useGoogleForms";
import { Messages } from "../../lib/messages";
import type { GoogleFormDto } from "../../types";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { AddGoogleFormDialog } from "./AddGoogleFormDialog";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const isStale = (f: GoogleFormDto) => {
  if (!f.isActive || f.isLegacy) return false;
  const last = f.lastSubmissionAt ?? f.createdAt;
  return Date.now() - new Date(last).getTime() > WEEK_MS;
};

const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : "Never";

export const GoogleFormsTab = () => {
  const {
    connection,
    loading: connLoading,
    connecting,
    connect,
    disconnect,
  } = useGoogleConnection();
  const { forms, loading, error, addForm, setActive, removeForm, syncNow } =
    useGoogleForms();
  const [adding, setAdding] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  if (connLoading)
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!connection?.configured) {
    return (
      <p className="text-sm text-muted-foreground">
        {Messages.googleForms.notConfigured}
      </p>
    );
  }

  const isConnected = connection.status === "CONNECTED";

  const handleSync = async (id: string) => {
    setSyncingId(id);
    try {
      await syncNow(id);
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-card-border p-3">
        <div className="min-w-0 flex-1 basis-48">
          {isConnected ? (
            <p
              className="truncate text-sm font-medium"
              title={connection.accountName ?? undefined}
            >
              {connection.accountName
                ? `Connected to Google as ${connection.accountName}`
                : "Connected to Google"}
            </p>
          ) : connection.status === "ERROR" ? (
            <p className="text-sm text-destructive">
              {Messages.googleForms.reconnectNeeded}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Connect your Google account to send forms and get the answers back
              in GenXCRM.
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          {isConnected ? (
            <>
              <Button type="button" onClick={() => setAdding(true)}>
                Add a form
              </Button>
              {confirmDisconnect ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Disconnect?</span>
                  <button
                    type="button"
                    className="font-medium text-destructive hover:underline"
                    onClick={() => {
                      setConfirmDisconnect(false);
                      void disconnect();
                    }}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setConfirmDisconnect(false)}
                  >
                    No
                  </button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmDisconnect(true)}
                >
                  Disconnect
                </Button>
              )}
            </>
          ) : (
            <Button
              type="button"
              disabled={connecting}
              onClick={() => void connect()}
            >
              {connection.status === "ERROR"
                ? "Reconnect Google"
                : "Connect Google"}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {forms.map((f) => (
          <div
            key={f.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-card-border p-3"
          >
            <div className="min-w-0 flex-1 basis-40">
              <p className="truncate text-sm font-medium" title={f.name}>
                {f.name}
              </p>
              {f.isLegacy ? (
                <p className="text-xs text-amber-600">Legacy — reconnect</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Last checked: {formatTime(f.lastSyncedAt)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last response: {formatTime(f.lastSubmissionAt)}
                  </p>
                  {f.syncError && (
                    <p
                      className="break-words text-xs text-destructive"
                      title={f.syncError}
                    >
                      {f.syncError}
                    </p>
                  )}
                  {isStale(f) && (
                    <p className="text-xs text-amber-600">
                      No responses in 7 days
                    </p>
                  )}
                </>
              )}
            </div>
            {confirmDeleteId === f.id ? (
              <div className="flex flex-shrink-0 flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">
                  Delete this form and its saved responses?
                </span>
                <button
                  type="button"
                  className="font-medium text-destructive hover:underline"
                  onClick={() => {
                    setConfirmDeleteId(null);
                    void removeForm(f.id);
                  }}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setConfirmDeleteId(null)}
                >
                  No
                </button>
              </div>
            ) : (
              <div className="flex flex-shrink-0 items-center gap-3">
                {!f.isLegacy && (
                  <>
                    <Switch
                      checked={f.isActive}
                      onCheckedChange={(checked) =>
                        void setActive(f.id, checked)
                      }
                      aria-label={`Toggle ${f.name}`}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={syncingId === f.id}
                      onClick={() => void handleSync(f.id)}
                    >
                      {syncingId === f.id && (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      )}
                      Check now
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${f.name}`}
                  title="Delete form"
                  onClick={() => setConfirmDeleteId(f.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <AddGoogleFormDialog
        open={adding}
        onOpenChange={setAdding}
        onConnect={addForm}
      />
    </div>
  );
};
