// Shared types for the Integrations page tab routing and the Sources grid.
// Kept in its own module so the page and the grid components don't import each
// other (avoids a circular page <-> component dependency).

export type TabKey =
  | "sources"
  | "csv"
  | "facebook"
  | "google"
  | "webhook"
  | "whatsapp"
  | "email"
  | "razorpay"
  | "cashfree"
  | "forms";

export type ProviderKey =
  | "facebook"
  | "google"
  | "webhook"
  | "whatsapp"
  | "email"
  | "twilio"
  | "razorpay"
  | "cashfree"
  | "stripe";
