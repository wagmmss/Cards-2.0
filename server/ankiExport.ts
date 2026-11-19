import fs from 'fs';
import crypto from 'crypto';
import initSqlJs from 'sql.js';
import sharp from 'sharp';
import {
  isSafeExternalUrl,
  readResponseBufferWithLimit,
  safeFetchWithRedirectValidation,
} from './httpFetch';
import { resolveSafeLocalMediaPath } from './localMediaIndex';

const MAX_CLINICAL_IMAGE_WIDTH = 1600;
const MIN_OPTIMIZE_IMAGE_BYTES = 90 * 1024;

/**
 * Otimiza imagens médicas raster (PNG/JPEG/WebP) acima de 90 KB ou > 1600px de largura,
 * preservando o formato e a nitidez diagnóstica sem alterar o nome do arquivo.
 */
export async function optimizeClinicalImageBuffer(
  filename: string,
  data: Buffer
): Promise<Buffer> {
  if (!data || data.length === 0) return data;
  const extMatch = filename.toLowerCase().match(/\.(png|jpe?g|webp)$/);
  if (!extMatch) return data;
  const ext = extMatch[1];

  try {
    const pipeline = sharp(data, { failOn: 'none' });
    const meta = await pipeline.metadata();
    const width = meta.width || 0;
    if (data.length < MIN_OPTIMIZE_IMAGE_BYTES && width <= MAX_CLINICAL_IMAGE_WIDTH) {
      return data;
    }

    let work = sharp(data, { failOn: 'none' }).rotate();
    if (width > MAX_CLINICAL_IMAGE_WIDTH) {
      work = work.resize({ width: MAX_CLINICAL_IMAGE_WIDTH, withoutEnlargement: true });
    }

    let optimized: Buffer;
    if (ext === 'png') {
      optimized = await work.png({ compressionLevel: 9, palette: true, quality: 88 }).toBuffer();
    } else if (ext === 'webp') {
      optimized = await work.webp({ quality: 85 }).toBuffer();
    } else {
      optimized = await work.jpeg({ quality: 86, mozjpeg: true }).toBuffer();
    }

    return optimized.length > 0 && optimized.length < data.length ? optimized : data;
  } catch {
    return data;
  }
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32Buffer(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildZipArchive(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = entry.data;
    const crc = crc32Buffer(dataBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x5421, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, dataBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += 30 + nameBuf.length + dataBuf.length;
  }

  const centralDirSize = centralParts.reduce((acc, b) => acc + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}


export async function resolveMediaSourceToBuffer(sourceUrl: string): Promise<Buffer | null> {
  if (!sourceUrl) return null;
  const trimmed = sourceUrl.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/api/media/local-file?')) {
    try {
      const parsed = new URL(trimmed, 'http://localhost');
      const rel = parsed.searchParams.get('rel') || '';
      const absPath = resolveSafeLocalMediaPath(rel);
      if (!absPath) return null;
      return fs.readFileSync(absPath);
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith('data:')) {
    const commaIdx = trimmed.indexOf(',');
    if (commaIdx === -1) return null;
    const header = trimmed.slice(0, commaIdx);
    const payload = trimmed.slice(commaIdx + 1);
    if (header.includes(';base64')) {
      const buf = Buffer.from(payload.replace(/\s+/g, ''), 'base64');
      return buf.length > 0 ? buf : null;
    }
    try {
      const buf = Buffer.from(decodeURIComponent(payload), 'utf8');
      return buf.length > 0 ? buf : null;
    } catch {
      const buf = Buffer.from(payload, 'utf8');
      return buf.length > 0 ? buf : null;
    }
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    if (!isSafeExternalUrl(trimmed)) return null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await safeFetchWithRedirectValidation(trimmed, {
          headers: {
            'User-Agent':
              'InternatoFirstCardArchitect/2.0 (https://aistudio.google.com; medical-education)',
            Accept: 'image/*, audio/*, application/octet-stream;q=0.8',
          },
          signal: AbortSignal.timeout(12_000),
        });
        if (resp.status === 404 || resp.status === 410) return null;
        if (!resp.ok) {
          if (attempt === 0 && (resp.status === 429 || resp.status >= 500)) continue;
          return null;
        }
        const contentType = (resp.headers.get('content-type') || '').toLowerCase();
        if (
          contentType.includes('text/html') ||
          contentType.includes('application/json') ||
          contentType.includes('application/xhtml')
        ) {
          return null;
        }
        const buf = await readResponseBufferWithLimit(resp, 20 * 1024 * 1024);
        if (buf.length < 64) {
          return null;
        }
        return buf;
      } catch {
        if (attempt === 1) return null;
      }
    }
    return null;
  }

  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 64) {
    try {
      const buf = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64');
      return buf.length > 0 ? buf : null;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeLocalAssetBasename(rawName: string): string {
  return (rawName || '').trim().split(/[\\/]/).pop()?.trim() || '';
}

export async function resolveDeckMediaFiles(
  mediaManifest: Array<{
    filename?: string;
    localFilename?: string;
    sourceUrl?: string;
    cardId?: number;
  }>,
  mediaAssets: Record<string, string> = {}
): Promise<{
  resolvedMedia: Array<{ filename: string; data: Buffer }>;
  missingMedia: Array<{ filename: string; cardId?: number; reason: string }>;
}> {
  const normalizedAssetMap = new Map<string, string>();
  for (const [key, val] of Object.entries(mediaAssets || {})) {
    if (key && typeof val === 'string' && val) {
      const cleanKey = key.trim().toLowerCase();
      normalizedAssetMap.set(cleanKey, val);
      const base = cleanKey.split(/[\\/]/).pop();
      if (base) normalizedAssetMap.set(base, val);
    }
  }

  const seenLowerFilenames = new Set<string>();
  const resolvedMedia: Array<{ filename: string; data: Buffer }> = [];
  const missingMedia: Array<{ filename: string; cardId?: number; reason: string }> = [];

  if (Array.isArray(mediaManifest) && mediaManifest.length > 0) {
    const items = mediaManifest.filter((item) => {
      const filename = normalizeLocalAssetBasename(
        String(item?.filename || item?.localFilename || '')
      );
      const lower = filename.toLowerCase();
      if (!filename || seenLowerFilenames.has(lower)) return false;
      seenLowerFilenames.add(lower);
      return true;
    });

    const CONCURRENCY = 4;
    let cursor = 0;
    const results: Array<{
      filename: string;
      cardId?: number;
      sourceUrl: string;
      buf: Buffer | null;
    }> = new Array(items.length);

    const worker = async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        const item = items[idx];
        const filename = normalizeLocalAssetBasename(
          String(item?.filename || item?.localFilename || '')
        );
        const sourceUrl = String(item?.sourceUrl || '').trim();
        const lowerName = filename.toLowerCase();
        const uploadedDataUri =
          normalizedAssetMap.get(lowerName) ||
          (sourceUrl ? normalizedAssetMap.get(sourceUrl.toLowerCase()) : undefined);

        let buf: Buffer | null = null;
        if (uploadedDataUri) {
          buf = await resolveMediaSourceToBuffer(uploadedDataUri);
        }
        if (!buf && sourceUrl) {
          buf = await resolveMediaSourceToBuffer(sourceUrl);
        }
        results[idx] = { filename, cardId: item?.cardId, sourceUrl, buf };
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, Math.max(1, items.length)) }, () => worker())
    );

    for (const r of results) {
      if (!r) continue;
      if (r.buf && r.buf.length > 0) {
        const optimizedBuf = await optimizeClinicalImageBuffer(r.filename, r.buf);
        resolvedMedia.push({ filename: r.filename, data: optimizedBuf });
      } else {
        missingMedia.push({
          filename: r.filename,
          cardId: r.cardId,
          reason: /^(?:https?:\/\/)/i.test(r.sourceUrl)
            ? `Falha ao baixar URL externa (${r.sourceUrl.slice(0, 80)})`
            : 'Arquivo local não encontrado nos assets carregados',
        });
      }
    }
  } else if (!Array.isArray(mediaManifest) || mediaManifest.length === 0) {
    // Fall back to mediaAssets when no mediaManifest entries were supplied
    for (const [rawName, dataUri] of Object.entries(mediaAssets || {})) {
      const cleanName = normalizeLocalAssetBasename(rawName);
      if (!cleanName || seenLowerFilenames.has(cleanName.toLowerCase())) continue;
      const buf = await resolveMediaSourceToBuffer(dataUri);
      if (buf && buf.length > 0) {
        seenLowerFilenames.add(cleanName.toLowerCase());
        const optimizedBuf = await optimizeClinicalImageBuffer(cleanName, buf);
        resolvedMedia.push({ filename: cleanName, data: optimizedBuf });
      }
    }
  }

  return { resolvedMedia, missingMedia };
}

const CLOZE_MODEL_ID = 1738331521911;
const CLOZE_MODEL_NAME = 'Med_Cloze_Inverted_v2';
const BASIC_MODEL_ID = 1738331521912;
const BASIC_MODEL_NAME = 'Med_Basic_Inverted_v2';
const GUID_SALT = 'criador-de-cards';

export const ANKI_CLINICAL_CSS = `.card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 18.5px;
  line-height: 1.58;
  text-align: left;
  color: #1e293b;
  background-color: #f8fafc;
  padding: 24px;
}
.med-card { max-width: 740px; margin: 0 auto; }
.topic-box {
  display: inline-block; background-color: #f1f5f9; color: #0369a1;
  padding: 4px 10px; border-radius: 4px; font-size: 13.5px;
  font-weight: 700; margin-bottom: 12px; border: 1px solid #cbd5e1;
  text-transform: uppercase; letter-spacing: 0.5px;
}
b, strong { color: #0284c7; font-weight: 700; }
i, em { font-style: italic; color: #334155; }
.cloze { font-weight: 700; color: #0284c7; border-bottom: 2px solid #38bdf8; padding: 0 2px; }
.front-content, .cloze-text { font-size: 19.5px; color: #0f172a; line-height: 1.58; }
.back-content { font-size: 18.5px; color: #0f172a; line-height: 1.58; margin-top: 10px; }
.main-answer { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
.extra-box {
  margin-top: 16px; padding: 14px 18px; background: #f1f5f9;
  border-radius: 8px; border-left: 4px solid #0284c7;
  font-size: 16px; color: #334155; line-height: 1.52;
}
hr, hr#answer, hr.med-divider { border: 0; height: 1px; background: #cbd5e1; margin: 20px 0; }
img {
  max-width: 100%; max-height: 62vh; height: auto; border-radius: 8px;
  border: 1px solid #cbd5e1;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.10); margin: 14px auto 6px;
  background: #ffffff; padding: 4px; display: block; object-fit: contain;
}
img:first-child { margin-top: 0; }
audio.med-audio { width: 100%; height: 36px; margin: 8px 0; display: block; }
img + br + i,
img + i,
.extra-box > i:first-child {
  display: block;
  margin: 4px auto 12px;
  max-width: 94%;
  font-size: 13.5px;
  line-height: 1.45;
  color: #475569;
  text-align: center;
  font-style: italic;
}
table.med-table {
  width: 100%;
  border-collapse: collapse;
  margin: 14px 0;
  font-size: 14.5px;
  line-height: 1.45;
  background-color: #ffffff;
  color: #0f172a;
  border: 1px solid #cbd5e1;
}
table.med-table th,
table.med-table td {
  border: 1px solid #cbd5e1;
  padding: 9px 12px;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}
table.med-table th {
  background-color: #e0f2fe;
  color: #0c4a6e;
  font-weight: 700;
}
table.med-table tbody tr:nth-child(even) td {
  background-color: #f8fafc;
}
.nightMode.card, .night_mode.card, body.nightMode, body.night_mode { background-color: #18181b !important; color: #f4f4f5 !important; }
.nightMode .topic-box, .night_mode .topic-box { background-color: #27272a !important; color: #7dd3fc !important; border-color: #3f3f46 !important; }
.nightMode .front-content, .nightMode .back-content, .night_mode .front-content, .night_mode .back-content, .nightMode .cloze-text, .night_mode .cloze-text { color: #f4f4f5 !important; }
.nightMode .main-answer, .night_mode .main-answer { color: #f4f4f5 !important; }
.nightMode b, .nightMode strong, .night_mode b, .night_mode strong { color: #38bdf8 !important; }
.nightMode i, .nightMode em, .night_mode i, .night_mode em { color: #cbd5e1 !important; }
.nightMode .cloze, .night_mode .cloze { color: #38bdf8 !important; border-bottom: 2px solid #0ea5e9 !important; }
.nightMode .extra-box, .night_mode .extra-box { background: #27272a !important; border-left: 4px solid #38bdf8 !important; color: #e4e4e7 !important; }
.nightMode hr, .night_mode hr, .nightMode hr#answer, .night_mode hr#answer, .nightMode hr.med-divider, .night_mode hr.med-divider { background: #3f3f46 !important; }
.nightMode img, .night_mode img { background: #ffffff !important; border: 1px solid #3f3f46 !important; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45) !important; }
.nightMode img + br + i, .night_mode img + br + i,
.nightMode img + i, .night_mode img + i,
.nightMode .extra-box > i:first-child, .night_mode .extra-box > i:first-child {
  color: #cbd5e1 !important;
}
.nightMode table.med-table, .night_mode table.med-table {
  background-color: #18181b !important;
  color: #f4f4f5 !important;
  border-color: #475569 !important;
}
.nightMode table.med-table th, .night_mode table.med-table th {
  background-color: #0c4a6e !important;
  color: #e0f2fe !important;
  border-color: #475569 !important;
}
.nightMode table.med-table td, .night_mode table.med-table td {
  background-color: #1f2430 !important;
  border-color: #475569 !important;
  color: #f4f4f5 !important;
}
.nightMode table.med-table tbody tr:nth-child(even) td,
.night_mode table.med-table tbody tr:nth-child(even) td {
  background-color: #27272a !important;
}
@media (max-width: 600px) {
  .card { padding: 14px; font-size: 16.5px; }
  .med-card { max-width: 100%; }
  .front-content, .cloze-text { font-size: 17.5px; }
  .back-content { font-size: 16.5px; }
  .main-answer { font-size: 18px; }
  .extra-box { padding: 10px 14px; font-size: 15px; }
  img { max-height: 55vh; margin-top: 10px; }
  img:first-child { margin-top: 0; }
  table.med-table { font-size: 13.5px; display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table.med-table th, table.med-table td { padding: 7px 9px; }
}`;

const BASE91_TABLE =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';

export function sanitizeDeckKeyForAnki(rawKey: string, fallback = 'internato_deck'): string {
  return (
    (rawKey || fallback)
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || fallback
  );
}

export function genankiGuidFor(deckId: number, deckKey: string, noteId: number): string {
  const cleanKey = sanitizeDeckKeyForAnki(deckKey, 'deck');
  const key = `${cleanKey}:id:${noteId}`;
  const hashStr = `${GUID_SALT}__${deckId}__${key}`;
  const digest = crypto.createHash('sha256').update(hashStr, 'utf8').digest();
  let hashInt = 0n;
  for (let i = 0; i < 8; i++) {
    hashInt = (hashInt << 8n) | BigInt(digest[i]);
  }
  const base = BigInt(BASE91_TABLE.length);
  let rv = '';
  while (hashInt > 0n) {
    rv = BASE91_TABLE[Number(hashInt % base)] + rv;
    hashInt = hashInt / base;
  }
  return rv || `id${noteId}`;
}

function ankiFieldChecksum(sfld: string): number {
  const hex = crypto.createHash('sha1').update(sfld || '', 'utf8').digest('hex').slice(0, 8);
  return parseInt(hex, 16) >>> 0;
}

export function computeDeckIdFromKey(deckKey: string): number {
  const cleanKey = sanitizeDeckKeyForAnki(deckKey, 'internato_deck');
  const digest = crypto.createHash('sha256').update(cleanKey, 'utf8').digest();
  const val = digest.readUInt32BE(0);
  return 1730000000000 + (val % 900000000);
}

function normalizeGuidRegistryMap(rawRegistry: unknown): Record<string, string> {
  if (!rawRegistry || typeof rawRegistry !== 'object') return {};
  const record = rawRegistry as Record<string, unknown>;
  const source =
    record.entries && typeof record.entries === 'object'
      ? (record.entries as Record<string, unknown>)
      : record;

  const normalized: Record<string, string> = {};
  for (const [key, val] of Object.entries(source)) {
    if (typeof key === 'string' && typeof val === 'string' && val.trim()) {
      normalized[key] = val.trim();
    }
  }
  return normalized;
}

function extractClozeCardOrdinals(questionHtml: string): number[] {
  const found = new Set<number>();
  const regex = /\{\{c(\d+)::/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(questionHtml || '')) !== null) {
    const idx = Number(m[1]);
    if (Number.isFinite(idx) && idx >= 1 && idx <= 50) {
      found.add(idx - 1);
    }
  }
  if (found.size === 0) return [0];
  return Array.from(found).sort((a, b) => a - b);
}

function decodeDataImageUriSync(dataUri: string): { ext: string; data: Buffer } | null {
  const commaIdx = dataUri.indexOf(',');
  if (commaIdx === -1) return null;
  const header = dataUri.slice(5, commaIdx);
  const payload = dataUri.slice(commaIdx + 1);
  const mime = header.split(';')[0].trim().toLowerCase();
  if (!mime.startsWith('image/')) return null;

  const ext = mime.includes('png')
    ? 'png'
    : mime.includes('webp')
      ? 'webp'
      : mime.includes('gif')
        ? 'gif'
        : mime.includes('svg')
          ? 'svg'
          : 'jpg';

  let data: Buffer;
  try {
    if (/;base64(?:;|$)/i.test(header)) {
      data = Buffer.from(payload.replace(/\s+/g, ''), 'base64');
    } else {
      data = Buffer.from(decodeURIComponent(payload), 'utf8');
    }
  } catch {
    data = Buffer.from(payload, 'utf8');
  }
  return data.length > 0 ? { ext, data } : null;
}

/**
 * Rewrites HTML audio tags to Anki-native `[sound:...]` when local/resolved, converts inline
 * `data:image/` tags into real bundled `.apkg` media files, strips broken local `<img src="...">` or
 * `[sound:...]` tags missing from `resolvedByLowerName`, and tracks every referenced filename.
 */
function sanitizeFieldMediaForApkg(
  rawHtml: string,
  resolvedByLowerName: Map<string, { filename: string; data: Buffer }>,
  referencedFiles: Map<string, Buffer>,
  cleanDeckKey = 'internato_deck',
  noteId = 0
): string {
  if (!rawHtml) return '';
  let out = rawHtml;

  // 1. Convert <audio><source src="..."></audio> and <audio src="..."> into [sound:...]
  out = out.replace(
    /<audio\b[^>]*>[\s\S]*?<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/audio>/gi,
    (_full, srcVal: string) => {
      const base = normalizeLocalAssetBasename(srcVal);
      return base ? `[sound:${base}]` : '';
    }
  );
  out = out.replace(
    /<audio\b[^>]*\bsrc=["']([^"']+)["'][^>]*>(?:[\s\S]*?<\/audio>)?/gi,
    (_full, srcVal: string) => {
      const base = normalizeLocalAssetBasename(srcVal);
      return base ? `[sound:${base}]` : '';
    }
  );

  // 2. Validate <img src="..."> references against resolvedMedia and extract inline data:image/* into media map
  out = out.replace(
    /<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>/gi,
    (fullTag, beforeAttrs: string, srcVal: string, afterAttrs: string) => {
      const trimmedSrc = (srcVal || '').trim();
      if (!trimmedSrc) return '';
      if (/^(?:pdfimg|buscar_imagem):/i.test(trimmedSrc)) {
        return '';
      }

      const dataAnkiAttr = fullTag.match(/\bdata-anki-file=["']([^"']+)["']/i)?.[1];
      const baseFromAttr = dataAnkiAttr ? normalizeLocalAssetBasename(dataAnkiAttr) : '';
      const cleanedAttrs = `${beforeAttrs} ${afterAttrs}`
        .replace(/\s*\bdata-anki-file=["'][^"']*["']/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (/^data:image\//i.test(trimmedSrc)) {
        const decoded = decodeDataImageUriSync(trimmedSrc);
        if (!decoded) return '';
        const sha8 = crypto.createHash('sha256').update(decoded.data).digest('hex').slice(0, 8);
        let targetFilename = baseFromAttr || `${cleanDeckKey}_${noteId}_${sha8}.${decoded.ext}`;
        const existingBuf = referencedFiles.get(targetFilename);
        if (existingBuf && !existingBuf.equals(decoded.data)) {
          const extMatch = targetFilename.match(/(\.[a-z0-9]{2,5})$/i);
          const ext = extMatch ? extMatch[1] : `.${decoded.ext}`;
          const stem = targetFilename.replace(/\.[a-z0-9]{2,5}$/i, '');
          targetFilename = `${stem}_${sha8}${ext}`;
        }
        referencedFiles.set(targetFilename, decoded.data);
        return cleanedAttrs
          ? `<img src="${targetFilename}" ${cleanedAttrs}>`
          : `<img src="${targetFilename}">`;
      }

      const baseFromSrc = normalizeLocalAssetBasename(trimmedSrc);
      const resolved =
        (baseFromAttr ? resolvedByLowerName.get(baseFromAttr.toLowerCase()) : undefined) ||
        resolvedByLowerName.get(baseFromSrc.toLowerCase());

      if (resolved) {
        referencedFiles.set(resolved.filename, resolved.data);
        return cleanedAttrs
          ? `<img src="${resolved.filename}" ${cleanedAttrs}>`
          : `<img src="${resolved.filename}">`;
      }

      // Remove broken external/local reference so Anki Check Media has 0 missing files
      return '';
    }
  );

  // 3. Validate [sound:...] references against resolvedMedia
  out = out.replace(/\[sound:([^\]]+)\]/gi, (_full, soundTarget: string) => {
    const base = normalizeLocalAssetBasename(soundTarget);
    if (!base) return '';
    const resolved = resolvedByLowerName.get(base.toLowerCase());
    if (resolved) {
      referencedFiles.set(resolved.filename, resolved.data);
      return `[sound:${resolved.filename}]`;
    }
    return '';
  });

  // Tidy leftover leading/trailing <br> after stripped broken tags
  return out
    .replace(/^(?:\s*<br\s*\/?>\s*)+/i, '')
    .replace(/(?:\s*<br\s*\/?>\s*)+$/i, '')
    .trim();
}

let sqlJsPromise: ReturnType<typeof initSqlJs> | null = null;
function getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs();
  }
  return sqlJsPromise;
}

export async function buildAnkiApkgBuffer(params: {
  deckKey: string;
  deckName: string;
  deckId?: number;
  notes: Array<{
    id: number;
    type: 'basic' | 'cloze';
    topic: string;
    question: string;
    answer: string;
    hint: string;
    tags?: string[];
  }>;
  resolvedMedia: Array<{ filename: string; data: Buffer }>;
  guidRegistry?: Record<string, string>;
}): Promise<{
  apkgBuffer: Buffer;
  updatedRegistry: Record<string, string>;
  newRegistryEntries: Record<string, string>;
}> {
  const SQL = await getSqlJs();
  const db = new SQL.Database();

  const nowSec = Math.floor(Date.now() / 1000);
  const cleanDeckKey = sanitizeDeckKeyForAnki(params.deckKey || 'internato_deck', 'internato_deck');
  const deckId =
    typeof params.deckId === 'number' && params.deckId > 1
      ? params.deckId
      : computeDeckIdFromKey(cleanDeckKey);
  const deckName = (params.deckName || cleanDeckKey.replace(/_/g, ' ')).trim();
  const initialRegistry: Record<string, string> = normalizeGuidRegistryMap(params.guidRegistry);
  const updatedRegistry: Record<string, string> = { ...initialRegistry };
  const newRegistryEntries: Record<string, string> = {};

  const resolvedByLowerName = new Map<string, { filename: string; data: Buffer }>();
  for (const mediaItem of params.resolvedMedia || []) {
    const canonicalName = normalizeLocalAssetBasename(mediaItem?.filename || '');
    if (!canonicalName || !mediaItem?.data || mediaItem.data.length === 0) continue;
    const lower = canonicalName.toLowerCase();
    if (!resolvedByLowerName.has(lower)) {
      resolvedByLowerName.set(lower, { filename: canonicalName, data: mediaItem.data });
    }
  }
  const referencedMediaFiles = new Map<string, Buffer>();

  db.run(`
    CREATE TABLE col (
      id integer primary key,
      crt integer not null,
      mod integer not null,
      scm integer not null,
      ver integer not null,
      dty integer not null,
      usn integer not null,
      ls integer not null,
      conf text not null,
      models text not null,
      decks text not null,
      dconf text not null,
      tags text not null
    );
    CREATE TABLE notes (
      id integer primary key,
      guid text not null,
      mid integer not null,
      mod integer not null,
      usn integer not null,
      tags text not null,
      flds text not null,
      sfld integer not null,
      csum integer not null,
      flags integer not null,
      data text not null
    );
    CREATE TABLE cards (
      id integer primary key,
      nid integer not null,
      did integer not null,
      ord integer not null,
      mod integer not null,
      usn integer not null,
      type integer not null,
      queue integer not null,
      due integer not null,
      ivl integer not null,
      factor integer not null,
      reps integer not null,
      lapses integer not null,
      left integer not null,
      odue integer not null,
      odid integer not null,
      flags integer not null,
      data text not null
    );
    CREATE TABLE revlog (
      id integer primary key,
      cid integer not null,
      usn integer not null,
      ease integer not null,
      ivl integer not null,
      lastIvl integer not null,
      factor integer not null,
      time integer not null,
      type integer not null
    );
    CREATE TABLE graves (
      usn integer not null,
      oid integer not null,
      type integer not null
    );
    CREATE INDEX ix_notes_usn on notes (usn);
    CREATE INDEX ix_cards_nid on cards (nid);
    CREATE INDEX ix_cards_sched on cards (did, queue, due);
    CREATE INDEX ix_cards_usn on cards (usn);
    CREATE INDEX ix_revlog_usn on revlog (usn);
    CREATE INDEX ix_revlog_cid on revlog (cid);
  `);

  const fieldDefs = ['Question', 'Topic', 'Answer', 'Hint'].map((name, ord) => ({
    name,
    ord,
    sticky: false,
    rtl: false,
    font: 'Arial',
    size: 20,
    media: [],
  }));

  const modelsObj = {
    [String(CLOZE_MODEL_ID)]: {
      id: CLOZE_MODEL_ID,
      name: CLOZE_MODEL_NAME,
      type: 1,
      mod: nowSec,
      usn: -1,
      sortf: 0,
      did: deckId,
      tmpls: [
        {
          name: 'Cloze',
          ord: 0,
          qfmt: '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="cloze-text">{{cloze:Question}}</div></div>',
          afmt: '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="cloze-text">{{cloze:Question}}</div>{{#Hint}}<hr id="answer" class="med-divider"><div class="extra-box">{{Hint}}</div>{{/Hint}}</div><script>(document.querySelector(".cloze") || document.getElementById("answer"))?.scrollIntoView({behavior: "smooth", block: "center"});</script>',
          bqfmt: '',
          bafmt: '',
          did: null,
          bfont: '',
          bsize: 0,
        },
      ],
      flds: fieldDefs,
      css: ANKI_CLINICAL_CSS,
      latexPre: '',
      latexPost: '',
      latexsvg: false,
      req: [[0, 'all', [0]]],
      tags: [],
      vers: [],
    },
    [String(BASIC_MODEL_ID)]: {
      id: BASIC_MODEL_ID,
      name: BASIC_MODEL_NAME,
      type: 0,
      mod: nowSec,
      usn: -1,
      sortf: 0,
      did: deckId,
      tmpls: [
        {
          name: 'Basic',
          ord: 0,
          qfmt: '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="front-content">{{Question}}</div></div>',
          afmt: '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="front-content">{{Question}}</div><hr id="answer" class="med-divider"><div class="back-content"><div class="main-answer"><b>{{Answer}}</b></div>{{#Hint}}<div class="extra-box">{{Hint}}</div>{{/Hint}}</div></div><script>document.getElementById("answer")?.scrollIntoView({behavior: "smooth", block: "nearest"});</script>',
          bqfmt: '',
          bafmt: '',
          did: null,
          bfont: '',
          bsize: 0,
        },
      ],
      flds: fieldDefs,
      css: ANKI_CLINICAL_CSS,
      latexPre: '',
      latexPost: '',
      latexsvg: false,
      req: [[0, 'all', [0]]],
      tags: [],
      vers: [],
    },
  };

  const decksObj = {
    '1': {
      id: 1,
      mod: nowSec,
      name: 'Default',
      usn: -1,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: false,
      browserCollapsed: false,
      desc: '',
      dyn: 0,
      conf: 1,
      extendNew: 10,
      extendRev: 50,
    },
    [String(deckId)]: {
      id: deckId,
      mod: nowSec,
      name: deckName,
      usn: -1,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: false,
      browserCollapsed: false,
      desc: `Baralho Canônico Internato-First (${cleanDeckKey})`,
      dyn: 0,
      conf: 1,
      extendNew: 10,
      extendRev: 50,
    },
  };

  const confObj = {
    nextPos: 1,
    estTimes: true,
    activeDecks: [deckId],
    sortType: 'noteFld',
    timeLim: 0,
    sortBackwards: false,
    addToCur: true,
    curDeck: deckId,
    newBury: true,
    newSpread: 0,
    dueCounts: true,
    curModel: String(BASIC_MODEL_ID),
    collapseTime: 1200,
  };

  const dconfObj = {
    '1': {
      id: 1,
      mod: 0,
      name: 'Default',
      usn: 0,
      maxTaken: 60,
      autoplay: true,
      timer: 0,
      replayq: true,
      new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20 },
      rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 },
      lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
      dyn: false,
    },
  };

  db.run(`INSERT INTO col VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    1,
    nowSec,
    nowSec * 1000,
    nowSec * 1000,
    11,
    0,
    0,
    0,
    JSON.stringify(confObj),
    JSON.stringify(modelsObj),
    JSON.stringify(decksObj),
    JSON.stringify(dconfObj),
    '{}',
  ]);

  const insertNoteStmt = db.prepare(
    `INSERT OR REPLACE INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertCardStmt = db.prepare(
    `INSERT OR REPLACE INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const usedNoteIds = new Set<number>();
  const usedCardIds = new Set<number>();
  let dueCursor = 1;

  (params.notes || []).forEach((note, index) => {
    let nid = Number(note.id) > 0 ? Math.trunc(Number(note.id)) : 171000101 + index;
    while (usedNoteIds.has(nid)) {
      nid++;
    }
    usedNoteIds.add(nid);

    const regKey = `${cleanDeckKey}:id:${nid}`;
    const guid = updatedRegistry[regKey] || genankiGuidFor(deckId, cleanDeckKey, nid);
    if (initialRegistry[regKey] !== guid) {
      newRegistryEntries[regKey] = guid;
    }
    updatedRegistry[regKey] = guid;

    const isCloze = note.type === 'cloze';
    const mid = isCloze ? CLOZE_MODEL_ID : BASIC_MODEL_ID;

    const qField = sanitizeFieldMediaForApkg(
      String(note.question || ''),
      resolvedByLowerName,
      referencedMediaFiles,
      cleanDeckKey,
      nid
    );
    const tField = sanitizeFieldMediaForApkg(
      String(note.topic || ''),
      resolvedByLowerName,
      referencedMediaFiles,
      cleanDeckKey,
      nid
    );
    const aField = isCloze
      ? ''
      : sanitizeFieldMediaForApkg(
          String(note.answer || ''),
          resolvedByLowerName,
          referencedMediaFiles,
          cleanDeckKey,
          nid
        );
    let hField = sanitizeFieldMediaForApkg(
      String(note.hint || ''),
      resolvedByLowerName,
      referencedMediaFiles,
      cleanDeckKey,
      nid
    );

    if (!/<img\b/i.test(qField) && !/<img\b/i.test(hField)) {
      hField = hField
        .replace(
          /^<i>[^<]*<\/i>(?:\s*<br\s*\/?>\s*)*(?=<b>\s*Coment[aá]rio\s*:?\s*<\/b>)/i,
          ''
        )
        .trim();
    }

    const flds = [qField, tField, aField, hField].join('\x1f');
    const sfld = qField.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const csum = ankiFieldChecksum(sfld);

    const noteTags = Array.from(
      new Set([
        cleanDeckKey,
        ...(Array.isArray(note.tags)
          ? note.tags.map((t) => String(t).trim()).filter((t) => t && !/\s/.test(t))
          : []),
      ])
    );
    const tagsStr = ` ${noteTags.join(' ')} `;

    insertNoteStmt.run([nid, guid, mid, nowSec, -1, tagsStr, flds, sfld, csum, 0, '']);

    const cardOrdinals = isCloze ? extractClozeCardOrdinals(qField) : [0];
    for (const ord of cardOrdinals) {
      let cid =
        ord === 0
          ? nid < 100_000_000_000
            ? nid * 10 + 1
            : nid
          : nid < 100_000_000_000
            ? nid * 10 + ord + 1
            : nid + ord * 1_000_003;
      while (usedCardIds.has(cid)) {
        cid++;
      }
      usedCardIds.add(cid);

      insertCardStmt.run([
        cid,
        nid,
        deckId,
        ord,
        nowSec,
        -1,
        0,
        0,
        dueCursor++,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        '',
      ]);
    }
  });

  insertNoteStmt.free();
  insertCardStmt.free();

  const sqliteBytes = Buffer.from(db.export());
  db.close();

  const zipEntries: Array<{ name: string; data: Buffer }> = [
    { name: 'collection.anki21', data: sqliteBytes },
    { name: 'collection.anki2', data: sqliteBytes },
  ];

  // Package strictly only the media files referenced by exported notes (zero orphan files)
  const mediaJsonMap: Record<string, string> = {};
  let mediaIndex = 0;
  for (const [filename, data] of referencedMediaFiles.entries()) {
    const numKey = String(mediaIndex++);
    mediaJsonMap[numKey] = filename;
    zipEntries.push({
      name: numKey,
      data,
    });
  }

  zipEntries.push({
    name: 'media',
    data: Buffer.from(JSON.stringify(mediaJsonMap), 'utf8'),
  });

  return {
    apkgBuffer: buildZipArchive(zipEntries),
    updatedRegistry,
    newRegistryEntries,
  };
}
