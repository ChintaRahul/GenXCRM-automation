// Suggestion lists for free-text form fields. A text field whose key is listed here (or that has
// at least two values already stored elsewhere) gets a dropdown with an "Other — type your own…"
// fallback instead of a bare text box. Keys are the registry field keys.
const INDIAN_STATES = [
  "Andhra Pradesh", "Assam", "Bihar", "Chhattisgarh", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh",
  "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Odisha", "Punjab", "Rajasthan",
  "Tamil Nadu", "Telangana", "Uttar Pradesh", "Uttarakhand", "West Bengal",
] as const;

// 08:00–19:30 in 30-minute steps.
const TIME_SLOTS = Array.from({ length: 24 }, (_, i) => {
  const hour = 8 + Math.floor(i / 2);
  return `${String(hour).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"}`;
});

const NEXT_ACTIONS = [
  "First call", "Send brochure", "Share references", "Technical call with plant team", "Schedule site visit",
  "Schedule demo / trial", "Send quotation", "Quotation follow-up call", "Negotiation call",
  "Follow up PO release", "Collect advance payment",
] as const;

const DELIVERY_TIMES = ["2 weeks", "4 weeks", "6 weeks", "8 weeks", "10 weeks", "12 weeks", "16 weeks", "20 weeks"] as const;

export const FIELD_PRESETS: Readonly<Record<string, readonly string[]>> = {
  state: INDIAN_STATES,
  country: ["India", "Nepal", "Bangladesh", "Sri Lanka", "UAE", "Saudi Arabia", "Other"],
  time: TIME_SLOTS,
  designation: [
    "Owner", "Director", "Plant Head", "GM Projects", "Purchase Manager", "Purchase Head", "Maintenance Head",
    "Production Manager", "Head QA", "Finance Controller", "Stores In-charge", "Project Engineer",
    "Sr. Manager Instrumentation",
  ],
  next: NEXT_ACTIONS,
  nextAction: NEXT_ACTIONS,
  deliveryTime: DELIVERY_TIMES,
  leadTime: DELIVERY_TIMES,
  delivery: ["4 weeks", "8 weeks", "10 weeks", "12 weeks", "16 weeks", "Phased, 20 weeks"],
  warranty: ["12 months", "18 months", "24 months", "36 months"],
  campaign: [
    "IndiaMART Premium", "Google Search — Weighbridge", "Meta Lead Ads — Q3", "Exhibition: IESS 2026",
    "Dealer referral programme",
  ],
};

// Unique or free-text values never get a dropdown: a suggestion list would only mislead.
export const FREE_TEXT_KEYS =
  /^(name|company|contact|title|subject|phone|email|whatsapp|gstin|pan|website|custNo|poNo|serial|invoice|short|description|tags|special|requirement|summary|application|outcome|notes|qReq|qApp|qQty|vehicleNo|lrNumber|sku|productId|model|product|label|rule|parts|recipients|engineers|utilities)$/i;

const MAX_VALUE_LENGTH = 48;
const MIN_SUGGESTIONS = 2;

// Options for a text field, or null when a plain text box is the right control.
export const suggestionsFor = (fieldKey: string, known: readonly string[]): string[] | null => {
  const preset = FIELD_PRESETS[fieldKey];
  const base = preset ?? (FREE_TEXT_KEYS.test(fieldKey) ? [] : known);
  const unique = Array.from(new Set(base.filter((v) => v && v !== "—" && v.length <= MAX_VALUE_LENGTH)));
  // Presets keep their curated order; values gathered from records are sorted.
  const list = preset && fieldKey !== "city" ? unique : [...unique].sort((a, b) => a.localeCompare(b));
  return list.length >= MIN_SUGGESTIONS ? list : null;
};
