import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

/**
 * Thin wrapper around PDFKit — a pure-JS PDF renderer (no headless-browser dependency, unlike
 * Puppeteer), chosen specifically because the production box is memory-constrained and already
 * had to move Postgres off itself once for RAM. Callers get a plain Buffer; what they draw onto
 * the document is entirely up to them.
 */
@Injectable()
export class PdfService {
  render(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      try {
        draw(doc);
        doc.end();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // A simple two-column "label: value" block, used by every PDF builder for its header fields.
  fieldBlock(doc: PDFKit.PDFDocument, fields: [string, string][]): void {
    for (const [label, value] of fields) {
      doc.font('Helvetica-Bold').fontSize(10).text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(value || '—');
    }
    doc.moveDown();
  }

  // A plain bordered table — PDFKit has no table primitive, so this draws one row at a time
  // with fixed column widths computed from the page width.
  table(doc: PDFKit.PDFDocument, columns: { label: string; width?: number }[], rows: string[][]): void {
    const startX = doc.page.margins.left;
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const explicitWidth = columns.reduce((s, c) => s + (c.width ?? 0), 0);
    const flexCount = columns.filter((c) => !c.width).length;
    const flexWidth = flexCount > 0 ? (usableWidth - explicitWidth) / flexCount : 0;
    const widths = columns.map((c) => c.width ?? flexWidth);
    const rowHeight = 20;

    let y = doc.y;
    const drawRow = (cells: string[], bold: boolean) => {
      let x = startX;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      cells.forEach((cell, i) => {
        doc.text(cell, x + 2, y + 5, { width: widths[i] - 4, ellipsis: true });
        x += widths[i];
      });
      doc.moveTo(startX, y).lineTo(startX + usableWidth, y).strokeColor('#dddddd').stroke();
      y += rowHeight;
    };
    drawRow(columns.map((c) => c.label), true);
    for (const row of rows) {
      if (y > doc.page.height - doc.page.margins.bottom - rowHeight) {
        doc.addPage();
        y = doc.y;
      }
      drawRow(row, false);
    }
    doc.moveTo(startX, y).lineTo(startX + usableWidth, y).strokeColor('#dddddd').stroke();
    doc.y = y + 10;
  }
}
