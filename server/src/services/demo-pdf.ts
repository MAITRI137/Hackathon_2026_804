import { createHash } from 'node:crypto';

import PDFDocument from 'pdfkit';

/**
 * Local PDF generation.
 *
 * The product promises a PDF, so it produces a PDF — generated on the server
 * with PDFKit and stored as bytes, not a text file with a misleading name and
 * not a browser print dialog dressed up as a download. There is no object
 * store in the demo, so the bytes live in the row next to the metadata, which
 * also means a download after a refresh returns byte-for-byte the same file.
 *
 * Every generated document is stamped as a demo document. The content is real;
 * the letterhead is not a real company.
 */
export interface DocumentSection {
  heading: string;
  rows: { label: string; value: string }[];
}

export interface DocumentSpec {
  title: string;
  subtitle: string;
  reference: string;
  recipient: string;
  intro?: string;
  sections: DocumentSection[];
  /** A table rendered as label/amount pairs, used for payslip lines. */
  lines?: { label: string; detail: string; amount: string }[];
  totals?: { label: string; amount: string }[];
  footer: string;
}

const BRAND = '#2274A5';
const MUTED = '#5a6b75';
const RULE = '#d4dde3';

export async function renderDocument(spec: DocumentSpec): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: spec.title, Author: 'PeoplePay360' } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;

  // ── letterhead ──
  doc.fillColor(BRAND).fontSize(18).font('Helvetica-Bold').text('PeoplePay360', left, 48);
  doc.fillColor(MUTED).fontSize(8).font('Helvetica').text('HR and Payroll Operating System', left, 70);
  doc
    .fillColor(MUTED)
    .fontSize(8)
    .text(`Reference ${spec.reference}`, left, 48, { width, align: 'right' })
    .text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, left, 60, {
      width,
      align: 'right',
    })
    .text('DEMO DOCUMENT', left, 72, { width, align: 'right' });
  doc.moveTo(left, 92).lineTo(right, 92).strokeColor(BRAND).lineWidth(2).stroke();

  doc.moveDown(2);
  doc.fillColor('#0d1b24').fontSize(15).font('Helvetica-Bold').text(spec.title, left, 108);
  doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(spec.subtitle);
  doc.moveDown(0.6);
  doc.fillColor('#0d1b24').fontSize(10).font('Helvetica-Bold').text(spec.recipient);
  if (spec.intro) {
    doc.moveDown(0.6);
    doc.fillColor('#243b47').fontSize(9.5).font('Helvetica').text(spec.intro, { width, align: 'left' });
  }

  for (const section of spec.sections) {
    doc.moveDown(1);
    doc.fillColor(BRAND).fontSize(9).font('Helvetica-Bold').text(section.heading.toUpperCase(), { characterSpacing: 0.6 });
    doc.moveDown(0.35);
    for (const row of section.rows) {
      const y = doc.y;
      doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(row.label, left, y, { width: width * 0.45 });
      doc
        .fillColor('#0d1b24')
        .font('Helvetica-Bold')
        .text(row.value, left + width * 0.45, y, { width: width * 0.55, align: 'right' });
      doc.moveDown(0.15);
    }
  }

  if (spec.lines?.length) {
    doc.moveDown(1);
    doc.fillColor(BRAND).fontSize(9).font('Helvetica-Bold').text('BREAKDOWN', { characterSpacing: 0.6 });
    doc.moveDown(0.4);
    for (const line of spec.lines) {
      const y = doc.y;
      doc.fillColor('#0d1b24').fontSize(9).font('Helvetica-Bold').text(line.label, left, y, { width: width * 0.42 });
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(8)
        .text(line.detail, left + width * 0.42, y + 1, { width: width * 0.33 });
      doc
        .fillColor('#0d1b24')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(line.amount, left + width * 0.75, y, { width: width * 0.25, align: 'right' });
      doc.moveDown(0.35);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor(RULE).lineWidth(0.5).stroke();
      doc.moveDown(0.25);
    }
  }

  if (spec.totals?.length) {
    doc.moveDown(0.6);
    for (const total of spec.totals) {
      const y = doc.y;
      doc.fillColor('#0d1b24').fontSize(10).font('Helvetica-Bold').text(total.label, left, y, { width: width * 0.6 });
      doc.text(total.amount, left + width * 0.6, y, { width: width * 0.4, align: 'right' });
      doc.moveDown(0.3);
    }
  }

  // ── footer, on the last page ──
  const footerY = doc.page.height - doc.page.margins.bottom - 34;
  doc.moveTo(left, footerY).lineTo(right, footerY).strokeColor(RULE).lineWidth(1).stroke();
  doc
    .fillColor(MUTED)
    .fontSize(7.5)
    .font('Helvetica')
    .text(spec.footer, left, footerY + 6, { width, align: 'left' });

  doc.end();
  return finished;
}

export const checksumOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
