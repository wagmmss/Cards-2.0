import type { CardType, MediaBundleItem } from '../types/deck';

export interface AnkiConnectCanonicalNote {
  id: number;
  type: CardType;
  topic: string;
  question: string;
  answer: string;
  hint: string;
  tags: string[];
}

export interface AnkiConnectMediaFailure {
  filename: string;
  reason: string;
}

export interface AnkiConnectNoteFailure {
  cardId: number;
  reason: string;
}

export interface AnkiConnectSyncResult {
  updatedInPlace: number;
  addedNew: number;
  storedMediaCount: number;
  existingMediaCount: number;
  totalMediaCount: number;
  failedMedia: AnkiConnectMediaFailure[];
  failedNotes: AnkiConnectNoteFailure[];
}

export interface AudioPreviewItem {
  filename: string;
  rawSrc: string;
  resolvedSrc: string | null;
  isPlayable: boolean;
}

export type AnkiConnectInvoker = <R = unknown>(
  action: string,
  params?: Record<string, unknown>
) => Promise<R>;

export type FetchUrlAsBase64Fn = (url: string) => Promise<string>;

export function sanitizeFsrsDeckKey(deckKey: string): string {
  return (
    String(deckKey || 'internato_deck')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'internato_deck'
  );
}

/**
 * Generates a deck-scoped FSRS tag (`fsrs_id:<deckKey>:<noteId>`) to prevent collisions
 * across distinct decks whose numeric IDs both start at 1.
 */
export function buildAnkiConnectFsrsTag(cleanDeckKey: string, noteId: number): string {
  return `fsrs_id:${sanitizeFsrsDeckKey(cleanDeckKey)}:${noteId}`;
}

/**
 * Builds the primary tag-based lookup and the deck-scoped `nid:` fallback query
 * (used to match notes previously imported via `.apkg`).
 */
export function buildAnkiConnectFindQueries(
  cleanDeckKey: string,
  deckTitle: string,
  noteId: number
): {
  fsrsTag: string;
  primaryTagQuery: string;
  fallbackDeckNidQuery: string;
} {
  const fsrsTag = buildAnkiConnectFsrsTag(cleanDeckKey, noteId);
  const escapedDeck = String(deckTitle || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  return {
    fsrsTag,
    primaryTagQuery: `tag:${fsrsTag}`,
    fallbackDeckNidQuery: `deck:"${escapedDeck}" nid:${noteId}`,
  };
}

function normalizeAudioBasename(rawSrc: string): string {
  const clean = String(rawSrc || '')
    .trim()
    .split('?')[0]
    .split('#')[0];
  if (!clean || /^data:/i.test(clean)) return '';
  const base = clean.split(/[\\/]/).pop() || clean;
  return base.trim();
}

/**
 * Converts HTML `<audio>` / `<audio><source ...></audio>` tags into Anki-native `[sound:...]`
 * tags so Anki Desktop plays audio natively without broken HTML players.
 */
export function convertFieldHtmlForAnkiConnect(rawHtml: string): string {
  if (!rawHtml) return '';
  let out = rawHtml;

  out = out.replace(
    /<audio\b[^>]*>[\s\S]*?<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/audio>/gi,
    (_full, srcVal: string) => {
      const base = normalizeAudioBasename(srcVal);
      return base ? `[sound:${base}]` : '';
    }
  );

  out = out.replace(
    /<audio\b[^>]*\bsrc=["']([^"']+)["'][^>]*>(?:[\s\S]*?<\/audio>)?/gi,
    (_full, srcVal: string) => {
      const base = normalizeAudioBasename(srcVal);
      return base ? `[sound:${base}]` : '';
    }
  );

  out = out.replace(/\[sound:([^\]]+)\]/gi, (_full, target: string) => {
    const base = normalizeAudioBasename(target);
    return base ? `[sound:${base}]` : '';
  });

  return out;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  if (typeof btoa === 'function') {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode(...slice);
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return uint8ArrayToBase64(bytes);
}

/**
 * Extracts raw base64 payload from any `data:` URI, including non-base64 UTF-8 / URL-encoded
 * SVGs (`data:image/svg+xml;utf8,...` or `data:image/svg+xml,%3Csvg...`).
 */
export function extractBase64FromDataUri(dataUri: string): string | null {
  const trimmed = String(dataUri || '').trim();
  const match = trimmed.match(/^data:([^,]*),([\s\S]*)$/i);
  if (!match) return null;
  const header = match[1] || '';
  const payload = match[2] || '';
  if (!payload.trim()) return null;

  if (/;base64/i.test(header)) {
    const cleanB64 = payload.replace(/\s+/g, '');
    return cleanB64 || null;
  }

  let decoded = payload;
  try {
    decoded = decodeURIComponent(payload);
  } catch {
    // Keep raw payload when not percent-encoded
  }
  const b64 = utf8ToBase64(decoded);
  return b64 || null;
}

/**
 * Extracts audio references (`[sound:...]` and `<audio>`) from a card HTML field
 * for clean audio preview in QuickReviewModal.
 */
export function extractAudioRefsFromHtml(
  rawHtml: string,
  localMediaAssets?: Record<string, string>
): { cleanedHtml: string; audioItems: AudioPreviewItem[] } {
  if (!rawHtml) return { cleanedHtml: '', audioItems: [] };

  const localMap = new Map<string, string>();
  if (localMediaAssets) {
    for (const [k, v] of Object.entries(localMediaAssets)) {
      if (k && typeof v === 'string' && v.trim()) {
        const lower = k.trim().toLowerCase();
        localMap.set(lower, v.trim());
        const base = lower.split(/[\\/]/).pop();
        if (base) localMap.set(base, v.trim());
      }
    }
  }

  const seen = new Set<string>();
  const audioItems: AudioPreviewItem[] = [];

  const registerAudio = (rawSrc: string) => {
    const trimmed = String(rawSrc || '').trim();
    if (!trimmed) return;
    const isDirectPlayable = /^(?:data:audio\/|blob:|https?:\/\/|\/api\/)/i.test(trimmed);
    const filename = isDirectPlayable
      ? normalizeAudioBasename(trimmed) || 'audio_clinico'
      : normalizeAudioBasename(trimmed) || trimmed;
    const dedupeKey = filename.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    let resolvedSrc: string | null = null;
    if (isDirectPlayable) {
      resolvedSrc = trimmed;
    } else {
      const lowerRaw = trimmed.toLowerCase();
      resolvedSrc = localMap.get(lowerRaw) || localMap.get(dedupeKey) || null;
    }

    audioItems.push({
      filename,
      rawSrc: trimmed,
      resolvedSrc,
      isPlayable: Boolean(resolvedSrc),
    });
  };

  let cleanedHtml = rawHtml.replace(
    /(?:<br\s*\/?>\s*)*<audio\b[^>]*>[\s\S]*?<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/audio>/gi,
    (_full, srcVal: string) => {
      registerAudio(srcVal);
      return '';
    }
  );

  cleanedHtml = cleanedHtml.replace(
    /(?:<br\s*\/?>\s*)*<audio\b[^>]*\bsrc=["']([^"']+)["'][^>]*>(?:[\s\S]*?<\/audio>)?/gi,
    (_full, srcVal: string) => {
      registerAudio(srcVal);
      return '';
    }
  );

  cleanedHtml = cleanedHtml.replace(
    /(?:<br\s*\/?>\s*)*\[sound:([^\]]+)\]/gi,
    (_full, srcVal: string) => {
      registerAudio(srcVal);
      return '';
    }
  );

  cleanedHtml = cleanedHtml
    .replace(/^(?:\s*<br\s*\/?>\s*)+/i, '')
    .replace(/(?:\s*<br\s*\/?>\s*)+$/i, '')
    .trim();

  return { cleanedHtml, audioItems };
}

function getErrorReason(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err || 'Erro desconhecido');
}

export async function syncDeckToAnkiConnect(params: {
  deckKey: string;
  deckTitle: string;
  canonicalNotes: AnkiConnectCanonicalNote[];
  mediaManifest: MediaBundleItem[];
  localMediaAssets?: Record<string, string>;
  clinicalCss: string;
  invoke: AnkiConnectInvoker;
  fetchUrlAsBase64: FetchUrlAsBase64Fn;
}): Promise<AnkiConnectSyncResult> {
  const {
    deckKey,
    deckTitle,
    canonicalNotes,
    mediaManifest,
    localMediaAssets = {},
    clinicalCss,
    invoke,
    fetchUrlAsBase64,
  } = params;

  const cleanDeckKey = sanitizeFsrsDeckKey(deckKey);

  const normalizedLocalAssets = new Map<string, string>();
  for (const [k, v] of Object.entries(localMediaAssets)) {
    if (k && typeof v === 'string' && v.trim()) {
      const lower = k.trim().toLowerCase();
      normalizedLocalAssets.set(lower, v.trim());
      const base = lower.split(/[\\/]/).pop();
      if (base) normalizedLocalAssets.set(base, v.trim());
    }
  }

  await invoke('version');
  await invoke('createDeck', { deck: deckTitle });

  const existingModels = await invoke<string[]>('modelNames').catch((): string[] => []);
  const ensureModel = async (modelName: string, isCloze: boolean) => {
    if (existingModels.includes(modelName)) {
      await invoke('updateModelStyling', {
        model: { name: modelName, css: clinicalCss },
      }).catch(() => undefined);
      return;
    }
    await invoke('createModel', {
      modelName,
      inOrderFields: ['Question', 'Topic', 'Answer', 'Hint'],
      css: clinicalCss,
      isCloze,
      cardTemplates: [
        {
          Name: isCloze ? 'Cloze' : 'Basic',
          Front: isCloze
            ? '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="cloze-text">{{cloze:Question}}</div></div>'
            : '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="front-content">{{Question}}</div></div>',
          Back: isCloze
            ? '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="cloze-text">{{cloze:Question}}</div>{{#Hint}}<hr id="answer" class="med-divider"><div class="extra-box">{{Hint}}</div>{{/Hint}}</div>'
            : '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="front-content">{{Question}}</div><hr id="answer" class="med-divider"><div class="back-content"><div class="main-answer"><b>{{Answer}}</b></div>{{#Hint}}<div class="extra-box">{{Hint}}</div>{{/Hint}}</div></div>',
        },
      ],
    });
  };

  await ensureModel('Med_Cloze_Inverted_v2', true);
  await ensureModel('Med_Basic_Inverted_v2', false);

  let storedMediaCount = 0;
  let existingMediaCount = 0;
  const failedMedia: AnkiConnectMediaFailure[] = [];

  for (const item of mediaManifest) {
    const filename = (item.filename || '').trim();
    const src = (item.sourceUrl || '').trim();
    const lowerFilename = filename.toLowerCase();
    const lowerSrc = src.toLowerCase();
    const srcBasename = lowerSrc.split(/[\\/]/).pop() || lowerSrc;
    const localAssetUri =
      normalizedLocalAssets.get(lowerFilename) ||
      normalizedLocalAssets.get(lowerSrc) ||
      normalizedLocalAssets.get(srcBasename);
    const effectiveSrc = localAssetUri || src;

    if (!filename) {
      failedMedia.push({
        filename: src || '(sem nome)',
        reason: 'Nome de arquivo de mídia vazio.',
      });
      continue;
    }

    if (!effectiveSrc) {
      failedMedia.push({
        filename,
        reason: 'Origem da mídia ausente.',
      });
      continue;
    }

    try {
      if (/^data:/i.test(effectiveSrc)) {
        const b64 = extractBase64FromDataUri(effectiveSrc);
        if (!b64) {
          failedMedia.push({
            filename,
            reason: 'Data URI inválido ou vazio (imagem/SVG não pôde ser convertido para base64).',
          });
          continue;
        }
        await invoke('storeMediaFile', { filename, data: b64 });
        storedMediaCount++;
      } else if (/^\/api\//i.test(effectiveSrc)) {
        const b64 = await fetchUrlAsBase64(effectiveSrc);
        if (!b64) {
          failedMedia.push({
            filename,
            reason: `Conteúdo vazio ao ler ${effectiveSrc}.`,
          });
          continue;
        }
        await invoke('storeMediaFile', { filename, data: b64 });
        storedMediaCount++;
      } else if (/^https?:\/\//i.test(effectiveSrc)) {
        try {
          await invoke('storeMediaFile', { filename, url: effectiveSrc });
          storedMediaCount++;
        } catch (directErr) {
          // Fallback: proxy via local Express server to base64 if AnkiConnect fails hotlink/TLS
          try {
            const proxyUrl = `/api/media/proxy-image?url=${encodeURIComponent(effectiveSrc)}`;
            const b64 = await fetchUrlAsBase64(proxyUrl);
            if (!b64) throw directErr;
            await invoke('storeMediaFile', { filename, data: b64 });
            storedMediaCount++;
          } catch (proxyErr) {
            failedMedia.push({
              filename,
              reason: `Falha ao enviar mídia externa (${getErrorReason(proxyErr)}).`,
            });
          }
        }
      } else {
        // Bare local filename not attached in session: verify if already present in Anki's collection.media
        const existingInAnki = await invoke<string | false>('retrieveMediaFile', {
          filename,
        }).catch(() => false);
        if (typeof existingInAnki === 'string' && existingInAnki.length > 0) {
          existingMediaCount++;
        } else {
          failedMedia.push({
            filename,
            reason: 'Arquivo local não anexado na sessão e não encontrado no Anki (collection.media).',
          });
        }
      }
    } catch (err) {
      failedMedia.push({
        filename,
        reason: getErrorReason(err),
      });
    }
  }

  let updatedInPlace = 0;
  let addedNew = 0;
  const failedNotes: AnkiConnectNoteFailure[] = [];

  for (const note of canonicalNotes) {
    const modelName =
      note.type === 'cloze' ? 'Med_Cloze_Inverted_v2' : 'Med_Basic_Inverted_v2';
    const fields = {
      Question: convertFieldHtmlForAnkiConnect(note.question),
      Topic: note.topic,
      Answer: note.type === 'cloze' ? '' : note.answer,
      Hint: convertFieldHtmlForAnkiConnect(note.hint),
    };

    const { fsrsTag, primaryTagQuery, fallbackDeckNidQuery } = buildAnkiConnectFindQueries(
      cleanDeckKey,
      deckTitle,
      note.id
    );
    const mergedTags = Array.from(
      new Set([...(Array.isArray(note.tags) && note.tags.length > 0 ? note.tags : [cleanDeckKey]), fsrsTag])
    );

    try {
      let foundIds = await invoke<number[]>('findNotes', {
        query: primaryTagQuery,
      });

      let matchedViaFallback = false;
      if (!Array.isArray(foundIds) || foundIds.length === 0) {
        foundIds = await invoke<number[]>('findNotes', {
          query: fallbackDeckNidQuery,
        });
        matchedViaFallback = Array.isArray(foundIds) && foundIds.length > 0;
      }

      if (Array.isArray(foundIds) && foundIds.length > 0) {
        const targetAnkiNoteId = foundIds[0];
        await invoke('updateNoteFields', {
          note: { id: targetAnkiNoteId, fields },
        });
        if (matchedViaFallback) {
          await invoke('addTags', {
            notes: [targetAnkiNoteId],
            tags: fsrsTag,
          }).catch(() => undefined);
        }
        updatedInPlace++;
      } else {
        await invoke('addNote', {
          note: {
            deckName: deckTitle,
            modelName,
            fields,
            tags: mergedTags,
            options: { allowDuplicate: true },
          },
        });
        addedNew++;
      }
    } catch (err) {
      failedNotes.push({
        cardId: note.id,
        reason: getErrorReason(err),
      });
    }
  }

  return {
    updatedInPlace,
    addedNew,
    storedMediaCount,
    existingMediaCount,
    totalMediaCount: mediaManifest.length,
    failedMedia,
    failedNotes,
  };
}
