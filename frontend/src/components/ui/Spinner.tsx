import { cn } from "../../lib/utils";

const SIZES = { sm: 18, md: 40, lg: 64 } as const;

export function Spinner({
  size = "md",
  className,
  label = "Loading",
}: {
  size?: keyof typeof SIZES;
  className?: string;
  label?: string;
}) {
  const px = SIZES[size];
  return (
    <svg
      role="status"
      aria-label={label}
      width={px}
      height={px}
      viewBox="0 0 50 50"
      className={cn("animate-[genx-spin_1.05s_linear_infinite]", className)}
    >
      <defs>
        <linearGradient id="genxSpin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2487b8" />
          <stop offset="100%" stopColor="#14c2b6" />
        </linearGradient>
      </defs>
      <circle
        cx="25"
        cy="25"
        r="20"
        fill="none"
        stroke="hsl(var(--muted))"
        strokeWidth="5"
      />
      <circle
        cx="25"
        cy="25"
        r="20"
        fill="none"
        stroke="url(#genxSpin)"
        strokeWidth="5"
        strokeLinecap="round"
        className="animate-[genx-dash_1.5s_ease-in-out_infinite]"
      />
    </svg>
  );
}
