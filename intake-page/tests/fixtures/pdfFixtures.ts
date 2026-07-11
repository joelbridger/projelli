import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** Synthetic-only forms. They never resemble a custodian or client document. */
export async function syntheticAcroFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Synthetic form', { x: 72, y: 740, size: 18, font, color: rgb(0, 0, 0) });
  const form = doc.getForm();
  form.createTextField('Client.Name').addToPage(page, { x: 72, y: 670, width: 220, height: 22 });
  form.createTextField('Date').addToPage(page, { x: 72, y: 630, width: 120, height: 22 });
  form.createTextField('Money').addToPage(page, { x: 72, y: 590, width: 120, height: 22 });
  form.createCheckBox('Agree').addToPage(page, { x: 72, y: 550, width: 18, height: 18 });
  const radio = form.createRadioGroup('Choice');
  radio.addOptionToPage('yes', page, { x: 72, y: 510, width: 18, height: 18 });
  radio.addOptionToPage('no', page, { x: 130, y: 510, width: 18, height: 18 });
  const select = form.createDropdown('Select');
  select.addOptions(['one', 'two']);
  select.addToPage(page, { x: 72, y: 470, width: 120, height: 22 });
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

export async function syntheticOverlayPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Synthetic overlay form', { x: 72, y: 740, size: 18, font });
  page.drawRectangle({ x: 72, y: 650, width: 260, height: 30, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  page.drawRectangle({ x: 72, y: 590, width: 260, height: 45, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}
