import type { CapacitorConfig } from "@capacitor/cli";
import { readFileSync } from "fs";
import { resolve } from "path";

// The WebView's own origin is fixed at https://localhost, so any request to a plain
// http:// API (e.g. a developer's local LAN backend during on-device testing) is
// blocked by Chromium's mixed-content policy, not just Android's cleartext policy —
// the network security config (android/app/src/debug) alone isn't enough. Detect that
// case from whichever .env file `vite build --mode android` would resolve (mirrors
// Vite's own mode precedence), and allow mixed content only then; release builds
// (https:// API) never set this. This intentionally excludes .env.production(.local)
// — those belong to the web build (mode=production) and must never affect Android.
function readsApiBaseUrl(): string | undefined {
  for (const file of [".env.android.local", ".env.android", ".env.local", ".env"]) {
    try {
      const match = readFileSync(resolve(__dirname, file), "utf8").match(
        /^VITE_API_BASE_URL=(.+)$/m,
      );
      if (match) return match[1].trim();
    } catch {
      /* file doesn't exist — try the next one in precedence order */
    }
  }
  return undefined;
}

const apiBaseUrl = readsApiBaseUrl();
const usesLocalHttpApi = apiBaseUrl?.startsWith("http://") ?? false;

const config: CapacitorConfig = {
  appId: "com.genxcrm.app",
  appName: "GenXCRM",
  webDir: "dist",
  // Serve the WebView over an https origin (https://localhost). The backend CORS
  // allows this origin (see backend/src/main.ts).
  server: { androidScheme: "https" },
  ...(usesLocalHttpApi ? { android: { allowMixedContent: true } } : {}),
};

export default config;
