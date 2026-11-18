// e2e/mfg/tag.ts — unique values per call; the E2E DB is never reset between runs, and the
// backend/UI dedupe on phone/email/company/GSTIN, so hardcoded values would collide.
// Uniqueness comes from a per-process counter added to a start value taken from the clock at import,
// so thousands of calls in the same millisecond still differ, and two runs start far apart.
const START = Date.now();
let seq = 0;
const next = (): number => { seq += 1; return START + seq; };
const b36 = (n: number, width: number): string => n.toString(36).toUpperCase().padStart(width, "0").slice(-width);

export const uniqueTag = (prefix = "E2E"): string => `${prefix}-${b36(next(), 9)}`;
export const uniquePhone = (): string => `9${String(next() % 1e9).padStart(9, "0")}`; // 10 digits, no country code
export const uniqueEmail = (tag: string): string => `${tag.toLowerCase().replace(/[^a-z0-9]/g, "")}@e2e-mfg.example`;
export const uniqueGstin = (): string => `27${b36(next(), 9)}A1Z5`; // 15 chars: 27 + 9 + A1Z5
