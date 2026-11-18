import { X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import type { Course } from "../../types";

export interface RegistrationLineItem {
  courseId?: string;
  courseName: string;
  batchId?: string;
  batchLabel?: string;
  quantity: number;
  unitPrice: number;
}

interface LineItemsTableProps {
  lineItems: RegistrationLineItem[];
  courses: Course[];
  onChange: (lineItems: RegistrationLineItem[]) => void;
}

// Presentational, props-driven table for course line items — shared as-is by the
// Register Student screen (Task 8) and the invoice create/edit form (Task 10).
export function LineItemsTable({
  lineItems,
  courses,
  onChange,
}: LineItemsTableProps) {
  const updateItem = (index: number, patch: Partial<RegistrationLineItem>) => {
    onChange(
      lineItems.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  };

  const handleCourseChange = (index: number, courseId: string) => {
    const course = courses.find((c) => c.id === courseId);
    if (!course) return;
    const firstBatch = course.batches[0];
    updateItem(index, {
      courseId: course.id,
      courseName: course.name,
      unitPrice: course.defaultPrice,
      batchId: firstBatch?.id,
      batchLabel: firstBatch?.label,
    });
  };

  const handleBatchChange = (
    index: number,
    courseId: string | undefined,
    batchId: string,
  ) => {
    const course = courses.find((c) => c.id === courseId);
    const batch = course?.batches.find((b) => b.id === batchId);
    updateItem(index, { batchId, batchLabel: batch?.label });
  };

  const addItem = () => {
    onChange([...lineItems, { courseName: "", quantity: 1, unitPrice: 0 }]);
  };

  const removeItem = (index: number) => {
    onChange(lineItems.filter((_, i) => i !== index));
  };

  return (
    <div>
      <div className="overflow-x-auto">
        {/* Phone: each row is a stacked card (md:* restores the table layout). */}
        <table className="block md:table w-full border-collapse text-sm">
          <thead className="hidden md:table-header-group">
            <tr className="bg-muted/50">
              <th className="text-left px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Course
              </th>
              <th className="text-right px-3 py-2 w-20 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Qty
              </th>
              <th className="text-right px-3 py-2 w-32 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Unit price
              </th>
              <th className="text-right px-4 py-2 w-32 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Line total
              </th>
              <th className="w-9" />
            </tr>
          </thead>
          <tbody className="block md:table-row-group">
            {lineItems.map((item, index) => {
              const lineTotal = item.quantity * item.unitPrice;
              const canRemove = lineItems.length > 1;
              return (
                <tr
                  key={index}
                  className="relative grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 md:table-row md:p-0 border-t border-border"
                >
                  <td className={`col-span-2 md:col-span-1 block md:table-cell ${canRemove ? "pr-8" : ""} md:pr-4 md:px-4 md:py-2 md:min-w-[180px]`}>
                    <Select
                      value={item.courseId ?? ""}
                      onValueChange={(v) => handleCourseChange(index, v)}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={item.courseName || "Select a course"}
                        />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        {courses.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {(() => {
                      const selectedCourse = courses.find(
                        (c) => c.id === item.courseId,
                      );
                      const batches = selectedCourse?.batches ?? [];
                      const selectedBatch = batches.find(
                        (b) => b.id === item.batchId,
                      );
                      return (
                        <>
                          {batches.length > 0 && (
                            <Select
                              value={item.batchId ?? ""}
                              onValueChange={(v) =>
                                handleBatchChange(index, item.courseId, v)
                              }
                            >
                              <SelectTrigger className="mt-1.5 h-8 text-xs">
                                <SelectValue
                                  placeholder={
                                    item.batchLabel || "Select a batch"
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent className="max-h-[300px]">
                                {batches.map((b) => (
                                  <SelectItem key={b.id} value={b.id}>
                                    {b.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          {selectedBatch && (
                            <p className="mt-1 text-[10.5px] text-muted-foreground">
                              Tutor: {selectedBatch.tutor?.name ?? "—"} ·{" "}
                              {selectedBatch.schedule}
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </td>
                  <td className="block md:table-cell md:px-3 md:py-2">
                    <span className="md:hidden mb-1 block text-[11px] font-medium text-muted-foreground">Qty</span>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={item.quantity}
                      onChange={(e) =>
                        updateItem(index, { quantity: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="text-right font-mono"
                    />
                  </td>
                  <td className="block md:table-cell md:px-3 md:py-2">
                    <span className="md:hidden mb-1 block text-[11px] font-medium text-muted-foreground">Unit price</span>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={item.unitPrice === 0 ? "" : item.unitPrice}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) =>
                        updateItem(index, {
                          unitPrice: e.target.value === "" ? 0 : Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      placeholder="0"
                      className="text-right font-mono"
                    />
                  </td>
                  <td className="col-span-2 md:col-span-1 flex md:table-cell items-center justify-between md:px-4 md:py-2 md:text-right font-mono tabular-nums font-semibold text-foreground whitespace-nowrap">
                    <span className="md:hidden font-sans text-[11px] font-medium text-muted-foreground">Line total</span>
                    ₹{lineTotal.toLocaleString("en-IN")}
                  </td>
                  <td className="absolute right-2 top-3 md:static md:table-cell md:px-2 md:py-2 text-center">
                    {canRemove && (
                      <button
                        type="button"
                        aria-label="Remove line item"
                        onClick={() => removeItem(index)}
                        className="w-8 h-8 md:w-6 md:h-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-3 border-t border-border">
        <Button type="button" variant="outline" size="sm" onClick={addItem}>
          + Add line item
        </Button>
      </div>
    </div>
  );
}
