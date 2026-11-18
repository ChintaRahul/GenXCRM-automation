import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import type { GstType } from "../../types";

const PRESET_RATES = [5, 12, 18, 28];

interface TaxSettingsCardProps {
  gstEnabled: boolean;
  gstType: GstType;
  gstRate: number;
  onGstEnabledChange: (enabled: boolean) => void;
  onGstTypeChange: (type: GstType) => void;
  onGstRateChange: (rate: number) => void;
}

// Presentational, props-driven — GST on/off, CGST+SGST vs IGST, and rate chips
// (5/12/18/28/Custom). Per the design handoff (README "Screen 2"), selecting a
// preset chip clears "custom" mode; the numeric input only appears in custom mode.
export function TaxSettingsCard({
  gstEnabled,
  gstType,
  gstRate,
  onGstEnabledChange,
  onGstTypeChange,
  onGstRateChange,
}: TaxSettingsCardProps) {
  // Local-only "is the Custom chip active" flag. Not derivable purely from gstRate,
  // since a user can click Custom while the value still happens to equal a preset.
  // The parent page gates this card's mount on data being ready (edit mode waits for
  // the invoice to load before rendering the form), so this initial computation from
  // props is always correct at mount — no resync-on-async-load effect needed.
  const [isCustomRate, setIsCustomRate] = useState(() => !PRESET_RATES.includes(gstRate));

  const selectPreset = (rate: number) => {
    setIsCustomRate(false);
    onGstRateChange(rate);
  };

  const selectCustom = () => {
    setIsCustomRate(true);
  };

  const gstTypeHint =
    gstType === "CGST_SGST"
      ? "Intra-state — buyer in the same state as your business."
      : "Inter-state — buyer in a different state.";

  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-sm font-bold text-foreground">Include GST</h3>
          <p className="text-[11.5px] text-muted-foreground mt-0.5">
            Adds tax breakup to this invoice
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={gstEnabled}
          aria-label="Include GST"
          onClick={() => onGstEnabledChange(!gstEnabled)}
          className={cn(
            "w-[38px] h-[22px] rounded-full relative flex-shrink-0 transition-colors",
            gstEnabled ? "bg-primary" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all",
              gstEnabled ? "left-[18px]" : "left-0.5",
            )}
          />
        </button>
      </div>

      {gstEnabled && (
        <div className="border-t border-border mt-3.5 pt-3.5 space-y-3.5">
          <div>
            <p className="text-[11.5px] font-semibold text-muted-foreground mb-1.5">GST type</p>
            <div className="flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={gstType === "CGST_SGST" ? "default" : "outline"}
                className="flex-1"
                onClick={() => onGstTypeChange("CGST_SGST")}
              >
                CGST + SGST
              </Button>
              <Button
                type="button"
                size="sm"
                variant={gstType === "IGST" ? "default" : "outline"}
                className="flex-1"
                onClick={() => onGstTypeChange("IGST")}
              >
                IGST
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">{gstTypeHint}</p>
          </div>

          <div>
            <p className="text-[11.5px] font-semibold text-muted-foreground mb-1.5">GST rate</p>
            <div className="flex gap-1.5">
              {PRESET_RATES.map((rate) => (
                <Button
                  key={rate}
                  type="button"
                  size="sm"
                  variant={!isCustomRate && gstRate === rate ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => selectPreset(rate)}
                >
                  {rate}%
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant={isCustomRate ? "default" : "outline"}
                className="flex-1"
                onClick={selectCustom}
              >
                Custom
              </Button>
            </div>
            {isCustomRate && (
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={gstRate}
                onChange={(e) => onGstRateChange(Number(e.target.value))}
                placeholder="Custom rate %"
                className="mt-2 font-mono"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
