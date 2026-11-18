import { cn } from "../../lib/utils";

interface ScoreBarProps {
  score: number;
}

function barColor(score: number): string {
  if (score >= 85) return "bg-green-500";
  if (score >= 70) return "bg-amber-500";
  return "bg-muted-foreground";
}

export function ScoreBar({ score }: ScoreBarProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-[42px] h-[5px] rounded bg-muted overflow-hidden flex-shrink-0">
        <div
          className={cn("h-full rounded", barColor(score))}
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-foreground tabular-nums">
        {score}
      </span>
    </div>
  );
}
