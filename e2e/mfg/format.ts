// e2e/mfg/format.ts - how the app displays values, so assertions can compare what a user sees.

/** Money as the app shows it (mirrors frontend lib/moduleCells formatMoney): 1000000 -> "₹10.0 L". */
export const inr = (n: number): string => {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)} Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
};

/** A record without a readable name is shown by its short id: PO- + the first six characters of the UUID. */
export const shortId = (prefix: string, uuid: string): string => `${prefix}${uuid.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
