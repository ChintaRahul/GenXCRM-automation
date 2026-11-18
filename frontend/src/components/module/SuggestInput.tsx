import { useState } from "react";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";

interface SuggestInputProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly onChange: (value: string) => void;
  readonly onBlur?: () => void;
  readonly invalid?: boolean;
}

const OTHER = "__other";

// A dropdown of known values whose last option, "Other — type your own…", swaps it for a text box
// (with a link back to the list). A saved value that isn't in the list opens straight in the box.
export function SuggestInput({ id, label, value, options, onChange, onBlur, invalid }: SuggestInputProps) {
  const [typing, setTyping] = useState(false);
  const typingOwn = typing || (value !== "" && !options.includes(value));

  if (typingOwn) {
    return (
      <div className="space-y-1">
        <Input
          id={id}
          value={value}
          autoFocus={typing}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={cn("max-[767px]:h-11 max-[767px]:text-base", invalid && "border-destructive")}
        />
        <button
          type="button"
          className="text-xs text-primary hover:underline max-[767px]:min-h-11"
          onClick={() => {
            setTyping(false);
            onChange("");
          }}
        >
          ← Choose from list
        </button>
      </div>
    );
  }

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => {
        if (e.target.value === OTHER) {
          setTyping(true);
          onChange("");
        } else {
          onChange(e.target.value);
        }
      }}
      onBlur={onBlur}
      className={cn(
        "w-full h-9 rounded-md border bg-background px-3 text-sm max-[767px]:h-11 max-[767px]:text-base",
        invalid ? "border-destructive" : "border-input",
      )}
    >
      <option value="">{`Select ${label.toLowerCase()}…`}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
      <option value={OTHER}>Other — type your own…</option>
    </select>
  );
}
