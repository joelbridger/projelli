/**
 * BUG-035 mitigation — isBinaryFile() must classify common binary formats as
 * binary so they are never read/written as UTF-8 text (which corrupts them on
 * import, save/autosave, and download).
 */
import { describe, it, expect } from 'vitest';
import { isBinaryFile } from '@/platform/utils/file-utils';

describe('isBinaryFile — binary formats', () => {
  const binary = [
    // images
    'photo.png', 'scan.tiff', 'pic.tif', 'iphone.heic', 'next.heif', 'modern.avif', 'art.psd', 'camera.dng',
    // audio
    'song.mp3', 'lossless.flac', 'clip.aac', 'voice.opus', 'old.aiff', 'tune.mid',
    // video
    'movie.mp4', 'clip.m4v', 'old.mpeg', 'rec.wmv', 'web.ogv',
    // documents / office
    'brief.pdf', 'memo.docx', 'sheet.xlsx', 'deck.pptx',
    'open.odt', 'calc.ods', 'slides.odp', 'mac.pages', 'book.epub', 'diagram.vsdx',
    // archives
    'bundle.zip', 'logs.gz', 'data.bz2', 'image.iso', 'mac.dmg', 'lib.jar',
    // fonts
    'font.ttf', 'web.woff2',
    // executables / native
    'app.exe', 'lib.dll', 'mod.wasm', 'pkg.msi', 'phone.apk',
    // databases
    'store.sqlite', 'cache.db', 'cols.parquet',
    // design
    'mock.sketch', 'art.afphoto',
  ];

  it.each(binary)('treats %s as binary', (name) => {
    expect(isBinaryFile(name)).toBe(true);
  });

  it('is case-insensitive and works on full paths', () => {
    expect(isBinaryFile('/ws/Sub Dir/REPORT.PDF')).toBe(true);
    expect(isBinaryFile('C:\\Users\\x\\photo.HEIC')).toBe(true);
  });
});

describe('isBinaryFile — text formats stay text', () => {
  const text = [
    'notes.md', 'readme.txt', 'data.json', 'table.csv', 'page.html',
    'style.css', 'script.ts', 'mod.js', 'config.yaml', 'config.yml',
    'flow.workflow', 'chat.aichat', 'card.source', 'log.xml',
    'noextension', '',
  ];

  it.each(text)('treats %s as text', (name) => {
    expect(isBinaryFile(name)).toBe(false);
  });

  it('does not misclassify ambiguous-but-often-text formats as binary', () => {
    // These CAN be binary but are commonly text; classifying them binary would
    // corrupt the common text case, so they must stay text.
    expect(isBinaryFile('vector.eps')).toBe(false);
    expect(isBinaryFile('model.stl')).toBe(false);
    expect(isBinaryFile('mesh.obj')).toBe(false);
    expect(isBinaryFile('drawing.dxf')).toBe(false);
    // '.ai' (legacy Illustrator can be PostScript/PDF text) and '.fig' (Xfig is
    // plain text, not only Figma) are ambiguous, so they stay on the text path.
    expect(isBinaryFile('logo.ai')).toBe(false);
    expect(isBinaryFile('diagram.fig')).toBe(false);
  });
});
