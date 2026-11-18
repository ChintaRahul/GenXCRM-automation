// Runs `poll` now and then every `intervalMs`, but only while the browser tab is visible.
// A hidden tab (switched away, minimized) makes no API calls; when the user comes back it
// catches up at once if a full interval has passed since the last run, then resumes.
// Returns a cleanup function.
export const startVisiblePolling = (poll: () => void | Promise<void>, intervalMs: number): (() => void) => {
  const isHidden = () => document.visibilityState === "hidden";
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastRun = 0;

  const run = () => {
    lastRun = Date.now();
    void poll();
  };
  const start = () => {
    timer ??= setInterval(run, intervalMs);
  };
  const stop = () => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };

  const onVisibilityChange = () => {
    if (isHidden()) {
      stop();
      return;
    }
    if (Date.now() - lastRun >= intervalMs) run();
    start();
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  if (!isHidden()) {
    run();
    start();
  }

  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
};
