// e2e/mfg/envGuard.ts - reads backend/.env.e2e.local (the file the E2E backend loads FIRST; first value wins) and guards it against real provider credentials.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const E2E_ENV_FILE = resolve(__dirname, "../../backend/.env.e2e.local");
/** Keys that must be PRESENT and EMPTY: an empty value here overrides the prod-shaped backend/.env. */
export const PROVIDER_KEYS = [
  "WHATSAPP_API_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
  "SES_FROM_EMAIL", "S3_ACCESS_KEY", "S3_SECRET_KEY", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET",
] as const;

/** KEY=value lines (comments, blank lines, `export`, single / double quotes tolerated). A later duplicate does not override the first (dotenv semantics). */
export const readE2eEnv = (file: string = E2E_ENV_FILE): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m || (m[1] as string) in env) continue;
    let value = m[2] as string;
    const quoted = /^(["'])(.*)\1/.exec(value);
    value = quoted ? (quoted[2] as string) : value.replace(/\s+#.*$/, "");
    env[m[1] as string] = value;
  }
  return env;
};

/** Throws unless every provider key is present and empty. */
export const assertNoProviderCredentials = (file: string = E2E_ENV_FILE): void => {
  const env = readE2eEnv(file);
  if (/production/i.test(env.S3_BUCKET ?? "")) throw new Error(`${file}: S3_BUCKET must be empty or a non-production bucket (got "${env.S3_BUCKET}")`);
  if (!("S3_BUCKET" in env)) throw new Error(`${file}: S3_BUCKET is missing - set S3_BUCKET= (empty) so the prod-shaped backend/.env bucket is not used`);
  const bad = PROVIDER_KEYS.filter((k) => env[k] !== "");
  if (bad.length) {
    throw new Error(`${file}: ${bad.map((k) => `${k} is ${k in env ? "non-empty" : "missing"}`).join(", ")} - each provider key must be present and EMPTY so the E2E backend never uses real WhatsApp / AWS / SES / S3 / Razorpay credentials`);
  }
};
