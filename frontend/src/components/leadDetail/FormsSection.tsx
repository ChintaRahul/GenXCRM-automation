import { useState } from "react";
import type { FormSubmissionDto } from "../../types";
import { Messages } from "../../lib/messages";
import { Button } from "../ui/button";

interface Props {
  submissions: FormSubmissionDto[];
  loading: boolean;
  minColWidth?: number;
  // Larger answer text and dividers, used inside the responses dialog.
  roomy?: boolean;
  // The dialog already shows form name + date in its header.
  hideHeader?: boolean;
  defaultShowEarlier?: boolean;
}

const Answers = ({ s, minColWidth, roomy }: { s: FormSubmissionDto; minColWidth: number; roomy: boolean }) => (
  <>
    {s.status === "FAILED" && (
      <p className="mb-2 text-xs text-destructive">This response couldn't be processed.</p>
    )}
    <dl
      className={`grid ${roomy ? "gap-x-6 gap-y-4" : "gap-x-4 gap-y-3"}`}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${minColWidth}px), 1fr))` }}
    >
      {Object.entries(s.answers).map(([question, answer]) => (
        <div key={question} className={`min-w-0 ${roomy ? "border-b border-muted pb-3" : ""}`}>
          <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground break-words">
            {question}
          </dt>
          <dd className={`mt-[3px] break-words [overflow-wrap:anywhere] ${roomy ? "text-sm" : "text-[13.5px]"}`}>
            {answer}
          </dd>
        </div>
      ))}
    </dl>
  </>
);

// Newest submission first, older ones collapsed behind a toggle.
export const FormsSection = ({ submissions, loading, minColWidth = 160, roomy = false, hideHeader = false, defaultShowEarlier = false }: Props) => {
  const [showEarlier, setShowEarlier] = useState(defaultShowEarlier);
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (submissions.length === 0) {
    return <p className="text-sm text-muted-foreground">{Messages.googleForms.noResponses}</p>;
  }
  const [latest, ...earlier] = submissions;
  return (
    <div className="space-y-3">
      <div>
        {!hideHeader && (
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="min-w-0 truncate text-[13px] font-semibold" title={latest.form.name}>
              {latest.form.name}
            </span>
            <span className="text-xs text-muted-foreground">{new Date(latest.submittedAt).toLocaleString()}</span>
          </div>
        )}
        <Answers s={latest} minColWidth={minColWidth} roomy={roomy} />
      </div>
      {earlier.length > 0 && (
        <div className="border-t border-card-border pt-2.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto p-0 text-[12.5px] font-medium text-primary hover:bg-transparent hover:underline"
            onClick={() => setShowEarlier((v) => !v)}
          >
            {showEarlier
              ? "Hide earlier responses"
              : `Show ${earlier.length} earlier response${earlier.length === 1 ? "" : "s"}`}
          </Button>
          {showEarlier && (
            <div className="mt-2.5 space-y-2.5">
              {earlier.map((s) => (
                <div key={s.id} className="rounded-lg border border-card-border bg-muted/30 p-3">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 truncate text-xs font-semibold" title={s.form.name}>{s.form.name}</span>
                    <span className="text-xs text-muted-foreground">{new Date(s.submittedAt).toLocaleString()}</span>
                  </div>
                  <Answers s={s} minColWidth={minColWidth} roomy={false} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
