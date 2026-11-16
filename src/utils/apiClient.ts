import { MedicalImageResult } from '../types/deck';
import { resolveLocalMediaFilename } from './wozniakLinter';

export interface ParsedCardImage {
  src: string;
  localFilename: string;
  index: number;
}

export function sanitizeDeckKey(raw: string): string {
  return (
    (raw || 'internato_deck')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'internato_deck'
  );
}

export function combineAbortSignals(
  parentSignal?: AbortSignal,
  timeoutMs = 120_000
): { signal: AbortSignal; cleanup: () => void; didTimeout: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Tempo limite excedido (${Math.round(timeoutMs / 1000)}s).`));
  }, timeoutMs);

  const onParentAbort = () => {
    controller.abort(parentSignal?.reason ?? new DOMException('Operação cancelada.', 'AbortError'));
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      onParentAbort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

export async function fetchJsonWithTimeout<T>(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const { timeoutMs = 120_000, signal: parentSignal, ...fetchOpts } = options;
  const { signal, cleanup, didTimeout } = combineAbortSignals(
    parentSignal ?? undefined,
    timeoutMs
  );

  try {
    const resp = await fetch(url, {
      ...fetchOpts,
      signal,
    });
    if (!resp.ok) {
      let errMsg = `Erro HTTP ${resp.status}`;
      try {
        const errBody = (await resp.json()) as { error?: string };
        if (errBody?.error) errMsg = errBody.error;
      } catch {
        // ignore non-JSON error body
      }
      throw new Error(errMsg);
    }
    return (await resp.json()) as T;
  } catch (err: unknown) {
    if (didTimeout()) {
      throw new Error(
        `Tempo limite atingido (${Math.round(timeoutMs / 1000)}s). Tente novamente ou reduza os anexos.`
      );
    }
    if (parentSignal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
    }
    throw err;
  } finally {
    cleanup();
  }
}

export async function fetchBlobWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<{ blob: Blob; headers: Headers }> {
  const { timeoutMs = 90_000, signal: parentSignal, ...fetchOpts } = options;
  const { signal, cleanup, didTimeout } = combineAbortSignals(
    parentSignal ?? undefined,
    timeoutMs
  );

  try {
    const resp = await fetch(url, {
      ...fetchOpts,
      signal,
    });
    if (!resp.ok) {
      let errMsg = `Erro HTTP ${resp.status}`;
      try {
        const errBody = (await resp.json()) as { error?: string };
        if (errBody?.error) errMsg = errBody.error;
      } catch {
        // ignore
      }
      throw new Error(errMsg);
    }
    const blob = await resp.blob();
    return { blob, headers: resp.headers };
  } catch (err: unknown) {
    if (didTimeout()) {
      throw new Error(`Tempo limite atingido ao gerar arquivo (${Math.round(timeoutMs / 1000)}s).`);
    }
    if (parentSignal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
    }
    throw err;
  } finally {
    cleanup();
  }
}

export async function searchMedicalImagesApi(
  params: {
    query: string;
    topic?: string;
    question?: string;
    answer?: string;
    hint?: string;
    deckKey?: string;
    preferGoogleGrounding?: boolean;
  },
  signal?: AbortSignal
): Promise<MedicalImageResult[]> {
  try {
    const data = await fetchJsonWithTimeout<{ images?: MedicalImageResult[] }>(
      '/api/media/search-medical-images',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: params.query,
          topic: params.topic || '',
          question: params.question || '',
          answer: params.answer || '',
          hint: params.hint || '',
          deckKey: params.deckKey || '',
          preferGoogleGrounding: params.preferGoogleGrounding ?? true,
        }),
        timeoutMs: 32_000,
        signal,
      }
    );
    return Array.isArray(data.images) ? data.images : [];
  } catch {
    return [];
  }
}

export interface ValidateCardImageResponse {
  validated: boolean;
  isCompatible: boolean;
  visualScore?: number;
  reachable?: boolean;
  isSvg?: boolean;
  detectedModality: string;
  conflictReason: string;
  visualLegend: string;
  fallback?: boolean;
  modelUsed?: string;
}

export async function validateCardImageApi(
  params: {
    imageSource: string;
    cardTopic?: string;
    cardQuestion?: string;
    cardAnswer?: string;
    cardHint?: string;
    imageMode?: 'recognition' | 'feedback';
    captionHint?: string;
    model?: string;
  },
  signal?: AbortSignal
): Promise<ValidateCardImageResponse> {
  try {
    return await fetchJsonWithTimeout<ValidateCardImageResponse>(
      '/api/gemini/validate-image',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        timeoutMs: 52_000,
        signal,
      }
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    return {
      validated: false,
      fallback: true,
      reachable: false,
      isCompatible: false,
      detectedModality: 'unverified',
      conflictReason: 'Falha de comunicação ao validar a imagem candidato.',
      visualLegend: '',
    };
  }
}

export async function auditDeckApi(
  params: {
    deckKey: string;
    cards: Array<{
      id: number;
      type: string;
      topic: string;
      question: string;
      answer: string;
      hint: string;
      priority?: string;
    }>;
    clinicalMap?: import('../types/deck').ClinicalMapResponse | null;
    pdfs: Array<Record<string, unknown>>;
    model?: string;
  },
  signal?: AbortSignal
): Promise<import('../types/deck').DeckAuditReport> {
  return fetchJsonWithTimeout<import('../types/deck').DeckAuditReport>(
    '/api/gemini/audit-deck',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      timeoutMs: 120_000,
      signal,
    }
  );
}

export async function verifyDeckApi(
  params: {
    deckKey: string;
    cards: Array<{
      id: number;
      type: string;
      topic: string;
      question: string;
      answer: string;
      hint: string;
      image_mode?: string;
      priority?: string;
    }>;
    clinicalMap?: import('../types/deck').ClinicalMapResponse | null;
    pdfs: Array<Record<string, unknown>>;
    model?: string;
  },
  signal?: AbortSignal
): Promise<import('../types/deck').DeckFinalVerificationReport> {
  return fetchJsonWithTimeout<import('../types/deck').DeckFinalVerificationReport>(
    '/api/gemini/verify-deck',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      timeoutMs: 120_000,
      signal,
    }
  );
}

export function extractCardImagesWithMeta(
  html: string,
  cardId: number,
  deckKey: string
): ParsedCardImage[] {
  if (!html) return [];
  const results: ParsedCardImage[] = [];
  let idx = 0;
  const regex = /<img\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1] || '';
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch?.[1]) continue;
    const fileMatch = attrs.match(/\bdata-anki-file=["']([^"']+)["']/i);
    const localFilename = fileMatch?.[1]
      ? fileMatch[1].trim()
      : resolveLocalMediaFilename(match[0], srcMatch[1], cardId, idx, deckKey);
    results.push({
      src: srcMatch[1],
      localFilename,
      index: idx,
    });
    idx++;
  }
  return results;
}

/**
 * Draws an opaque anti-spoiler bar over a selected region of an image (Top, Bottom, or Top-Right corner)
 * and returns a clean, self-contained `data:image/png;base64,...` URI that works 100% offline.
 */
export async function applyCanvasSpoilerMask(
  srcUrl: string,
  region: 'top' | 'bottom' | 'corner'
): Promise<string> {
  const loadUrl =
    srcUrl.startsWith('http://') || srcUrl.startsWith('https://')
      ? `/api/media/proxy-image?url=${encodeURIComponent(srcUrl)}`
      : srcUrl;

  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth || img.width || 680;
      const h = img.naturalHeight || img.height || 380;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Contexto Canvas indisponível'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      ctx.fillStyle = '#090D16';
      if (region === 'top') {
        ctx.fillRect(0, 0, w, Math.round(h * 0.17));
      } else if (region === 'bottom') {
        const barH = Math.round(h * 0.18);
        ctx.fillRect(0, h - barH, w, barH);
      } else if (region === 'corner') {
        ctx.fillRect(Math.round(w * 0.62), 0, Math.round(w * 0.38), Math.round(h * 0.22));
      }
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Falha ao carregar imagem para tarja anti-spoiler'));
    img.src = loadUrl;
  });
}
