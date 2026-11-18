import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { CATEGORY_OPTIONS } from "../../lib/courseCategories";
import type { CourseCategory } from "../../types";

interface AddCourseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: {
    name: string;
    category: CourseCategory;
    defaultPrice: number;
  }) => Promise<void>;
}

// A modal instead of an inline-editable blank row (CLAUDE.md's user-friendliness rule):
// tabbing out of an inline field used to read as "my entry vanished" even though the
// save succeeded, because the row started out blank and only looked "real" after a
// round trip. Collecting all fields up front removes that moment entirely.
export function AddCourseModal({ open, onOpenChange, onSubmit }: AddCourseModalProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<CourseCategory>("OTHER");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setCategory("OTHER");
    setPrice("");
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name: trimmedName,
        category,
        defaultPrice: Math.max(0, Number(price) || 0),
      });
      reset();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add course</DialogTitle>
        </DialogHeader>
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Course name
            </label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. IELTS Prep"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSubmit();
              }}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Category
            </label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as CourseCategory)}
            >
              <SelectTrigger>
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
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Fee (₹)
            </label>
            <Input
              type="number"
              min={0}
              step={500}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSubmit();
              }}
            />
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Button
            variant="outline"
            type="button"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!name.trim() || submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting ? "Adding…" : "Add course"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
