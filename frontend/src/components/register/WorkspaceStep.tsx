import { useRef, useState } from "react";
import { GraduationCap, Factory, LockKeyhole, Check } from "lucide-react";
import { Button } from "../ui/button";
import { ActionBar } from "./SignUpLayout";
import type { WorkspaceType } from "../../types";

interface WorkspaceOption {
  type: WorkspaceType;
  icon: typeof GraduationCap;
  title: string;
  description: string;
  chips: string[];
  /** Exact copy for the inline "can't be changed later" notice once this card is selected. */
  lockSentence: string;
  /** Shown but not selectable until the workspace type is ready for self-serve signup. */
  comingSoon?: boolean;
}

const OPTIONS: WorkspaceOption[] = [
  {
    type: "EDTECH",
    icon: GraduationCap,
    title: "EdTech",
    description:
      "Institutes and course sellers: enquiries, counselling, enrolment and fee collection.",
    chips: ["Courses", "Registrations", "Invoices", "EMI plans"],
    lockSentence:
      "You get Courses, Register and EMI/fee collection — not RFQs, quotations, orders or AMC.",
  },
  {
    type: "MANUFACTURING",
    comingSoon: true,
    icon: Factory,
    title: "Manufacturing",
    description:
      "B2B manufacturers: enquiry through RFQ, quotation, PO, dispatch and after-sales service.",
    chips: ["Accounts & plants", "RFQs", "Quotations", "Orders", "AMC & service"],
    lockSentence:
      "You get accounts & plants, RFQs, quotations, POs, dispatch and AMC — not Courses or EMI collection.",
  },
];

interface WorkspaceStepProps {
  value: WorkspaceType | "";
  onConfirm: (type: WorkspaceType) => void;
  onBack: () => void;
}

export function WorkspaceStep({ value, onConfirm, onBack }: WorkspaceStepProps) {
  const available = OPTIONS.filter((o) => !o.comingSoon);
  const [selected, setSelected] = useState<WorkspaceType | "">(
    available.some((o) => o.type === value) ? value : "",
  );
  const [ack, setAck] = useState(false);
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function select(type: WorkspaceType) {
    setSelected(type);
    setAck(false); // changing the selection resets the acknowledgement
  }

  function handleRadioGroupKeyDown(e: React.KeyboardEvent) {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const currentIndex = available.findIndex((o) => o.type === selected);
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + dir + available.length) % available.length;
    const next = available[nextIndex];
    select(next.type);
    cardRefs.current[next.type]?.focus();
  }

  const option = OPTIONS.find((o) => o.type === selected);
  const canSubmit = !!selected && ack;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selected) return;
    onConfirm(selected);
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1 className="font-display text-[1.5rem] min-[720px]:text-[1.875rem] font-semibold text-foreground mb-1 max-[719px]:text-2xl">
        What will you use GenX CRM for?
      </h1>
      <p className="text-sm text-muted-foreground mb-5">
        We&apos;ll set up menus, fields and reports for this type of business.
      </p>

      <div
        role="radiogroup"
        aria-label="Workspace type"
        onKeyDown={handleRadioGroupKeyDown}
        className="grid gap-3 mb-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
      >
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isSelected = selected === opt.type;
          return (
            <button
              key={opt.type}
              ref={(el) => { cardRefs.current[opt.type] = el; }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={opt.comingSoon}
              tabIndex={isSelected || (!selected && opt.type === available[0].type) ? 0 : -1}
              onClick={() => !opt.comingSoon && select(opt.type)}
              className={`text-left rounded-xl border p-4 min-h-[44px] flex flex-col gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 ${
                opt.comingSoon
                  ? "border-border bg-card opacity-60 cursor-not-allowed"
                  : isSelected
                    ? "border-primary ring-1 ring-primary bg-primary/5"
                    : "border-border bg-card"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                {opt.comingSoon ? (
                  <span className="text-[11px] font-medium bg-muted rounded-full px-2 py-0.5 text-muted-foreground">
                    Coming soon
                  </span>
                ) : (
                  <span
                    aria-hidden="true"
                    className={`w-4 h-4 rounded-full border-2 ${isSelected ? "border-primary bg-primary" : "border-input"}`}
                  />
                )}
              </div>
              <p className="font-display text-lg font-semibold text-foreground">{opt.title}</p>
              <p className="text-xs text-muted-foreground">{opt.description}</p>
              <div className="border-t border-border pt-2 flex flex-wrap gap-1">
                {opt.chips.map((chip) => (
                  <span
                    key={chip}
                    className="text-[11px] bg-muted rounded-full px-2 py-0.5 text-muted-foreground"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        Both include Dashboard, Leads, Reports, Payments, Nurturing, Templates, Team,
        Billing and Administration.
      </p>

      {option && (
        <div className="rounded-lg border px-4 py-3 mb-5 bg-warning/10 border-warning/30">
          <div className="flex items-start gap-2 text-sm mb-2.5 text-warning">
            <LockKeyhole className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>This can&apos;t be changed later.</strong> {option.lockSentence}{" "}
              Everyone you invite gets the same setup.
            </span>
          </div>
          <button
            type="button"
            role="checkbox"
            aria-checked={ack}
            onClick={() => setAck((v) => !v)}
            className="flex items-start gap-2 text-sm text-left focus-visible:outline-none"
          >
            <span
              className={`w-4 h-4 mt-0.5 shrink-0 rounded border flex items-center justify-center ${
                ack ? "bg-primary border-primary" : "border-input bg-background"
              }`}
            >
              {ack && <Check className="w-3 h-3 text-primary-foreground" />}
            </span>
            <span className="text-foreground">
              I understand the {option.title} workspace type is permanent
            </span>
          </button>
        </div>
      )}

      <ActionBar>
        <Button type="button" variant="outline" className="h-12 w-auto px-6" onClick={onBack}>
          Back
        </Button>
        <Button
          type="submit"
          className={`h-12 flex-1 ${!canSubmit ? "bg-primary/40 cursor-not-allowed hover:opacity-100" : ""}`}
          disabled={!canSubmit}
        >
          Continue &rarr;
        </Button>
      </ActionBar>
    </form>
  );
}
