import type { GooglePickerConfigDto, PickedFile } from "../types";

const MIME_TYPES = {
  form: "application/vnd.google-apps.form",
  sheet: "application/vnd.google-apps.spreadsheet",
} as const;

let loading: Promise<void> | null = null;

// Loads Google's Picker script once and resolves when `google.picker` is ready.
export const loadPickerApi = (): Promise<void> => {
  if (window.google?.picker) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onload = () => {
      if (!window.gapi) {
        loading = null;
        reject(new Error("Google Picker is unavailable"));
        return;
      }
      window.gapi.load("picker", { callback: () => resolve() });
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Could not load Google Picker"));
    };
    document.head.appendChild(script);
  });
  return loading;
};

// Opens the picker for a form or a sheet. Resolves to null when the user cancels.
export const openPicker = (
  config: GooglePickerConfigDto,
  kind: keyof typeof MIME_TYPES,
): Promise<PickedFile | null> =>
  new Promise((resolve, reject) => {
    const picker = window.google?.picker;
    if (!picker) {
      reject(new Error("Google Picker is not loaded"));
      return;
    }
    const view = new picker.DocsView().setMimeTypes(MIME_TYPES[kind]).setIncludeFolders(false);
    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(config.accessToken)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .setCallback((response) => {
        if (response.action === picker.Action.PICKED && response.docs?.[0]) {
          const { id, name } = response.docs[0];
          resolve({ id, name });
        } else if (response.action === picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build()
      .setVisible(true);
  });
