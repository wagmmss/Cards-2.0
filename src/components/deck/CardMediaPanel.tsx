import React from 'react';
import {
  AlertTriangle,
  Copy,
  Eye,
  Image as ImageIcon,
  Maximize2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { CanonicalCard, MedicalImageResult } from '../../types/deck';
import {
  extractVisualLegendEntries,
  MIN_VISUAL_LEGEND_WORDS,
  resolveLocalMediaFilename,
} from '../../utils/wozniakLinter';

export interface ParsedCardImage {
  src: string;
  localFilename: string;
  hasExplicitAnkiFile: boolean;
  index: number;
}

export interface DeckImageUsageMap {
  byNormalizedSrc: Map<string, number[]>;
  byFilename: Map<string, number[]>;
}

export function normalizeImageSrcForComparison(src: string): string {
  const trimmed = (src || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http:\/\//i, 'https://').split('#')[0];
  }
  return trimmed.toLowerCase();
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
    const hasExplicitAnkiFile = Boolean(fileMatch?.[1]?.trim());
    const localFilename = hasExplicitAnkiFile
      ? fileMatch![1].trim()
      : resolveLocalMediaFilename(match[0], srcMatch[1], cardId, idx, deckKey);
    results.push({
      src: srcMatch[1],
      localFilename,
      hasExplicitAnkiFile,
      index: idx,
    });
    idx++;
  }
  return results;
}

export function hasImageDescriptiveLegend(hintOrCard: string | CanonicalCard): boolean {
  const cardObj: CanonicalCard =
    typeof hintOrCard === 'string'
      ? {
          id: 0,
          type: 'basic',
          topic: '',
          question: '',
          answer: '',
          hint: hintOrCard,
        }
      : hintOrCard;
  const entries = extractVisualLegendEntries(cardObj);
  return entries.some((entry) => entry.wordCount >= MIN_VISUAL_LEGEND_WORDS);
}

export function buildDeckImageUsageMap(
  cards: CanonicalCard[],
  deckKey: string
): DeckImageUsageMap {
  const byNormalizedSrc = new Map<string, number[]>();
  const byFilename = new Map<string, number[]>();

  const addEntry = (map: Map<string, number[]>, key: string, cardId: number) => {
    if (!key) return;
    const list = map.get(key);
    if (!list) {
      map.set(key, [cardId]);
    } else if (!list.includes(cardId)) {
      list.push(cardId);
    }
  };

  for (const card of cards) {
    const imgs = [
      ...extractCardImagesWithMeta(card.question || '', card.id, deckKey),
      ...extractCardImagesWithMeta(card.hint || '', card.id, deckKey),
    ];
    for (const img of imgs) {
      const normSrc = normalizeImageSrcForComparison(img.src);
      addEntry(byNormalizedSrc, normSrc, card.id);

      const isLocalBareFile =
        Boolean(img.src) && !/^(?:https?:|data:|blob:|\/)/i.test(img.src.trim());
      if (img.hasExplicitAnkiFile || isLocalBareFile) {
        addEntry(byFilename, img.localFilename.toLowerCase(), card.id);
      }
    }
  }

  return { byNormalizedSrc, byFilename };
}

export function getOtherCardIdsForImage(
  usage: DeckImageUsageMap,
  currentCardId: number,
  src: string,
  filename?: string,
  checkFilename: boolean = false,
  altSrc?: string
): number[] {
  const otherIds = new Set<number>();

  for (const candidateSrc of [src, altSrc]) {
    if (!candidateSrc) continue;
    const norm = normalizeImageSrcForComparison(candidateSrc);
    if (!norm) continue;
    for (const id of usage.byNormalizedSrc.get(norm) || []) {
      if (id !== currentCardId) {
        otherIds.add(id);
      }
    }
  }

  if (checkFilename && filename) {
    const cleanFile = filename.trim().toLowerCase();
    for (const id of usage.byFilename.get(cleanFile) || []) {
      if (id !== currentCardId) {
        otherIds.add(id);
      }
    }
  }

  return Array.from(otherIds).sort((a, b) => a - b);
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
        reject(new Error('Canvas context unavailable'));
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
    img.onerror = () => reject(new Error('Falha ao carregar imagem para máscara anti-spoiler'));
    img.src = loadUrl;
  });
}

interface CardMediaPanelProps {
  card: CanonicalCard;
  allCardImgs: ParsedCardImage[];
  localMediaAssets?: Record<string, string>;
  isZoomed: boolean;
  isMasking: boolean;
  refreshingStripCardId: number | null;
  deckImageUsage: DeckImageUsageMap;
  hasDescriptiveLegend: boolean;
  onToggleZoom: (cardId: number) => void;
  onApplySpoilerMask: (
    card: CanonicalCard,
    imgMeta: ParsedCardImage,
    resolvedSrc: string,
    region: 'top' | 'bottom' | 'corner'
  ) => void;
  onToggleImageVerified: (card: CanonicalCard) => void;
  onQuickSwapFromStrip: (
    card: CanonicalCard,
    chosenImg: MedicalImageResult,
    currentLocalFilename: string,
    alternatives: MedicalImageResult[]
  ) => void;
  onRefreshQuickGallery: (card: CanonicalCard) => void;
}

function resolvePreviewImageSrc(
  rawSrc: string,
  localFilename: string,
  localMediaAssets?: Record<string, string>
): string {
  const trimmed = (rawSrc || '').trim();
  if (!trimmed) return '';
  if (/^(?:https?:\/\/|data:image\/|blob:|\/)/i.test(trimmed)) {
    return trimmed;
  }
  if (/^(?:pdfimg|buscar_imagem):/i.test(trimmed)) {
    return '';
  }
  if (localMediaAssets) {
    const candidates = [
      trimmed,
      localFilename,
      trimmed.split(/[\\/]/).pop() || trimmed,
      localFilename.split(/[\\/]/).pop() || localFilename,
    ]
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    for (const [k, v] of Object.entries(localMediaAssets)) {
      if (!v) continue;
      const lowerK = k.trim().toLowerCase();
      const baseK = lowerK.split(/[\\/]/).pop() || lowerK;
      if (candidates.includes(lowerK) || candidates.includes(baseK)) {
        return v;
      }
    }
  }
  return '';
}

export const CardMediaPanel: React.FC<CardMediaPanelProps> = ({
  card,
  allCardImgs,
  localMediaAssets,
  isZoomed,
  isMasking,
  refreshingStripCardId,
  deckImageUsage,
  hasDescriptiveLegend,
  onToggleZoom,
  onApplySpoilerMask,
  onToggleImageVerified,
  onQuickSwapFromStrip,
  onRefreshQuickGallery,
}) => {
  if (allCardImgs.length === 0) return null;

  const cardAlternatives: MedicalImageResult[] =
    card.imageAlternatives && card.imageAlternatives.length > 0
      ? card.imageAlternatives
      : [];

  return (
    <div className="space-y-2 pt-1">
      {allCardImgs.map((imgMeta, i) => {
        const resolvedImgSrc = resolvePreviewImageSrc(
          imgMeta.src,
          imgMeta.localFilename,
          localMediaAssets
        );

        const otherCardIds = getOtherCardIdsForImage(
          deckImageUsage,
          card.id,
          imgMeta.src,
          imgMeta.localFilename,
          imgMeta.hasExplicitAnkiFile ||
            (Boolean(imgMeta.src) && !/^(?:https?:|data:|blob:|\/)/i.test(imgMeta.src.trim()))
        );
        const isRepeatedImage = otherCardIds.length > 0;

        const isInQuestion =
          card.image_mode === 'recognition' ||
          (imgMeta.src
            ? card.question.includes(imgMeta.src)
            : imgMeta.localFilename
            ? card.question.includes(imgMeta.localFilename)
            : false);

        return (
          <div
            key={`${imgMeta.localFilename}-${i}`}
            className={`rounded-lg overflow-hidden border bg-[#0B0F17] p-2.5 space-y-2.5 ${
              isRepeatedImage
                ? 'border-amber-600/80'
                : card.imageVerified
                ? 'border-emerald-700/70'
                : resolvedImgSrc
                ? 'border-slate-700/90'
                : 'border-amber-700/80'
            } ${isZoomed ? 'max-w-full' : 'max-w-xl'}`}
          >
            {/* Image placement & clinical media alerts */}
            <div className="flex flex-wrap items-center gap-1.5 pb-1">
              <span
                title={
                  isInQuestion
                    ? 'Imagem posicionada na FRENTE do card (Recognition — diagnóstico visual na pergunta)'
                    : 'Imagem posicionada no VERSO do card (Feedback/Hint — apoio visual após resposta)'
                }
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold tracking-wide uppercase ${
                  isInQuestion
                    ? 'bg-sky-950/70 border-sky-700/70 text-sky-300'
                    : 'bg-slate-800/80 border-slate-700 text-slate-300'
                }`}
              >
                {isInQuestion ? 'FRENTE (Recognition)' : 'VERSO (Feedback)'}
              </span>

              {isRepeatedImage && (
                <span
                  title={`Esta imagem também está sendo usada no(s) card(s) ID ${otherCardIds.join(', ')}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/70 border border-amber-700/70 text-[11px] font-medium text-amber-300"
                >
                  <Copy className="w-3 h-3 text-amber-400 shrink-0" />
                  <span>Imagem repetida</span>
                  <span className="font-mono text-[10px] text-amber-400/90">
                    (ID {otherCardIds.join(', ')})
                  </span>
                </span>
              )}

              {!hasDescriptiveLegend && (
                <span
                  title={`Esta imagem está sem legenda descritiva em <i>...</i> com pelo menos ${MIN_VISUAL_LEGEND_WORDS} palavras no campo hint`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/50 border border-amber-800/60 text-[11px] font-medium text-amber-200"
                >
                  <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                  <span>Sem legenda descritiva (mín. {MIN_VISUAL_LEGEND_WORDS} pal.)</span>
                  <code className="font-mono text-[10px] text-amber-300/90">
                    &lt;i&gt;...&lt;/i&gt;
                  </code>
                </span>
              )}
            </div>

            {resolvedImgSrc ? (
              <img
                src={resolvedImgSrc}
                alt={`Exame clínico do card ${card.id}`}
                referrerPolicy="no-referrer"
                className={`${
                  isZoomed ? 'max-h-[460px]' : 'max-h-56'
                } w-auto rounded object-contain mx-auto transition-all`}
              />
            ) : (
              <div className="px-3 py-2 text-[11px] font-mono text-amber-300 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>
                    {card.isResolvingImage
                      ? `Buscando imagem no Google/Web para ${imgMeta.localFilename}...`
                      : `Clique em uma miniatura online abaixo para definir ${imgMeta.localFilename}`}
                  </span>
                </div>
              </div>
            )}

            {/* Tira Compacta de 4–6 Miniaturas Alternativas Online (Troca em 1 Clique) */}
            {cardAlternatives.length > 0 && (
              <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                  <span>
                    Troca rápida online em 1 clique ({cardAlternatives.slice(0, 6).length} opções do Google/Web):
                  </span>
                  <button
                    type="button"
                    disabled={refreshingStripCardId === card.id}
                    onClick={() => onRefreshQuickGallery(card)}
                    className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${
                        refreshingStripCardId === card.id ? 'animate-spin' : ''
                      }`}
                    />
                    <span>Mais opções do Google</span>
                  </button>
                </div>

                <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                  {cardAlternatives.slice(0, 6).map((alt) => {
                    const isSelected = resolvedImgSrc === alt.thumbUrl;
                    const altUsedInOtherCards = getOtherCardIdsForImage(
                      deckImageUsage,
                      card.id,
                      alt.thumbUrl,
                      alt.suggestedFilename,
                      false,
                      alt.fullUrl
                    );
                    const isAltInUseElsewhere = altUsedInOtherCards.length > 0;

                    return (
                      <button
                        key={alt.id}
                        type="button"
                        onClick={() =>
                          onQuickSwapFromStrip(
                            card,
                            alt,
                            imgMeta.localFilename,
                            cardAlternatives
                          )
                        }
                        title={
                          isAltInUseElsewhere
                            ? `${alt.title} (${alt.source}) — Já em uso no(s) card(s) ID ${altUsedInOtherCards.join(', ')}`
                            : `${alt.title} (${alt.source})`
                        }
                        className={`relative h-12 rounded border overflow-hidden bg-slate-950 flex items-center justify-center cursor-pointer transition-all ${
                          isSelected
                            ? 'border-emerald-400 ring-1 ring-emerald-400/50'
                            : isAltInUseElsewhere
                            ? 'border-amber-600/80 hover:border-amber-400 opacity-85'
                            : 'border-slate-800 hover:border-sky-400'
                        }`}
                      >
                        <img
                          src={alt.thumbUrl}
                          alt={alt.title}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="max-h-full max-w-full object-contain"
                        />
                        {isAltInUseElsewhere && !isSelected && (
                          <span className="absolute top-0.5 right-0.5 px-1 py-0 rounded bg-amber-950/90 border border-amber-600/80 text-[8px] font-mono text-amber-300 leading-tight">
                            Em uso
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Barra de Inspeção Visual: Offline Filename + Checagem Anti-Spoiler */}
            <div className="pt-2 border-t border-slate-800/90 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex items-center gap-1.5 font-mono text-slate-400 truncate">
                <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-sky-300">
                  collection.media/{imgMeta.localFilename}
                </span>
              </div>

              {resolvedImgSrc && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onToggleZoom(card.id)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
                  >
                    <Maximize2 className="w-3 h-3" />
                    <span>{isZoomed ? 'Reduzir' : 'Zoom'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={isMasking}
                    onClick={() =>
                      onApplySpoilerMask(card, imgMeta, resolvedImgSrc, 'top')
                    }
                    title="Aplica uma tarja escura no topo da figura para cobrir títulos ou setas com spoiler e salva como PNG offline"
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                  >
                    Tarjar Topo
                  </button>

                  <button
                    type="button"
                    disabled={isMasking}
                    onClick={() =>
                      onApplySpoilerMask(card, imgMeta, resolvedImgSrc, 'bottom')
                    }
                    title="Aplica uma tarja escura no rodapé da figura para cobrir legendas ou marcas d'água e salva como PNG offline"
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                  >
                    Tarjar Base
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleImageVerified(card)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium cursor-pointer border transition-colors ${
                      card.imageVerified
                        ? 'bg-emerald-950/70 border-emerald-700 text-emerald-300'
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {card.imageVerified ? (
                      <>
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        <span>Sem Spoiler ✓</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3 h-3" />
                        <span>Aprovar</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
