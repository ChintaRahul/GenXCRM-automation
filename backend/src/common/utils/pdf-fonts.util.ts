import * as path from 'path';
import type PDFDocument from 'pdfkit';

// Base-14 Helvetica has no ₹ glyph (WinAnsiEncoding doesn't include U+20B9) — pdfkit
// silently substitutes a garbage character instead of throwing. Noto Sans covers it,
// so every PDF that prints an amount must register + use these instead of Helvetica.
export const PDF_FONT = 'NotoSans';
export const PDF_FONT_BOLD = 'NotoSans-Bold';

const FONT_DIR = path.join(__dirname, '../../assets/fonts');

export function registerInrFonts(doc: InstanceType<typeof PDFDocument>): void {
  doc.registerFont(PDF_FONT, path.join(FONT_DIR, 'NotoSans-Regular.ttf'));
  doc.registerFont(PDF_FONT_BOLD, path.join(FONT_DIR, 'NotoSans-Bold.ttf'));
}
