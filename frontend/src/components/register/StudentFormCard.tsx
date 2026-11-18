import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useFormSubmissions } from "../../hooks/useFormSubmissions";
import { useGoogleForms } from "../../hooks/useGoogleForms";
import { useSendForm } from "../../hooks/useSendForm";
import { Messages } from "../../lib/messages";
import type { FormChannel } from "../../types";
import { FormsSection } from "../leadDetail/FormsSection";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const REFRESH_MS = 30_000;

const CHANNELS: { channel: Exclude<FormChannel, "LINK">; label: string }[] = [
  { channel: "EMAIL", label: "Email" },
  { channel: "WHATSAPP", label: "WhatsApp" },
  { channel: "SMS", label: "SMS" },
];

interface Props {
  leadId: string;
}

export const StudentFormCard = ({ leadId }: Props) => {
  const { forms, loading: formsLoading, error: formsError, syncNow } = useGoogleForms();
  const { submissions, loading: submissionsLoading, error: submissionsError, refetch } = useFormSubmissions({ leadId });
  const { sending, send } = useSendForm(leadId);
  const [chosenFormId, setChosenFormId] = useState("");
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const activeForms = forms.filter((f) => f.isActive && !f.isLegacy);
  const formId = activeForms.some((f) => f.id === chosenFormId) ? chosenFormId : (activeForms[0]?.id ?? "");
  const newestFirst = [...submissions].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const received = submissions.length > 0;

  // One request at a time: polls, tab-focus refreshes and "Check now" share this guard.
  const refresh = useCallback(
    async (sync: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        if (sync) await syncNow(formId); // reports its own errors; a skipped (too-soon) check is fine
        await refetch();
      } finally {
        inFlight.current = false;
      }
    },
    [syncNow, formId, refetch],
  );

  // While waiting for the student, look again every 30 seconds and when the tab is shown again.
  useEffect(() => {
    if (received || !formId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(false);
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [received, formId, refresh]);

  const handleCheckNow = async () => {
    if (inFlight.current) return;
    setChecking(true);
    try {
      await refresh(true);
    } finally {
      if (mounted.current) setChecking(false);
    }
  };

  const handleCopyLink = async () => {
    const result = await send(formId, "LINK");
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.link);
      toast.success(Messages.googleForms.linkCopied);
    } catch {
      toast.error(Messages.googleForms.copyFailed);
    }
  };

  const renderBody = () => {
    if (received) {
      return (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            From <span className="font-semibold text-foreground">{newestFirst[0].form.name}</span>
          </p>
          <FormsSection submissions={newestFirst} loading={false} minColWidth={200} />
        </div>
      );
    }
    if ((formsLoading && forms.length === 0) || submissionsLoading) {
      return <p className="text-sm text-muted-foreground">Loading…</p>;
    }
    if (formsError) return <p className="text-sm text-muted-foreground">{formsError}</p>;
    if (activeForms.length === 0) {
      return <p className="text-sm text-muted-foreground">{Messages.googleForms.noFormConnected}</p>;
    }
    return (
      <div className="space-y-3">
        {activeForms.length > 1 && (
          <Select value={formId} onValueChange={setChosenFormId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a form" />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              {activeForms.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  <span className="block truncate" title={f.name}>
                    {f.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map(({ channel, label }) => (
            <Button
              key={channel}
              type="button"
              variant="outline"
              size="sm"
              className="whitespace-nowrap"
              disabled={!formId || sending}
              onClick={() => void send(formId, channel)}
            >
              {label}
            </Button>
          ))}
          <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" disabled={!formId || sending} onClick={() => void handleCopyLink()}>
            Copy link
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {submissionsError ?? Messages.googleForms.waiting}
          </p>
          <Button type="button" size="sm" variant="ghost" className="whitespace-nowrap" disabled={checking} onClick={() => void handleCheckNow()}>
            {checking ? "Checking…" : "Check now"}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-card-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Student details</h3>
        {received && (
          <span className="flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-medium text-success">
            <span className="h-[7px] w-[7px] rounded-full bg-success" />
            {Messages.googleForms.received} ·{" "}
            {new Date(newestFirst[0].submittedAt).toLocaleString(undefined, {
              day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
            })}
          </span>
        )}
      </div>
      {renderBody()}
    </div>
  );
};
