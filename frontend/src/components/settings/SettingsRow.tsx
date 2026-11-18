import type { ReactNode } from "react";
import { Switch } from "./Switch";

interface SettingsRowProps {
  readonly label: ReactNode;
  readonly helper?: ReactNode;
  // Associates the label with its control for inputs; omit for switches (they use aria-label).
  readonly htmlFor?: string;
  readonly children: ReactNode;
}

// Label + helper on the left, control on the right. Switches go in the control column
// next to their own label, so the label never ends up far from its control.
export const SettingsRow = ({ label, helper, htmlFor, children }: SettingsRowProps) => (
  <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-center gap-x-8 gap-y-2 px-4 py-4 sm:px-5">
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="text-[13.5px] font-medium text-foreground">
        {label}
      </label>
      {helper && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{helper}</p>}
    </div>
    <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
  </div>
);

interface SwitchRowProps extends Omit<SettingsRowProps, "children" | "htmlFor"> {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly label: string;
  // Overrides the accessible name when it should differ from the visible label.
  readonly ariaLabel?: string;
}

// A row whose control is a switch; the switch sits first in the control column with its On/Off state beside it.
export const SwitchRow = ({ label, helper, checked, onCheckedChange, disabled, ariaLabel }: SwitchRowProps) => (
  <SettingsRow label={label} helper={helper}>
    <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} aria-label={ariaLabel ?? label} />
    <span className="text-[12.5px] text-muted-foreground">{checked ? "On" : "Off"}</span>
  </SettingsRow>
);
