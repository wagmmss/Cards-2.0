import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  Image as ImageIcon,
  Maximize2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { CanonicalCard, MedicalImageResult } from '../../types/deck';
import { ParsedCardImage } from '../../utils/apiClient';

interface CardMediaPanelProps {
  card: CanonicalCard;
  images: ParsedCardImage[];
  isZoomed: boolean;
  isMasking: boolean;
  isRefreshingStrip: boolean;
  onToggleZoom: () => void;
  onRefreshStrip: () => void;
  onQuickSwap: (chosenImg: MedicalImageResult, currentLocalFilename: string) => void;
  onApplySpoilerMask: (
    imgMeta: ParsedCardImage,
    resolvedSrc: string,
    region: 'top' | 'bottom' | 'corner'
  ) => void;
  onToggleVerified: () => void;
}

export const CardMediaPanel: React.FC<CardMediaPanelProps> = ({
  card,
  images,
  isZoomed,
  isMasking,
  isRefreshingStrip,
  onToggleZoom,
  onRefreshStrip,
  onQuickSwap,
  onApplySpoilerMask,
  onToggleVerified,
}) => {
  const [showFileDetails, setShowFileDetails] = useState(false);

  if (images.length === 0) return null;

  const cardAlternatives: MedicalImageResult[] =
    card.imageAlternatives && card.imageAlternatives.length > 0
      ? card.imageAlternatives
      : [];

  return (
    <div className="space-y-2 pt-1">
      {images.map((imgMeta, i) => {
        const resolvedImgSrc =
          imgMeta.src.startsWith('http://') ||
          imgMeta.src.startsWith('https://') ||
          imgMeta.src.startsWith('data:') ||
          imgMeta.src.startsWith('/')
            ? imgMeta.src
            : '';

        return (
          <div
            key={`${imgMeta.localFilename}-${i}`}
            className={`rounded-lg overflow-hidden border bg-[#0B0F17] p-3 space-y-2.5 ${
              card.imageVerified
                ? 'border-emerald-700/70'
                : resolvedImgSrc
                ? 'border-slate-700/90'
                : 'border-amber-700/80'
            } ${isZoomed ? 'max-w-full' : 'max-w-xl'}`}
          >
            {resolvedImgSrc ? (
              <div
                onClick={onToggleZoom}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggleZoom();
                  }
                }}
                title={isZoomed ? 'Clique para reduzir' : 'Clique para ampliar'}
                className="cursor-zoom-in"
              >
                <img
                  src={resolvedImgSrc}
                  alt={`Imagem clínica do card ${card.id}`}
                  className={`${
                    isZoomed ? 'max-h-[480px]' : 'max-h-56'
                  } w-auto rounded object-contain mx-auto transition-all`}
                />
              </div>
            ) : (
              <div className="px-3 py-2 text-xs text-amber-300 flex items-center gap-2">
                <ImageIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>
                  {card.isResolvingImage
                    ? 'Buscando imagem clínica compatível...'
                    : 'Imagem pendente — clique em uma miniatura ou abra a busca de imagens.'}
                </span>
              </div>
            )}

            {/* Tira de Troca Rápida em 1 clique */}
            {cardAlternatives.length > 0 && (
              <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                  <span>
                    Troca rápida ({cardAlternatives.slice(0, 6).length} opções):
                  </span>
                  <button
                    type="button"
                    disabled={isRefreshingStrip}
                    onClick={onRefreshStrip}
                    className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 cursor-pointer whitespace-nowrap"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${isRefreshingStrip ? 'animate-spin' : ''}`}
                    />
                    <span>Buscar outras</span>
                  </button>
                </div>

                <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                  {cardAlternatives.slice(0, 6).map((alt) => {
                    const isSelected = resolvedImgSrc === alt.thumbUrl;
                    return (
                      <button
                        key={alt.id}
                        type="button"
                        onClick={() => onQuickSwap(alt, imgMeta.localFilename)}
                        title={`${alt.title} (${alt.source})`}
                        className={`h-12 rounded border overflow-hidden bg-slate-950 flex items-center justify-center cursor-pointer transition-all ${
                          isSelected
                            ? 'border-emerald-400 ring-1 ring-emerald-400/50'
                            : 'border-slate-800 hover:border-sky-400'
                        }`}
                      >
                        <img
                          src={alt.thumbUrl}
                          alt={alt.title}
                          loading="lazy"
                          className="max-h-full max-w-full object-contain"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Barra Limpa de Ferramentas Visuais (Zoom + Tarja Anti-Spoiler + Aprovação) */}
            {resolvedImgSrc && (
              <div className="pt-2 border-t border-slate-800/90 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onToggleZoom}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer whitespace-nowrap"
                  >
                    <Maximize2 className="w-3 h-3" />
                    <span>{isZoomed ? 'Reduzir' : 'Ampliar'}</span>
                  </button>

                  <span className="text-slate-600 px-0.5" aria-hidden="true">
                    |
                  </span>

                  <span className="text-slate-400">Tarjar spoiler:</span>
                  <button
                    type="button"
                    disabled={isMasking}
                    onClick={() => onApplySpoilerMask(imgMeta, resolvedImgSrc, 'top')}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer whitespace-nowrap disabled:opacity-50"
                  >
                    Topo
                  </button>
                  <button
                    type="button"
                    disabled={isMasking}
                    onClick={() => onApplySpoilerMask(imgMeta, resolvedImgSrc, 'bottom')}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer whitespace-nowrap disabled:opacity-50"
                  >
                    Base
                  </button>
                  <button
                    type="button"
                    disabled={isMasking}
                    onClick={() => onApplySpoilerMask(imgMeta, resolvedImgSrc, 'corner')}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer whitespace-nowrap disabled:opacity-50"
                  >
                    Canto
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowFileDetails((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-300 cursor-pointer whitespace-nowrap"
                  >
                    {showFileDetails ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                    <span>Arquivo</span>
                  </button>

                  <button
                    type="button"
                    onClick={onToggleVerified}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-medium cursor-pointer border transition-colors whitespace-nowrap ${
                      card.imageVerified
                        ? 'bg-emerald-950/70 border-emerald-700 text-emerald-300'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-slate-100'
                    }`}
                  >
                    {card.imageVerified ? (
                      <>
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        <span>Aprovada</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3 h-3" />
                        <span>Aprovar imagem</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {showFileDetails && (
              <div className="text-[11px] font-mono text-slate-400 pt-1 border-t border-slate-800/60 truncate">
                Mídia offline Anki: <span className="text-sky-300">collection.media/{imgMeta.localFilename}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
