import React from 'react';
import { AlertTriangle, CheckCircle2, FileText, Search, X } from 'lucide-react';
import { CanonicalCard, MedicalImageResult } from '../../types/deck';
import {
  DeckImageUsageMap,
  getOtherCardIdsForImage,
  normalizeImageSrcForComparison,
} from './CardMediaPanel';

interface ImageSearchDrawerProps {
  card: CanonicalCard;
  hasAnyImage: boolean;
  imageSearchTerm: string;
  onImageSearchTermChange: (val: string) => void;
  imageResults: MedicalImageResult[];
  pdfExtractedImages?: MedicalImageResult[];
  isSearchingImages: boolean;
  customImageUrl: string;
  onCustomImageUrlChange: (val: string) => void;
  customImageLegend: string;
  onCustomImageLegendChange: (val: string) => void;
  deckImageUsage: DeckImageUsageMap;
  currentCardImageSrcs: string[];
  onSearchSubmit: () => void;
  onAttachImage: (
    card: CanonicalCard,
    imgUrl: string,
    legendText: string,
    mode: 'recognition' | 'feedback',
    suggestedFilename?: string
  ) => void;
  onRemoveCardImages: (card: CanonicalCard) => void;
  onOpenPdfGallery?: (cardId: number, tab?: 'extracted' | 'browse') => void;
  onClose: () => void;
}

function isPdfExtractedImage(img: MedicalImageResult): boolean {
  const srcLabel = (img.source || '').toLowerCase();
  const idLabel = (img.id || '').toLowerCase();
  return srcLabel.includes('pdf') || idLabel.startsWith('pdf-') || idLabel.startsWith('pdf_');
}

export const ImageSearchDrawer: React.FC<ImageSearchDrawerProps> = ({
  card,
  hasAnyImage,
  imageSearchTerm,
  onImageSearchTermChange,
  imageResults,
  pdfExtractedImages = [],
  isSearchingImages,
  customImageUrl,
  onCustomImageUrlChange,
  customImageLegend,
  onCustomImageLegendChange,
  deckImageUsage,
  currentCardImageSrcs,
  onSearchSubmit,
  onAttachImage,
  onRemoveCardImages,
  onOpenPdfGallery,
  onClose,
}) => {
  const currentSrcSet = new Set(
    currentCardImageSrcs.map((s) => normalizeImageSrcForComparison(s)).filter(Boolean)
  );

  // Combine explicit pdfExtractedImages prop with any PDF-sourced results in imageResults (deduped by id/thumbUrl)
  const pdfSectionImages: MedicalImageResult[] = [];
  const seenPdfKeys = new Set<string>();
  for (const img of [...pdfExtractedImages, ...imageResults.filter(isPdfExtractedImage)]) {
    const key = normalizeImageSrcForComparison(img.thumbUrl) || img.id;
    if (!seenPdfKeys.has(key)) {
      seenPdfKeys.add(key);
      pdfSectionImages.push(img);
    }
  }

  const webResults = imageResults.filter((img) => !isPdfExtractedImage(img));

  const customUrlUsedInOtherCards = customImageUrl.trim()
    ? getOtherCardIdsForImage(deckImageUsage, card.id, customImageUrl.trim())
    : [];

  const renderCandidateCard = (img: MedicalImageResult, isFromPdf: boolean) => {
    const usedInOtherCardIds = getOtherCardIdsForImage(
      deckImageUsage,
      card.id,
      img.thumbUrl,
      img.suggestedFilename,
      isFromPdf,
      img.fullUrl
    );
    const isUsedInOtherCard = usedInOtherCardIds.length > 0;
    const isUsedInCurrentCard =
      currentSrcSet.has(normalizeImageSrcForComparison(img.thumbUrl)) ||
      currentSrcSet.has(normalizeImageSrcForComparison(img.fullUrl));

    return (
      <div
        key={img.id}
        className={`flex flex-col justify-between p-2.5 rounded-lg border gap-2 transition-colors ${
          isUsedInCurrentCard
            ? 'bg-emerald-950/20 border-emerald-600/80'
            : isUsedInOtherCard
            ? 'bg-amber-950/20 border-amber-600/75'
            : 'bg-[#111827] border-slate-800'
        }`}
      >
        <div className="space-y-1.5">
          <div className="relative h-28 w-full bg-slate-950 rounded overflow-hidden flex items-center justify-center border border-slate-800/80">
            <img
              src={img.thumbUrl}
              alt={img.title}
              loading="lazy"
              referrerPolicy="no-referrer"
              className={`max-h-full max-w-full object-contain transition-opacity ${
                isUsedInOtherCard && !isUsedInCurrentCard ? 'opacity-80' : ''
              }`}
            />

            {isUsedInCurrentCard && (
              <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-600/80 text-[10px] font-semibold text-emerald-300">
                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                <span>Em uso neste card</span>
              </span>
            )}

            {isUsedInOtherCard && (
              <span
                title={`Já selecionada no(s) card(s) ID ${usedInOtherCardIds.join(', ')}`}
                className={`absolute ${
                  isUsedInCurrentCard ? 'bottom-1.5 left-1.5' : 'top-1.5 left-1.5'
                } inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/95 border border-amber-500/80 text-[10px] font-semibold text-amber-200 shadow-sm`}
              >
                <AlertTriangle className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                <span>Em uso · ID {usedInOtherCardIds.join(', ')}</span>
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-1.5">
            <div className="text-[11px] font-semibold text-slate-200 line-clamp-1">
              {img.title}
            </div>
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                isFromPdf
                  ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-800/60'
                  : 'bg-slate-800 text-sky-300'
              }`}
            >
              {isFromPdf ? 'PDF' : img.source.split(' ')[0]}
            </span>
          </div>

          {isUsedInOtherCard ? (
            <p className="text-[10px] text-amber-300/95 leading-snug">
              Já usada no deck (ID {usedInOtherCardIds.join(', ')}). Evite duplicação acidental.
            </p>
          ) : (
            <p className="text-[10px] text-slate-400 line-clamp-2 leading-snug">
              {img.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 pt-1">
          <button
            type="button"
            title={
              isUsedInOtherCard
                ? `Atenção: esta imagem já está em uso no(s) card(s) ID ${usedInOtherCardIds.join(', ')}`
                : 'Anexar na pergunta (modo recognition)'
            }
            onClick={() =>
              onAttachImage(
                card,
                img.thumbUrl,
                img.defaultLegend,
                'recognition',
                img.suggestedFilename
              )
            }
            className={`flex-1 px-2 py-1 text-[10px] font-semibold rounded text-center cursor-pointer transition-colors ${
              isUsedInOtherCard
                ? 'text-amber-200 bg-amber-950/70 hover:bg-amber-900/80 border border-amber-600/80'
                : 'text-slate-950 bg-sky-400 hover:bg-sky-300'
            }`}
          >
            {isUsedInOtherCard ? '⚠ Usar em Recognition' : '+ Recognition (Pergunta)'}
          </button>
          <button
            type="button"
            title={
              isUsedInOtherCard
                ? `Atenção: esta imagem já está em uso no(s) card(s) ID ${usedInOtherCardIds.join(', ')}`
                : 'Anexar no comentário (modo feedback)'
            }
            onClick={() =>
              onAttachImage(
                card,
                img.thumbUrl,
                img.defaultLegend,
                'feedback',
                img.suggestedFilename
              )
            }
            className={`px-2 py-1 text-[10px] font-medium rounded text-center cursor-pointer border transition-colors ${
              isUsedInOtherCard
                ? 'text-amber-200 bg-amber-950/40 hover:bg-amber-900/60 border-amber-700/70'
                : 'text-slate-200 bg-slate-800 hover:bg-slate-700 border-slate-700'
            }`}
          >
            + Feedback
          </button>
        </div>
      </div>
    );
  };

  const pdfInUseCount = pdfSectionImages.filter(
    (img) =>
      getOtherCardIdsForImage(
        deckImageUsage,
        card.id,
        img.thumbUrl,
        img.suggestedFilename,
        true,
        img.fullUrl
      ).length > 0
  ).length;

  return (
    <div className="p-3.5 rounded-lg bg-[#0B0F17] border border-slate-700 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold text-slate-100">
            Busca Direta no Google Imagens / LITFL / Radiopaedia / Open-i / Wikimedia
          </h4>
          <p className="text-[11px] text-slate-400">
            Imagens validadas no backend (<code className="font-mono text-sky-400">image/*</code>) e embutidas automaticamente no pacote <code className="font-mono text-emerald-400">.apkg</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onOpenPdfGallery && (
            <button
              type="button"
              onClick={() => onOpenPdfGallery(card.id, 'browse')}
              className="px-2.5 py-1 text-[11px] font-semibold text-indigo-200 bg-indigo-950/70 hover:bg-indigo-900/80 border border-indigo-700/70 rounded cursor-pointer"
            >
              Galeria / Recortar PDF
            </button>
          )}
          {hasAnyImage && (
            <button
              type="button"
              onClick={() => onRemoveCardImages(card)}
              className="px-2 py-1 text-[11px] text-red-400 hover:text-red-300 border border-red-900/60 rounded cursor-pointer"
            >
              Remover imagem atual
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar busca de imagens"
            className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Extracted PDF Images Section (with duplicate-in-deck indicator) */}
      {pdfSectionImages.length > 0 && (
        <div className="p-3 rounded-lg bg-[#0F1623] border border-indigo-800/50 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-200">
              <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span>Imagens Extraídas do PDF ({pdfSectionImages.length})</span>
            </div>
            {pdfInUseCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/70 border border-amber-700/70 text-[11px] text-amber-300">
                <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                <span>
                  {pdfInUseCount} já em uso em outro(s) card(s)
                </span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto pr-1">
            {pdfSectionImages.map((img) => renderCandidateCard(img, true))}
          </div>
        </div>
      )}

      {/* Search input bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearchSubmit();
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={imageSearchTerm}
          onChange={(e) => onImageSearchTermChange(e.target.value)}
          placeholder="Ex.: apendicite aguda TC, IAM supra ST ECG, taquissistolia cardiotocografia..."
          className="flex-1 px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={isSearchingImages}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-md transition-colors cursor-pointer"
        >
          <Search className="w-3.5 h-3.5" />
          <span>
            {isSearchingImages ? 'Pesquisando imagens reais...' : 'Pesquisar no Google/Web'}
          </span>
        </button>
      </form>

      {/* Image Grid (Real Web Images) */}
      {isSearchingImages && webResults.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-400">
          Buscando imagens médicas reais disponíveis na internet (Google Search, Wikipedia, Wikimedia Commons, LITFL, Radiopaedia)...
        </div>
      ) : webResults.length === 0 ? (
        <div className="py-6 px-4 rounded-lg border border-slate-800 bg-[#111827] text-center space-y-1">
          <p className="text-xs font-medium text-slate-300">
            Nenhuma imagem real encontrada para &ldquo;{imageSearchTerm}&rdquo;.
          </p>
          <p className="text-[11px] text-slate-400">
            Tente termos mais específicos (ex.: nome do exame ou sinal clássico em inglês como{' '}
            <code className="font-mono text-sky-400">cardiotocography late deceleration</code> ou{' '}
            <code className="font-mono text-sky-400">acute appendicitis CT</code>) ou cole a URL direta abaixo.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-80 overflow-y-auto pr-1">
          {webResults.map((img) => renderCandidateCard(img, false))}
        </div>
      )}

      {/* Direct Custom Google Image URL input */}
      <div className="pt-2 border-t border-slate-800 space-y-1.5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            type="url"
            value={customImageUrl}
            onChange={(e) => onCustomImageUrlChange(e.target.value)}
            placeholder="Ou cole a URL direta de qualquer imagem do Google Imagens (https://...)"
            className="flex-1 px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500"
          />
          <input
            type="text"
            value={customImageLegend}
            onChange={(e) => onCustomImageLegendChange(e.target.value)}
            placeholder="Legenda visual opcional (para modo recognition)"
            className="sm:w-64 px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500"
          />
          <button
            type="button"
            disabled={!customImageUrl.trim()}
            onClick={() =>
              onAttachImage(card, customImageUrl, customImageLegend, 'recognition')
            }
            className="px-3 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-40 rounded-md whitespace-nowrap cursor-pointer"
          >
            Baixar &amp; Embutir URL
          </button>
        </div>

        {customUrlUsedInOtherCards.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              Atenção: esta URL já está em uso no(s) card(s) ID{' '}
              <strong className="font-mono">{customUrlUsedInOtherCards.join(', ')}</strong>.
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
