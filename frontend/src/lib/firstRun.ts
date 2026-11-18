// First-run bookkeeping kept in localStorage (persists inside the Capacitor WebView too).
const AUTHED_KEY = "genxcrm.hasAuthenticated";
const tourKey = (userId: string) => `genxcrm.tourSeen.${userId}`;

// True once anyone has signed in on this device — the Android app opens on the signup page
// until then, and on the login page afterwards.
export const hasAuthenticatedBefore = (): boolean => localStorage.getItem(AUTHED_KEY) === "1";
export const markAuthenticated = (): void => localStorage.setItem(AUTHED_KEY, "1");

// Legacy one-shot flag from the old 6-step tour; still honoured so existing users aren't re-welcomed.
export const hasSeenTour = (userId: string): boolean => localStorage.getItem(tourKey(userId)) === "1";

// Guided tour progress per user: `i` = index of the step they're on, `done` once they finished it.
export interface TourRecord {
  readonly i: number;
  readonly done: boolean;
  // Set once the user dismissed the tour (Not now / Skip / Esc): the floating launcher stays hidden.
  readonly hidden?: boolean;
}
const tourRecordKey = (userId: string) => `genx-tour-v1:${userId}`;

export function readTourRecord(userId: string): TourRecord | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(tourRecordKey(userId)) ?? "null");
    if (parsed && typeof parsed === "object" && "i" in parsed && "done" in parsed) {
      const { i, done, hidden } = parsed as { i: unknown; done: unknown; hidden?: unknown };
      if (typeof i === "number" && Number.isInteger(i) && i >= 0 && typeof done === "boolean") {
        return { i, done, hidden: hidden === true };
      }
    }
  } catch {
    // Corrupt or unavailable storage: treat as "never seen".
  }
  return null;
}

export const writeTourRecord = (userId: string, record: TourRecord): void => {
  try {
    localStorage.setItem(tourRecordKey(userId), JSON.stringify(record));
  } catch {
    // Storage full/blocked: the tour just won't remember its place.
  }
};
