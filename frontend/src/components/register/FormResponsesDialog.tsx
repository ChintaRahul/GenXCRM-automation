import { useNavigate } from "react-router-dom";
import type { FormSubmissionDto } from "../../types";
import { FormsSection } from "../leadDetail/FormsSection";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "../ui/dialog";

interface Props {
  lead: { id: string; name: string };
  submissions: FormSubmissionDto[]; // newest first
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

// Bottom sheet below `sm`, centred dialog from `sm` up — one component, positioned with classes.
export const FormResponsesDialog = ({ lead, submissions, open, onOpenChange }: Props) => {
  const navigate = useNavigate();
  const latest = submissions[0];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="fixed inset-x-0 bottom-0 top-auto flex w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-b-none rounded-t-2xl p-0 max-h-[88vh] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[min(760px,88vh)] sm:max-w-[680px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[14px] sm:p-0 [&>button.absolute]:hidden"
      >
        <div className="mx-auto mt-2 h-1 w-9 flex-shrink-0 rounded-full bg-muted sm:hidden" />
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-card-border px-5 pb-3.5 pt-[18px]">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
              {initials(lead.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base" title={lead.name}>{lead.name}</DialogTitle>
            {latest && (
              <p className="mt-1 truncate text-[12.5px] text-muted-foreground" title={latest.form.name}>
                {latest.form.name} · {new Date(latest.submittedAt).toLocaleString()}
              </p>
            )}
          </div>
          <DialogClose
            aria-label="Close"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-muted text-lg leading-none text-muted-foreground hover:text-foreground"
          >
            ×
          </DialogClose>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-[18px]">
          <FormsSection submissions={submissions} loading={false} minColWidth={210} roomy hideHeader />
        </div>
        <div className="flex flex-shrink-0 flex-wrap justify-end gap-2 border-t border-card-border bg-muted/30 px-5 py-3">
          <Button type="button" variant="outline" className="whitespace-nowrap" onClick={() => navigate(`/leads/${lead.id}`)}>
            Open lead
          </Button>
          <Button type="button" className="whitespace-nowrap" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
