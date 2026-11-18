// e2e/mfg/pdf.ts - text of a pdfkit-generated PDF. pdfkit deflates its content streams and writes every text run as
// hex-encoded TJ strings, so: inflate each stream, then decode the <hex> pieces of each TJ array back into text.
import { inflateSync } from "node:zlib";

export const pdfText = (pdf: Buffer): string => {
  const raw = pdf.toString("latin1");
  const lines: string[] = [];
  for (const match of raw.matchAll(/(?<!end)stream\r?\n/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = raw.indexOf("endstream", start);
    let content: string;
    try {
      content = inflateSync(pdf.subarray(start, end)).toString("latin1");
    } catch {
      continue; // not a deflate stream (fonts/images)
    }
    for (const tj of content.matchAll(/\[((?:<[0-9a-fA-F]*>|[^\]<>]*)*)\]\s*TJ/g)) {
      lines.push([...(tj[1] ?? "").matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1] ?? "", "hex").toString("latin1")).join(""));
    }
  }
  return lines.join("\n");
};
