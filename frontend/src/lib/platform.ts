// Native-shell awareness + helpers for the Capacitor (Android/iOS) build.
//
// On the web these are thin wrappers around the browser; inside the Capacitor
// WebView `window.open`/popups dead-end, so external URLs are routed through the
// system browser (custom tab) which returns cleanly to the app.
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { StatusBar, Style } from "@capacitor/status-bar";

export const isNative = (): boolean => Capacitor.isNativePlatform();

// The app draws edge-to-edge under the system status bar, so its icons/clock must
// contrast with the page: light icons on the dark theme, dark icons on the light one.
export const syncStatusBar = async (theme: "dark" | "light"): Promise<void> => {
  if (!isNative()) return;
  try {
    await StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light });
  } catch {
    /* status-bar plugin unavailable — leave the OS default */
  }
};

// Origin of the deployed web app — used for flows that can't run inside the
// native shell (embedded payment checkout, integration OAuth popups). Set
// VITE_WEB_APP_URL in the mobile build; falls back to the current origin on web.
export const webAppUrl = (): string =>
  (import.meta.env.VITE_WEB_APP_URL as string | undefined)?.replace(
    /\/$/,
    "",
  ) ?? (typeof window !== "undefined" ? window.location.origin : "");

// Open a URL outside the SPA. System browser on native, new tab on web.
export const openExternal = async (url: string): Promise<void> => {
  if (isNative()) {
    await Browser.open({ url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // readAsDataURL prefixes with "data:<mime>;base64," — Filesystem.writeFile wants
      // just the base64 payload.
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(blob);
  });
}

// Save a generated file (e.g. a CSV export) so the user can access it. The classic
// <a download> + blob-URL trick used on web is inert inside the Capacitor WebView —
// tapping it does nothing, with no visible error (see SCRUM-18/SCRUM-26) — so on
// native the file is written to the app's cache dir and handed to the OS share sheet,
// where the user picks Save/Drive/email/etc.
export const saveFile = async (blob: Blob, filename: string): Promise<void> => {
  if (isNative()) {
    const data = await blobToBase64(blob);
    const { uri } = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
    await Share.share({ url: uri, title: filename });
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};
