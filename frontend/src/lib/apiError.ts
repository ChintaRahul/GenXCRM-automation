// Extracts a human-readable message from an axios/NestJS error response,
// unwrapping the nested `{ response: { data: { message } } }` shape (which can
// itself be a string, an array of strings, or a nested object).
export function apiErrorMessage(err: unknown, fallback: string): string {
  const raw = (err as { response?: { data?: { message?: unknown } } })?.response
    ?.data?.message;
  const inner =
    raw && typeof raw === "object" && "message" in raw
      ? (raw as { message: unknown }).message
      : raw;
  if (Array.isArray(inner)) return String(inner[0]);
  if (typeof inner === "string") return inner;
  return fallback;
}

// Extracts the machine-readable `code` a NestJS exception carries in its body
// (e.g. SEAT_LIMIT_REACHED, TRIAL_EXPIRED, LIMIT_REACHED), if present.
export function apiErrorCode(err: unknown): string | undefined {
  const code = (err as { response?: { data?: { code?: unknown } } })?.response
    ?.data?.code;
  return typeof code === "string" ? code : undefined;
}
