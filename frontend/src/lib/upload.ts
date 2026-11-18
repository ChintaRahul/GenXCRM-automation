import { CapacitorHttp } from "@capacitor/core";
import { isNative } from "./platform";

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix — CapacitorHttp expects raw base64.
      resolve(result.substring(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

// Uploads directly to a presigned S3 PUT URL. On native this goes through CapacitorHttp,
// which routes the request through Android's own HTTP client rather than the WebView's
// fetch — the S3 bucket's CORS policy only allows PUT from the app's web origins, not from
// https://localhost. On web, plain fetch is used (still subject to CORS there).
export async function uploadToS3(uploadUrl: string, file: File): Promise<void> {
  if (isNative()) {
    const data = await readFileAsBase64(file);
    const response = await CapacitorHttp.put({
      url: uploadUrl,
      headers: { "Content-Type": file.type },
      data,
      dataType: "file",
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`S3 upload failed: ${response.status}`);
    }
    return;
  }
  const putResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putResponse.ok) throw new Error(`S3 upload failed: ${putResponse.status}`);
}
