import { Slider } from "../../ui/slider";

interface ScoreRangeSliderProps {
  min?: number;
  max?: number;
  onChange: (min: number | undefined, max: number | undefined) => void;
}

export function ScoreRangeSlider({
  min = 0,
  max = 100,
  onChange,
}: ScoreRangeSliderProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-foreground">Lead score</p>
        <span className="text-xs text-muted-foreground tabular-nums">
          {min} – {max}
        </span>
      </div>
      <div className="px-1">
        <Slider
          min={0}
          max={100}
          step={5}
          value={[min, max]}
          onValueChange={([nextMin, nextMax]) => {
            onChange(
              nextMin === 0 ? undefined : nextMin,
              nextMax === 100 ? undefined : nextMax,
            );
          }}
        />
      </div>
    </div>
  );
}
