import sharp from 'sharp';
import path from 'node:path';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(HERE, '../../../Assets/marketing');

interface Reframe { out: string; width: number; height: number; tagline?: string; }

const REFRAMES: Reframe[] = [
  { out: 'og-twitter-card.png',  width: 1200, height: 675,  tagline: 'Obsidian for the AI era.' },
  { out: 'og-linkedin-card.png', width: 1200, height: 627,  tagline: 'Obsidian for the AI era.' },
  { out: 'social-square.png',    width: 1080, height: 1080 },
];

export async function reframeAll() {
  const heroPath = path.join(ASSETS_DIR, 'screenshot-01-workspace.png');
  const hero = readFileSync(heroPath);
  mkdirSync(ASSETS_DIR, { recursive: true });

  for (const r of REFRAMES) {
    const base = await sharp(hero)
      .resize({ width: r.width, height: r.height, fit: 'cover', position: 'center' })
      .png()
      .toBuffer();

    let out = base;
    if (r.tagline) {
      const overlay = taglineOverlay(r.tagline, r.width, r.height);
      out = await sharp(base).composite([{ input: overlay, gravity: 'south' }]).png().toBuffer();
    }
    const outPath = path.join(ASSETS_DIR, r.out);
    writeFileSync(outPath, out);
    console.log(`✓ ${outPath}`);
  }
}

function taglineOverlay(text: string, w: number, h: number): Buffer {
  const stripH = 80;
  const svg = `
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="${h - stripH}" width="${w}" height="${stripH}" fill="rgba(0,0,0,0.55)"/>
      <text x="${w / 2}" y="${h - stripH / 2 + 10}" text-anchor="middle"
            font-family="-apple-system, SF Pro Text, sans-serif"
            font-size="32" font-weight="600" fill="white">${escapeXml(text)}</text>
    </svg>`;
  return Buffer.from(svg);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;' }[c]!));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  reframeAll();
}
