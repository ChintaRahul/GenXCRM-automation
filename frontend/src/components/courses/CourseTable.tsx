import { useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { cn } from "../../lib/utils";
import { courseNeedsSetup } from "../../lib/courseStatus";
import { CATEGORY_OPTIONS } from "../../lib/courseCategories";
import type { Course, CourseCategory, Tutor } from "../../types";

interface CourseTableProps {
  courses: Course[];
  tutors: Tutor[];
  expanded: Record<string, boolean>;
  onToggleExpand: (id: string) => void;
  onUpdate: (
    id: string,
    patch: { name?: string; category?: CourseCategory; defaultPrice?: number; isActive?: boolean },
  ) => void;
  onRemove: (id: string) => void;
  onAddBatch: (
    courseId: string,
    payload: {
      label: string;
      schedule: string;
      tutorId?: string;
      capacity: number;
    },
  ) => void;
  onRemoveBatch: (courseId: string, batchId: string) => void;
  onGoToTutors: () => void;
}

interface BatchDraft {
  label: string;
  schedule: string;
  tutorId: string;
  capacity: string;
}

const emptyDraft = (tutors: Tutor[]): BatchDraft => ({
  label: "",
  schedule: "",
  tutorId: tutors[0]?.id ?? "",
  capacity: "25",
});

function statusFor(course: Course): { label: string; className: string } {
  const noBatches = course.batches.length === 0;
  if (courseNeedsSetup(course)) {
    return {
      label: "Needs setup",
      className:
        "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400",
    };
  }
  if (noBatches) {
    return { label: "No batches", className: "bg-muted text-muted-foreground" };
  }
  return {
    label: "Active",
    className:
      "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-400",
  };
}

function batchSummaryFor(course: Course): string {
  if (course.batches.length === 0) return "No batches yet";
  const uniqueTutors = [
    ...new Set(course.batches.map((b) => b.tutor?.name).filter(Boolean)),
  ] as string[];
  const tutorList =
    uniqueTutors.slice(0, 2).join(", ") +
    (uniqueTutors.length > 2 ? ` +${uniqueTutors.length - 2}` : "");
  return `${course.batches.length} batch${course.batches.length > 1 ? "es" : ""}${tutorList ? ` · ${tutorList}` : ""}`;
}

export function CourseTable({
  courses,
  tutors,
  expanded,
  onToggleExpand,
  onUpdate,
  onRemove,
  onAddBatch,
  onRemoveBatch,
  onGoToTutors,
}: CourseTableProps) {
  const [drafts, setDrafts] = useState<Record<string, BatchDraft>>({});
  const [removeTarget, setRemoveTarget] = useState<Course | null>(null);
  const [removeBatchTarget, setRemoveBatchTarget] = useState<
    { courseId: string; batchId: string; label: string } | null
  >(null);

  const draftFor = (courseId: string) => drafts[courseId] ?? emptyDraft(tutors);
  const updateDraft = (courseId: string, patch: Partial<BatchDraft>) =>
    setDrafts((prev) => ({
      ...prev,
      [courseId]: { ...draftFor(courseId), ...patch },
    }));

  const handleAddBatch = (courseId: string) => {
    const draft = draftFor(courseId);
    if (!draft.label.trim()) return;
    onAddBatch(courseId, {
      label: draft.label,
      schedule: draft.schedule || "TBD",
      tutorId: draft.tutorId || undefined,
      capacity: Number(draft.capacity) || 25,
    });
    setDrafts((prev) => ({ ...prev, [courseId]: emptyDraft(tutors) }));
  };

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="hidden md:flex items-center gap-2.5 px-4 py-2.5 bg-muted/50 border-b border-border text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        <div className="w-[22px] flex-shrink-0" />
        <div className="flex-[1.4]">Course</div>
        <div className="w-[150px] flex-shrink-0">Category</div>
        <div className="w-[110px] flex-shrink-0">Fee (₹)</div>
        <div className="w-[190px] flex-shrink-0">Batches &amp; tutors</div>
        <div className="w-[120px] flex-shrink-0 text-center">Status</div>
        <div className="w-[26px] flex-shrink-0" />
      </div>

      {courses.map((course) => {
        const isExpanded = !!expanded[course.id];
        const status = statusFor(course);
        const draft = draftFor(course.id);
        const isArchived = !course.isActive;

        return (
          <div
            key={course.id}
            className={cn(
              "border-t border-border first:border-t-0",
              isArchived && "opacity-60",
            )}
          >
            {/* Phone: wraps into a card (name row, category + fee row, summary + status row).
                Desktop (md+): the single-line table row — `md:order-none` restores DOM order. */}
            <div className="flex flex-wrap md:flex-nowrap items-center gap-x-2.5 gap-y-2 px-4 py-2.5">
              <button
                type="button"
                aria-label={isExpanded ? "Collapse batches" : "Expand batches"}
                onClick={() => onToggleExpand(course.id)}
                className="order-1 md:order-none w-[22px] h-[22px] max-[767px]:w-9 max-[767px]:h-9 flex-shrink-0 flex items-center justify-center text-muted-foreground"
              >
                <ChevronRight
                  className={cn(
                    "w-3.5 h-3.5 transition-transform",
                    isExpanded && "rotate-90",
                  )}
                />
              </button>
              <Input
                key={`${course.id}-name`}
                defaultValue={course.name}
                title={course.name}
                placeholder="Course name"
                disabled={isArchived}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (!value) {
                    // Reject a blanked-out name client-side — the backend would reject it
                    // too (DTO requires non-empty), but only after a round trip that leaves
                    // the input visibly empty until the next refetch.
                    e.target.value = course.name;
                    return;
                  }
                  if (value !== course.name) onUpdate(course.id, { name: value });
                }}
                className="order-2 md:order-none flex-1 md:flex-[1.4] min-w-0 h-8 font-semibold border-transparent bg-transparent focus-visible:border-input"
              />
              <div className="order-4 basis-full h-0 md:hidden" aria-hidden="true" />
              <Select
                value={course.category}
                disabled={isArchived}
                onValueChange={(v) =>
                  onUpdate(course.id, { category: v as CourseCategory })
                }
              >
                <SelectTrigger className="order-5 md:order-none flex-1 md:flex-none md:w-[150px] min-w-0 md:flex-shrink-0 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="order-6 md:order-none w-[110px] flex-shrink-0 flex items-center gap-1">
                <span className="text-xs text-muted-foreground">₹</span>
                <Input
                  key={`${course.id}-fee`}
                  type="number"
                  min={0}
                  step={500}
                  disabled={isArchived}
                  defaultValue={course.defaultPrice}
                  onBlur={(e) => {
                    const value = Math.max(0, Number(e.target.value) || 0);
                    if (value !== course.defaultPrice)
                      onUpdate(course.id, { defaultPrice: value });
                  }}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="order-7 basis-full h-0 md:hidden" aria-hidden="true" />
              <div
                className="order-8 md:order-none flex-1 md:flex-none min-w-0 md:w-[190px] md:flex-shrink-0 text-xs text-muted-foreground truncate"
                title={batchSummaryFor(course)}
              >
                {batchSummaryFor(course)}
              </div>
              <div className="order-9 md:order-none md:w-[120px] flex-shrink-0 text-center">
                {isArchived ? (
                  <span className="inline-block text-[10.5px] font-bold px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                    Archived
                  </span>
                ) : (
                  <span
                    className={cn(
                      "inline-block text-[10.5px] font-bold px-2.5 py-0.5 rounded-full",
                      status.className,
                    )}
                  >
                    {status.label}
                  </span>
                )}
              </div>
              {isArchived ? (
                <button
                  type="button"
                  onClick={() => onUpdate(course.id, { isActive: true })}
                  className="order-3 md:order-none w-[64px] flex-shrink-0 text-[11px] font-semibold text-primary hover:underline text-right"
                >
                  Restore
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Remove course"
                  onClick={() => setRemoveTarget(course)}
                  className="order-3 md:order-none w-[26px] h-[26px] max-[767px]:w-9 max-[767px]:h-9 flex-shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {course.source === "LEAD" && (
              <p className="mx-4 -mt-1 mb-2.5 ml-[48px] text-[11px] text-amber-700 dark:text-amber-400">
                Auto-added — lead "{course.leadName}" was interested in a course
                not yet in your catalog.
              </p>
            )}

            {isExpanded && (
              <div className="mx-4 mb-3.5 md:ml-[48px] bg-muted/30 border border-border rounded-lg overflow-hidden">
                <div className="hidden md:grid grid-cols-[1.3fr_1.5fr_1.2fr_100px_32px] gap-2 px-3.5 py-2 bg-muted/50 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>Batch</span>
                  <span>Schedule</span>
                  <span>Tutor</span>
                  <span>Seats</span>
                  <span />
                </div>
                {course.batches.map((batch) => (
                  <div
                    key={batch.id}
                    className="grid grid-cols-2 md:grid-cols-[1.3fr_1.5fr_1.2fr_100px_32px] gap-2 px-3.5 py-2 items-center border-t border-border text-xs"
                  >
                    <span className="order-1 md:order-none font-semibold text-foreground">
                      {batch.label}
                    </span>
                    <span className="order-3 md:order-none col-span-2 md:col-span-1 text-muted-foreground">
                      {batch.schedule}
                    </span>
                    <span className="order-4 md:order-none">{batch.tutor?.name ?? "—"}</span>
                    <span className="order-5 md:order-none font-mono text-muted-foreground text-right md:text-left">
                      {batch.seats}/{batch.capacity}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove batch"
                      onClick={() =>
                        setRemoveBatchTarget({ courseId: course.id, batchId: batch.id, label: batch.label })
                      }
                      className="order-2 md:order-none justify-self-end md:justify-self-auto w-[22px] h-[22px] max-[767px]:w-9 max-[767px]:h-9 flex items-center justify-center text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {course.batches.length === 0 && (
                  <p className="px-3.5 py-2.5 text-xs text-muted-foreground">
                    No batches yet — add one below.
                  </p>
                )}
                <div className="grid grid-cols-2 md:grid-cols-[1.3fr_1.5fr_1.2fr_100px_32px] gap-2 px-3.5 py-2.5 items-center border-t border-border bg-card">
                  <Input
                    value={draft.label}
                    onChange={(e) =>
                      updateDraft(course.id, { label: e.target.value })
                    }
                    placeholder="e.g. Batch C – Weekend"
                    className="col-span-2 md:col-span-1 h-8 text-xs"
                  />
                  <Input
                    value={draft.schedule}
                    onChange={(e) =>
                      updateDraft(course.id, { schedule: e.target.value })
                    }
                    placeholder="Days · time"
                    className="col-span-2 md:col-span-1 h-8 text-xs"
                  />
                  {tutors.length === 0 ? (
                    <button
                      type="button"
                      onClick={onGoToTutors}
                      className="h-8 px-2.5 text-xs text-left rounded-md border border-dashed border-input text-muted-foreground hover:text-foreground hover:border-foreground/40 truncate"
                      title="No tutors yet — click to add one"
                    >
                      No tutors — + Add one
                    </button>
                  ) : (
                    <Select
                      value={draft.tutorId}
                      onValueChange={(v) =>
                        updateDraft(course.id, { tutorId: v })
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Tutor" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        {tutors.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Input
                    type="number"
                    min={1}
                    value={draft.capacity}
                    onChange={(e) =>
                      updateDraft(course.id, { capacity: e.target.value })
                    }
                    className="h-8 text-xs font-mono"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="col-span-2 md:col-span-1 h-8 w-full md:w-8 p-0"
                    onClick={() => handleAddBatch(course.id)}
                  >
                    +
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <Dialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Remove {removeTarget?.name || "this course"}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This archives the course and removes it from your active catalog. You can
            restore it later from "Show archived".
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => setRemoveTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              type="button"
              onClick={() => {
                if (removeTarget) onRemove(removeTarget.id);
                setRemoveTarget(null);
              }}
            >
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!removeBatchTarget}
        onOpenChange={(open) => !open && setRemoveBatchTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Remove batch "{removeBatchTarget?.label || "this batch"}"?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the batch and unassigns it from any registrations. This cannot be
            undone.
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => setRemoveBatchTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              type="button"
              onClick={() => {
                if (removeBatchTarget) {
                  onRemoveBatch(removeBatchTarget.courseId, removeBatchTarget.batchId);
                }
                setRemoveBatchTarget(null);
              }}
            >
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
