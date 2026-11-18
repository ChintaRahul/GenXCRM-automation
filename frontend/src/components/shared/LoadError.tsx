import { Button } from "../ui/button";

interface LoadErrorProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

// Shown where data should be when its request failed, so a failure never reads as "no data".
export function LoadError({ message, onRetry, className = "py-6" }: LoadErrorProps) {
  return (
    <div className={`flex flex-col items-center gap-2 text-center ${className}`} role="alert">
      <p className="text-sm text-destructive">{message}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
