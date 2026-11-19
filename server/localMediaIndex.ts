import fs from 'fs';
import path from 'path';

export interface LocalIndexedMediaEntry {
  relPath: string;
  absPath: string;
  filename: string;
  deckFolder: string;
  searchTokens: string[];
  captionHint: string;
}

const DEFAULT_LOCAL_MEDIA_ROOT = '/home/wagmoraes/Projetos IA/Criador de Cards/04_Mídias';
const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;
const CACHE_TTL_MS = 60_000;

let cachedRoot = '';
let cachedAt = 0;
let cachedEntries: LocalIndexedMediaEntry[] = [];

export function getLocalMediaRoot(): string | null {
  const configured = (process.env.LOCAL_MEDIA_ROOT || '').trim();
  const candidate = configured || DEFAULT_LOCAL_MEDIA_ROOT;
  try {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return path.resolve(candidate);
    }
  } catch {
    // Ignore inaccessible directory
  }
  return null;
}

function tokenizeText(raw: string): string[] {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function loadManifestCaptions(dirPath: string): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const entries = fs.readdirSync(dirPath);
    for (const file of entries) {
      if (!file.endsWith('_extraction_manifest.json')) continue;
      const raw = fs.readFileSync(path.join(dirPath, file), 'utf8');
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.images)
        ? parsed.images
        : Array.isArray(parsed?.figures)
        ? parsed.figures
        : [];
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const fname = String(it.filename || it.file || it.name || '').trim();
        const cap = String(it.caption || it.captionHint || it.description || it.context || '').trim();
        if (fname && cap) {
          map.set(fname.toLowerCase(), cap.slice(0, 220));
        }
      }
    }
  } catch {
    // Manifest optional
  }
  return map;
}

export function getLocalMediaIndex(forceRefresh = false): LocalIndexedMediaEntry[] {
  const root = getLocalMediaRoot();
  if (!root) return [];

  const now = Date.now();
  if (!forceRefresh && cachedRoot === root && now - cachedAt < CACHE_TTL_MS && cachedEntries.length > 0) {
    return cachedEntries;
  }

  const entries: LocalIndexedMediaEntry[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    let items: fs.Dirent[] = [];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const manifestCaptions = loadManifestCaptions(dir);
    const relDir = path.relative(root, dir);
    const deckFolder = relDir ? relDir.split(path.sep)[0] : '';

    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        walk(full, depth + 1);
      } else if (item.isFile() && IMAGE_EXT_RE.test(item.name)) {
        const relPath = path.relative(root, full).split(path.sep).join('/');
        const captionHint = manifestCaptions.get(item.name.toLowerCase()) || '';
        const cleanName = item.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
        const searchTokens = Array.from(
          new Set(tokenizeText(`${deckFolder} ${cleanName} ${captionHint}`))
        );
        entries.push({
          relPath,
          absPath: full,
          filename: item.name,
          deckFolder,
          searchTokens,
          captionHint: captionHint || cleanName,
        });
      }
    }
  };

  walk(root, 0);
  cachedRoot = root;
  cachedAt = now;
  cachedEntries = entries;
  return entries;
}

const ALLOWED_LOCAL_MEDIA_EXT_RE = /\.(png|jpe?g|webp|gif|mp3|ogg|wav|m4a)$/i;

export function resolveSafeLocalMediaPath(
  relPath: string,
  options?: { imagesOnly?: boolean }
): string | null {
  const root = getLocalMediaRoot();
  if (!root || !relPath) return null;
  const rawRel = String(relPath);
  if (rawRel.includes('\0')) return null;
  const cleanRel = rawRel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleanRel || cleanRel.includes('..')) return null;

  const extRegex = options?.imagesOnly ? /\.(png|jpe?g|webp|gif)$/i : ALLOWED_LOCAL_MEDIA_EXT_RE;
  if (!extRegex.test(cleanRel)) return null;

  const resolved = path.resolve(root, cleanRel);
  if (!resolved.startsWith(root + path.sep)) return null;
  try {
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return null;
    }
    const realRoot = fs.realpathSync(root);
    const realResolved = fs.realpathSync(resolved);
    if (!realResolved.startsWith(realRoot + path.sep)) {
      return null;
    }
    return realResolved;
  } catch {
    return null;
  }
}

export function searchLocalMediaArchive(params: {
  query: string;
  topic?: string;
  question?: string;
  answer?: string;
  deckKey?: string;
  limit?: number;
}): Array<{
  entry: LocalIndexedMediaEntry;
  score: number;
}> {
  const index = getLocalMediaIndex();
  if (index.length === 0) return [];

  const queryTokens = new Set(
    tokenizeText(`${params.query} ${params.topic || ''} ${params.answer || ''} ${params.question || ''}`)
  );
  if (queryTokens.size === 0) return [];

  const cleanDeck = (params.deckKey || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]+/g, '_');

  const scored: Array<{ entry: LocalIndexedMediaEntry; score: number }> = [];
  for (const entry of index) {
    let overlap = 0;
    for (const tok of entry.searchTokens) {
      if (queryTokens.has(tok)) overlap++;
    }
    if (overlap === 0) continue;

    let score = overlap * 10;
    if (cleanDeck && entry.deckFolder.toLowerCase().includes(cleanDeck)) {
      score += 18;
    }
    if (overlap >= 2) score += 8;
    scored.push({ entry, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, params.limit || 6);
}
