// Minimal typings for the parts of Google Picker / gapi this app uses (loaded at runtime from apis.google.com).
interface GooglePickerDoc {
  id: string;
  name: string;
}

interface GooglePickerResponse {
  action: string;
  docs?: GooglePickerDoc[];
}

interface GoogleDocsView {
  setMimeTypes(mimeTypes: string): GoogleDocsView;
  setIncludeFolders(include: boolean): GoogleDocsView;
}

interface GooglePickerBuilder {
  addView(view: GoogleDocsView): GooglePickerBuilder;
  setOAuthToken(token: string): GooglePickerBuilder;
  setDeveloperKey(key: string): GooglePickerBuilder;
  setAppId(appId: string): GooglePickerBuilder;
  setCallback(callback: (response: GooglePickerResponse) => void): GooglePickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

interface Window {
  gapi?: { load(name: string, options: { callback: () => void }): void };
  google?: {
    picker?: {
      PickerBuilder: new () => GooglePickerBuilder;
      DocsView: new () => GoogleDocsView;
      Action: { PICKED: string; CANCEL: string };
    };
  };
}
