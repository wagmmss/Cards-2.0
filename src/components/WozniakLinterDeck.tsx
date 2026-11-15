import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  CanonicalCard,
  CardLintResult,
  DeckCurationStats,
  ExtractedDeckMetadata,
  MedicalImageResult,
} from '../types/deck';
import {
  applyCanvasSpoilerMask,
  ParsedCardImage,
  sanitizeDeckKey,
  searchMedicalImagesApi,
} from '../utils/apiClient';
import {
  applyResolvedWebImageToCard,
  convertBasicToCloze,
  convertClozeToBasic,
  extractDeckMediaManifest,
  formatCanonicalDeckJson,
  lintCard,
  resolveLocalMediaFilename,
  stripHtml,
} from '../utils/wozniakLinter';
import { CardItem } from './deck/CardItem';
import { DeckFilterMode, DeckToolbar } from './deck/DeckToolbar';

interface WozniakLinterDeckProps {
  cards: CanonicalCard[];
  deckKey: string;
  extractedMeta: ExtractedDeckMetadata;
  curationStats?: DeckCurationStats | null;
  onRemoveMissingMediaFromCard: (cardId: number) => void;
  onRemoveAllMissingMedia: () => void;
  onAutoResolveMissingImages: () => void;
  isAutoResolvingImages?: boolean;
  onOpenQuickReview: () => void;
  onCurateAndRebalance: () => void;
  onUpdateCard: (updated: CanonicalCard) => void;
  onDeleteCard: (id: number) => void;
  onAddNewCard: () => void;
  onAutoRepairAllFlagged: () => void;
  onAutoRepairSingleCard: (cardId: number) => void;
  onLoadGenericSample: () => void;
  isRepairing: boolean;
}

export const WozniakLinterDeck: React.FC<WozniakLinterDeckProps> = ({
  cards,
  deckKey,
  extractedMeta,
  curationStats,
  onRemoveMissingMediaFromCard,
  onRemoveAllMissingMedia,
  onAutoResolveMissingImages,
  isAutoResolvingImages = false,
  onOpenQuickReview,
  onCurateAndRebalance,
  onUpdateCard,
  onDeleteCard,
  onAddNewCard,
  onAutoRepairAllFlagged,
  onAutoRepairSingleCard,
  onLoadGenericSample,
  isRepairing,
}) => {
  const [filterMode, setFilterMode] = useState<DeckFilterMode>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingCardId, setEditingCardId] = useState<number | null>(null);
  const [viewTab, setViewTab] = useState<'CARDS' | 'RAW_JSON'>('CARDS');
  const [copiedJson, setCopiedJson] = useState(false);

  const [imagePickerCardId, setImagePickerCardId] = useState<number | null>(null);
  const [imageSearchTerm, setImageSearchTerm] = useState('');
  const [imageResults, setImageResults] = useState<MedicalImageResult[]>([]);
  const [isSearchingImages, setIsSearchingImages] = useState(false);
  const [refreshingStripCardId, setRefreshingStripCardId] = useState<number | null>(null);
  const [zoomedCardId, setZoomedCardId] = useState<number | null>(null);
  const [maskingCardId, setMaskingCardId] = useState<number | null>(null);

  const searchAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => searchAbortRef.current?.abort();
  }, []);

  const cleanDeckKey = sanitizeDeckKey(deckKey || 'deck');

  const lintMap = new Map<number, CardLintResult>();
  let totalFlaggedCards = 0;
  let totalCardsWithMissingMedia = 0;

  cards.forEach((card) => {
    const res = lintCard(card);
    lintMap.set(card.id, res);
    if (!res.isValid) totalFlaggedCards++;
    if (res.metrics.missingMediaFiles.length > 0) totalCardsWithMissingMedia++;
  });

  const basicCount = cards.filter((c) => c.type === 'basic').length;
  const clozeCount = cards.filter((c) => c.type === 'cloze').length;
  const basicPct = cards.length > 0 ? Math.round((basicCount / cards.length) * 100) : 0;
  const clozePct = cards.length > 0 ? 100 - basicPct : 0;

  const mediaManifest = extractDeckMediaManifest(cards, cleanDeckKey);

  const filteredCards = cards.filter((card) => {
    const lintRes = lintMap.get(card.id);
    if (filterMode === 'WARNINGS' && lintRes?.isValid) return false;
    if (
      filterMode === 'MISSING_MEDIA' &&
      (!lintRes || lintRes.metrics.missingMediaFiles.length === 0)
    )
      return false;
    if (filterMode === 'BASIC' && card.type !== 'basic') return false;
    if (filterMode === 'CLOZE' && card.type !== 'cloze') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const hay = `${card.id} ${card.topic} ${card.question} ${card.answer} ${card.hint}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const canonicalJsonString = formatCanonicalDeckJson(cards, extractedMeta, cleanDeckKey);

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(canonicalJsonString);
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = canonicalJsonString;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    }
  };

  const triggerMedicalImageSearch = async (
    targetCard: CanonicalCard,
    queryText: string
  ) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setImageResults([]);
    setIsSearchingImages(true);
    try {
      const webImages = await searchMedicalImagesApi(
        {
          query: queryText,
          topic: targetCard.topic,
          question: stripHtml(targetCard.question),
          hint: stripHtml(targetCard.hint),
          preferGoogleGrounding: true,
        },
        controller.signal
      );
      if (controller.signal.aborted) return;
      setImageResults(webImages);
      if (webImages.length > 0) {
        onUpdateCard({
          ...targetCard,
          imageAlternatives: webImages.slice(0, 6),
        });
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsSearchingImages(false);
      }
    }
  };

  const handleOpenImagePicker = (card: CanonicalCard) => {
    if (imagePickerCardId === card.id) {
      searchAbortRef.current?.abort();
      setImagePickerCardId(null);
      return;
    }
    setImagePickerCardId(card.id);
    const defaultQuery = card.topic.replace(/\s*-\s*/g, ' ').trim();
    setImageSearchTerm(defaultQuery);
    void triggerMedicalImageSearch(card, defaultQuery);
  };

  const handleRefreshQuickGallery = async (card: CanonicalCard) => {
    setRefreshingStripCardId(card.id);
    try {
      const italicMatch = (card.hint || '').match(/<i>([\s\S]*?)<\/i>/i);
      const legend = italicMatch?.[1] ? stripHtml(italicMatch[1]) : '';
      const q = `${legend} ${card.topic}`.trim();
      const webImages = await searchMedicalImagesApi({
        query: q,
        topic: card.topic,
        question: stripHtml(card.question),
        hint: stripHtml(card.hint),
        preferGoogleGrounding: true,
      });
      if (webImages.length > 0) {
        onUpdateCard({
          ...card,
          imageAlternatives: webImages.slice(0, 6),
        });
      }
    } finally {
      setRefreshingStripCardId(null);
    }
  };

  const handleQuickSwapFromStrip = (
    card: CanonicalCard,
    chosenImg: MedicalImageResult,
    currentLocalFilename: string
  ) => {
    const updated = applyResolvedWebImageToCard(
      card,
      currentLocalFilename,
      chosenImg,
      card.imageAlternatives || []
    );
    onUpdateCard({
      ...updated,
      imageVerified: true,
    });
  };

  const handleAttachMedicalImage = (
    card: CanonicalCard,
    imgUrl: string,
    legendText: string,
    mode: 'recognition' | 'feedback',
    suggestedFilename?: string
  ) => {
    if (!imgUrl.trim()) return;
    const cleanQ = card.question.replace(/\s*(?:<br\s*\/?>\s*)*<img\b[^>]*>/gi, '').trim();
    const cleanHintWithoutImgs = card.hint
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/^<i>[\s\S]*?<\/i>(?:\s*<br\s*\/?>\s*)*/i, '')
      .trim();

    const localFile =
      suggestedFilename?.trim() ||
      resolveLocalMediaFilename('', imgUrl.trim(), card.id, 0, cleanDeckKey);

    if (mode === 'recognition') {
      const safeLegend =
        legendText.trim() ||
        `Exame complementar evidenciando achado característico de ${stripHtml(card.topic)}.`;
      onUpdateCard({
        ...card,
        type: 'basic',
        answer:
          card.type === 'cloze'
            ? 'Conduta imediata guiada pelo achado visual.'
            : card.answer,
        image_mode: 'recognition',
        imageVerified: false,
        imageAlternatives: imageResults.slice(0, 6),
        question: `${cleanQ}<br><img src="${imgUrl.trim()}" data-anki-file="${localFile}">`,
        hint: `<i>${safeLegend}</i><br><br>${cleanHintWithoutImgs}`,
      });
    } else {
      onUpdateCard({
        ...card,
        image_mode: 'feedback',
        imageVerified: false,
        imageAlternatives: imageResults.slice(0, 6),
        question: cleanQ,
        hint: `${cleanHintWithoutImgs}<br><img src="${imgUrl.trim()}" data-anki-file="${localFile}">`,
      });
    }
    setImagePickerCardId(null);
  };

  const handleApplySpoilerMaskToCard = async (
    card: CanonicalCard,
    imgMeta: ParsedCardImage,
    resolvedSrc: string,
    region: 'top' | 'bottom' | 'corner'
  ) => {
    setMaskingCardId(card.id);
    try {
      const maskedPngDataUri = await applyCanvasSpoilerMask(resolvedSrc, region);
      const pngFilename =
        imgMeta.localFilename.replace(/\.[a-z0-9]+$/i, '') + '_clean.png';
      const newImgTag = `<img src="${maskedPngDataUri}" data-anki-file="${pngFilename}">`;
      const updatedQuestion = /<img\b[^>]*>/i.test(card.question)
        ? card.question.replace(/<img\b[^>]*>/i, newImgTag)
        : card.question;
      const updatedHint =
        updatedQuestion === card.question && /<img\b[^>]*>/i.test(card.hint)
          ? card.hint.replace(/<img\b[^>]*>/i, newImgTag)
          : card.hint;

      onUpdateCard({
        ...card,
        question: updatedQuestion,
        hint: updatedHint,
        imageVerified: true,
      });
    } catch {
      // Keep original image if external host blocks proxy
    } finally {
      setMaskingCardId(null);
    }
  };

  const handleRemoveCardImages = (card: CanonicalCard) => {
    const cleanQ = card.question.replace(/\s*(?:<br\s*\/?>\s*)*<img\b[^>]*>/gi, '').trim();
    const cleanHint = card.hint
      .replace(/\s*(?:<br\s*\/?>\s*)*<img\b[^>]*>/gi, '')
      .replace(/^<i>[\s\S]*?<\/i>(?:\s*<br\s*\/?>\s*)*/i, '')
      .trim();
    const updated: CanonicalCard = {
      ...card,
      question: cleanQ,
      hint: cleanHint,
    };
    delete updated.image_mode;
    delete updated.imageVerified;
    delete updated.imageAlternatives;
    onUpdateCard(updated);
  };

  if (cards.length === 0) {
    return (
      <section
        id="linter-wozniak"
        className="bg-[#111827] border border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <h2 className="text-sm font-bold text-slate-100 font-display">
            3. Revisão Clínica &amp; Mídias
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Nenhum card carregado. Gere um baralho na Etapa 2, importe um JSON existente ou teste com o exemplo clínico.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onLoadGenericSample}
            className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            Carregar Exemplo
          </button>
          <button
            type="button"
            onClick={onAddNewCard}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Novo Card</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      id="linter-wozniak"
      className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-5"
    >
      <DeckToolbar
        cardCount={cards.length}
        basicCount={basicCount}
        clozeCount={clozeCount}
        basicPct={basicPct}
        clozePct={clozePct}
        mediaCount={mediaManifest.length}
        totalFlaggedCards={totalFlaggedCards}
        totalCardsWithMissingMedia={totalCardsWithMissingMedia}
        isAutoResolvingImages={isAutoResolvingImages}
        isRepairing={isRepairing}
        curationStats={curationStats}
        filterMode={filterMode}
        viewTab={viewTab}
        searchQuery={searchQuery}
        copiedJson={copiedJson}
        onSelectFilter={setFilterMode}
        onSelectViewTab={setViewTab}
        onSearchQueryChange={setSearchQuery}
        onOpenQuickReview={onOpenQuickReview}
        onCurateAndRebalance={onCurateAndRebalance}
        onAutoRepairAllFlagged={onAutoRepairAllFlagged}
        onAutoResolveMissingImages={onAutoResolveMissingImages}
        onRemoveAllMissingMedia={onRemoveAllMissingMedia}
        onCopyJson={() => void handleCopyJson()}
        onAddNewCard={onAddNewCard}
      />

      {viewTab === 'RAW_JSON' ? (
        <pre className="p-4 rounded-lg bg-[#0B0F17] border border-slate-800 text-slate-200 text-xs font-mono overflow-x-auto max-h-[540px] leading-relaxed">
          {canonicalJsonString}
        </pre>
      ) : (
        <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg overflow-hidden">
          {filteredCards.map((card, index) => {
            const lint = lintMap.get(card.id) || lintCard(card);
            return (
              <CardItem
                key={card.id}
                card={card}
                index={index}
                cleanDeckKey={cleanDeckKey}
                lint={lint}
                isEditing={editingCardId === card.id}
                isImagePickerOpen={imagePickerCardId === card.id}
                isZoomed={zoomedCardId === card.id}
                isMasking={maskingCardId === card.id}
                isRefreshingStrip={refreshingStripCardId === card.id}
                imageSearchTerm={imageSearchTerm}
                imageResults={imageResults}
                isSearchingImages={isSearchingImages}
                onToggleEdit={() =>
                  setEditingCardId(editingCardId === card.id ? null : card.id)
                }
                onToggleCardType={() =>
                  onUpdateCard(
                    card.type === 'cloze'
                      ? convertClozeToBasic(card)
                      : convertBasicToCloze(card, true)
                  )
                }
                onUpdateCard={onUpdateCard}
                onDeleteCard={() => onDeleteCard(card.id)}
                onAutoRepairCard={() => onAutoRepairSingleCard(card.id)}
                onRemoveMissingMedia={() => onRemoveMissingMediaFromCard(card.id)}
                onOpenImagePicker={() => handleOpenImagePicker(card)}
                onCloseImagePicker={() => {
                  searchAbortRef.current?.abort();
                  setImagePickerCardId(null);
                }}
                onImageSearchTermChange={setImageSearchTerm}
                onSearchImages={(q) => void triggerMedicalImageSearch(card, q)}
                onAttachImage={(url, legend, mode, fname) =>
                  handleAttachMedicalImage(card, url, legend, mode, fname)
                }
                onRemoveCardImages={() => handleRemoveCardImages(card)}
                onToggleZoom={() =>
                  setZoomedCardId(zoomedCardId === card.id ? null : card.id)
                }
                onRefreshStrip={() => void handleRefreshQuickGallery(card)}
                onQuickSwap={(chosenImg, localFile) =>
                  handleQuickSwapFromStrip(card, chosenImg, localFile)
                }
                onApplySpoilerMask={(imgMeta, resolvedSrc, region) =>
                  void handleApplySpoilerMaskToCard(card, imgMeta, resolvedSrc, region)
                }
                onToggleVerified={() =>
                  onUpdateCard({ ...card, imageVerified: !card.imageVerified })
                }
              />
            );
          })}
        </div>
      )}
    </section>
  );
};
