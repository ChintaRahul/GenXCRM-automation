import type { ModuleField } from "../modules/registry";

export type FieldErrors = Record<string, string>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMERIC_TYPES = new Set(["number", "money", "pct"]);
const isBlank = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

// Owner fields are chosen from a list (or default to the creator), so they are never required here.
const needsValue = (f: ModuleField): boolean => Boolean(f.required) && f.type !== "owner" && f.type !== "bool";

function fieldError(field: ModuleField, value: unknown): string | null {
  const { label, key, type } = field;
  if (isBlank(value)) return needsValue(field) ? `${label} is required.` : null;
  const text = String(value).trim();

  if (NUMERIC_TYPES.has(type)) {
    const n = Number(text);
    if (!Number.isFinite(n)) return `${label} must be a number.`;
    if (n < 0) return `${label} can't be negative.`;
    if (type === "pct" && n > 100) return `${label} can't be more than 100%.`;
  }
  if (type === "text" && /email/i.test(key) && !EMAIL.test(text)) return `${label} must be a valid email address.`;
  if (type === "text" && /phone|mobile/i.test(key)) {
    const digits = text.replace(/\D/g, "");
    if (!/^[\d\s+()-]+$/.test(text) || digits.length < 7 || digits.length > 15) return `${label} must be a valid phone number (7–15 digits).`;
  }
  if (type === "select" && field.options && !field.options.includes(text)) return `${label} must be one of the listed options.`;
  return null;
}

// One message per invalid field, keyed by field key. Empty object = valid.
export function validateFields(fields: readonly ModuleField[], values: Record<string, unknown>): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of fields) {
    const message = fieldError(field, values[field.key]);
    if (message) errors[field.key] = message;
  }
  return errors;
}

// What actually goes to the API: strings trimmed, numeric fields sent as numbers (the server
// rejects "5000"), and — on create — blank optional fields left out (an empty string would fail
// the server's enum / owner checks instead of meaning "not provided").
export function toPayload(fields: readonly ModuleField[], values: Record<string, unknown>, isEdit: boolean): Record<string, unknown> {
  const numeric = new Set(fields.filter((f) => NUMERIC_TYPES.has(f.type)).map((f) => f.key));
  const booleans = new Set(fields.filter((f) => f.type === "bool").map((f) => f.key));
  const payload: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(values)) {
    const value = typeof raw === "string" ? raw.trim() : raw;
    // Checkboxes hold "true" / "" in the form but the server wants a real boolean.
    if (booleans.has(key)) {
      if (value === "" && !isEdit) continue;
      payload[key] = value === true || value === "true";
      continue;
    }
    if (value === "" && !isEdit) continue;
    payload[key] = numeric.has(key) && typeof value === "string" && value !== "" ? Number(value) : value;
  }
  return payload;
}

export interface ServerFormErrors {
  readonly fields: FieldErrors;
  // Messages that couldn't be tied to a field, or a fallback when the server gave none.
  readonly general: string | null;
}

// Maps a NestJS 400 (`message` is an array like "phone should not be empty") onto form fields so
// each message shows under the right input, with the field's label instead of its key.
export function serverFormErrors(err: unknown, fields: readonly ModuleField[]): ServerFormErrors {
  const response = (err as { response?: { status?: number; data?: { message?: unknown } } })?.response;
  const status = response?.status;
  // Nest wraps some errors one level deeper: `{ message: { message: [...], statusCode } }`.
  const body = response?.data?.message;
  const raw = body && typeof body === "object" && !Array.isArray(body) ? (body as { message?: unknown }).message : body;
  const messages = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).map(String);

  if (!response) return { fields: {}, general: "Can't reach the server. Check your connection and try again." };
  if (status === 401) return { fields: {}, general: "Your session has expired. Please sign in again." };
  if (status === 403) return { fields: {}, general: messages.join(" ") || "You don't have permission to do this." };
  if (status !== undefined && status >= 500) return { fields: {}, general: "Something went wrong on our side. Please try again in a moment." };
  if (messages.length === 0) return { fields: {}, general: "Couldn't save — please check the form and try again." };

  const result: FieldErrors = {};
  const general: string[] = [];
  for (const message of messages) {
    // "property nextAction should not exist": the form shows a field the API doesn't accept.
    const unknown = /^property (\S+) should not exist$/.exec(message);
    if (unknown) {
      const field = fields.find((f) => f.key === unknown[1]);
      if (field) result[field.key] ??= `${field.label} can't be saved from this form. Clear it and try again.`;
      continue;
    }
    const field = fields.find((f) => message === f.key || message.startsWith(`${f.key} `));
    if (!field) {
      general.push(message);
      continue;
    }
    const detail = message.slice(field.key.length).trim().replace(/^should not be empty$/, "is required");
    result[field.key] ??= `${field.label} ${detail}${detail.endsWith(".") ? "" : "."}`;
  }
  return { fields: result, general: general.length ? general.join(" ") : null };
}
