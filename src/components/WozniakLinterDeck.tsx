import React, { useMemo, useState } from 'react';
import {
  Zap,
  Copy,
  Download,
  Check,
  Plus,
  Trash2,
  Search,
  ArrowLeftRight,
  Archive,
  Eye,
  PackageCheck,
  MonitorUp,
} from 'lucide-react';
import {
  CanonicalCard,
  CardLintResult,
  DeckCurationStats,
  ExtractedDeckMetadata,
  MedicalImageResult,
} from '../types/deck';
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
import {
  applyCanvasSpoilerMask,
  buildDeckImageUsageMap,
  ParsedCardImage,
} from './deck/CardMediaPanel';

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
  onSyncAnkiConnect: () => void;
  isSyncingAnkiConnect?: boolean;
  onCurateAndRebalance: () => void;
  onUpdateCard: (updated: CanonicalCard) => void;
  onDeleteCard: (id: number) => void;
  onAddNewCard: () => void;
  onAutoRepairAllFlagged: () => void;
  onAutoRepairSingleCard: (cardId: number) => void;
  onLoadGenericSample: () => void;
  isRepairing: boolean;
  onDownloadJson: () => void;
  onDownloadOfflineBundle: () => void;
  onExportApkg: () => void;
  isExportingBundle?: boolean;
  isExportingApkg?: boolean;
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
  onSyncAnkiConnect,
  isSyncingAnkiConnect = false,
  onCurateAndRebalance,
  onUpdateCard,
  onDeleteCard,
  onAddNewCard,
  onAutoRepairAllFlagged,
  onAutoRepairSingleCard,
  onLoadGenericSample,
  isRepairing,
  onDownloadJson,
  onDownloadOfflineBundle,
  onExportApkg,
  isExportingBundle = false,
  isExportingApkg = false,
}) => {
  const [filterMode, setFilterMode] = useState<
    'ALL' | 'WARNINGS' | 'MISSING_MEDIA' | 'BASIC' | 'CLOZE'
  >('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingCardId, setEditingCardId] = useState<number | null>(null);
  const [viewTab, setViewTab] = useState<'CARDS' | 'RAW_JSON'>('CARDS');
  const [copiedJson, setCopiedJson] = useState(false);

  // Medical Image Picker state per card
  const [imagePickerCardId, setImagePickerCardId] = useState<number | null>(null);
  const [imageSearchTerm, setImageSearchTerm] = useState('');
  const [imageResults, setImageResults] = useState<MedicalImageResult[]>([]);
  const [isSearchingImages, setIsSearchingImages] = useState(false);
  const [refreshingStripCardId, setRefreshingStripCardId] = useState<number | null>(null);
  const [customImageUrl, setCustomImageUrl] = useState('');
  const [customImageLegend, setCustomImageLegend] = useState('');

  // Visual Anti-Spoiler Zoom & Masking state
  const [zoomedCardId, setZoomedCardId] = useState<number | null>(null);
  const [maskingCardId, setMaskingCardId] = useState<number | null>(null);

  const cleanDeckKey = (deckKey || 'deck').trim().toLowerCase().replace(/\s+/g, '_');

  const lintMap = new Map<number, CardLintResult>();
  let totalFlaggedCards = 0;
  let totalCardsWithMissingMedia = 0;

  cards.forEach((card) => {
    const res = lintCard(card);
    lintMap.set(card.id, res);
    if (!res.isValid) {
      totalFlaggedCards++;
    }
    if (res.metrics.missingMediaFiles.length > 0) {
      totalCardsWithMissingMedia++;
    }
  });

  const basicCount = cards.filter((c) => c.type === 'basic').length;
  const clozeCount = cards.filter((c) => c.type === 'cloze').length;
  const basicPct = cards.length > 0 ? Math.round((basicCount / cards.length) * 100) : 0;
  const clozePct = cards.length > 0 ? 100 - basicPct : 0;

  const mediaManifest = extractDeckMediaManifest(cards, cleanDeckKey);
  const deckImageUsage = useMemo(
    () => buildDeckImageUsageMap(cards, cleanDeckKey),
    [cards, cleanDeckKey]
  );

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

  const handleOpenImagePicker = async (card: CanonicalCard) => {
    if (imagePickerCardId === card.id) {
      setImagePickerCardId(null);
      return;
    }
    setImagePickerCardId(card.id);
    const defaultQuery = card.topic.replace(/\s*-\s*/g, ' ').trim();
    setImageSearchTerm(defaultQuery);
    setCustomImageUrl('');
    setCustomImageLegend('');
    await triggerMedicalImageSearch(card, defaultQuery, card.topic, card.question, card.hint);
  };

  const triggerMedicalImageSearch = async (
    targetCard: CanonicalCard,
    queryText: string,
    topicText: string = '',
    questionText: string = '',
    hintText: string = ''
  ) => {
    setImageResults([]);
    setIsSearchingImages(true);
    try {
      const res = await fetch('/api/media/search-medical-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: queryText,
          topic: topicText,
          question: stripHtml(questionText),
          hint: stripHtml(hintText),
          preferGoogleGrounding: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const webImages: MedicalImageResult[] = Array.isArray(data.images) ? data.images : [];
        setImageResults(webImages);
        if (webImages.length > 0) {
          onUpdateCard({
            ...targetCard,
            imageAlternatives: webImages.slice(0, 6),
          });
        }
      }
    } catch {
      setImageResults([]);
    } finally {
      setIsSearchingImages(false);
    }
  };

  const handleRefreshQuickGallery = async (card: CanonicalCard) => {
    setRefreshingStripCardId(card.id);
    try {
      const italicMatch = (card.hint || '').match(/<i>([\s\S]*?)<\/i>/i);
      const legend = italicMatch?.[1] ? stripHtml(italicMatch[1]) : '';
      const q = `${legend} ${card.topic}`.trim();
      const res = await fetch('/api/media/search-medical-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q,
          topic: card.topic,
          question: stripHtml(card.question),
          hint: stripHtml(card.hint),
          preferGoogleGrounding: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const webImages: MedicalImageResult[] = Array.isArray(data.images) ? data.images : [];
        if (webImages.length > 0) {
          onUpdateCard({
            ...card,
            imageAlternatives: webImages.slice(0, 6),
          });
        }
      }
    } catch {
      // Keep current alternatives
    } finally {
      setRefreshingStripCardId(null);
    }
  };

  const handleQuickSwapFromStrip = (
    card: CanonicalCard,
    chosenImg: MedicalImageResult,
    currentLocalFilename: string,
    alternatives: MedicalImageResult[]
  ) => {
    const updated = applyResolvedWebImageToCard(
      card,
      currentLocalFilename,
      chosenImg,
      alternatives
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
        answer: card.type === 'cloze' ? 'Conduta imediata guiada pelo achado visual.' : card.answer,
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
      const pngFilename = imgMeta.localFilename.replace(/\.[a-z0-9]+$/i, '') + '_clean.png';
      const newImgTag = `<img src="${maskedPngDataUri}" data-anki-file="${pngFilename}">`;
      const updatedQuestion = card.question.replace(/<img\b[^>]*>/i, newImgTag);
      onUpdateCard({
        ...card,
        question: updatedQuestion,
        imageVerified: true,
      });
    } catch {
      // Keep original image if external host blocks proxy
    } finally {
      setMaskingCardId(null);
    }
  };

  const handleToggleImageVerified = (card: CanonicalCard) => {
    onUpdateCard({
      ...card,
      imageVerified: !card.imageVerified,
    });
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
            3. Curadoria Matuschak &amp; Nielsen &amp; Deck JSON
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Nenhum card carregado no momento. Gere um baralho no Passo 2, importe um arquivo{' '}
            <code className="font-mono text-slate-300">*_notes.json</code> ou adicione um card manualmente.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onLoadGenericSample}
            className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            Testar com Exemplo
          </button>
          <button
            type="button"
            onClick={onAddNewCard}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Criar Card</span>
          </button>
        </div>
      </section>
    );
  }

  const handleToggleSingleCardType = (card: CanonicalCard) => {
    if (card.type === 'cloze') {
      onUpdateCard(convertClozeToBasic(card));
    } else {
      onUpdateCard(convertBasicToCloze(card, true));
    }
  };

  return (
    <section
      id="linter-wozniak"
      className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-5"
    >
      {/* Clean Header & Actions */}
      <div className="flex flex-col gap-3.5 pb-4 border-b border-slate-800">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold text-slate-100 font-display">
            3. Curadoria Matuschak &amp; Nielsen &amp; Deck Canônico
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 tabular-nums">
            <span>
              <strong className="text-slate-100">{cards.length}</strong> cards
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-slate-400">
              Formato fluido: <strong className="text-slate-100">{basicPct}%</strong> basic /{' '}
              <strong className="text-slate-100">{clozePct}%</strong> cloze
            </span>
            <span aria-hidden="true">·</span>
            <span
              className={
                totalCardsWithMissingMedia > 0 ? 'text-amber-400 font-semibold' : 'text-sky-300'
              }
            >
              <strong>{mediaManifest.length}</strong> imagem(ns)
              {isAutoResolvingImages
                ? ' (Buscando imagens no Google/Web...)'
                : totalCardsWithMissingMedia > 0
                ? ` (${totalCardsWithMissingMedia} pendente(s))`
                : ' (100% resolvidas)'}
            </span>
            <span aria-hidden="true">·</span>
            <span
              className={
                totalFlaggedCards === 0
                  ? 'text-emerald-400 font-medium'
                  : 'text-amber-400 font-medium'
              }
            >
              {cards.length - totalFlaggedCards}/{cards.length} conformes
            </span>
          </div>
        </div>

        {/* Relatório de Curadoria & Rebalanceamento */}
        {curationStats && (
          <div className="px-3.5 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300 tabular-nums">
            <span className="font-semibold text-sky-400">Relatório de Curadoria:</span>
            <span>
              Enviados: <strong className="text-slate-100">{curationStats.originalCount}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>
              Podados (IDs excluídos):{' '}
              <strong className="text-amber-400">-{curationStats.prunedCount}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>
              Novos P1–P4 (novos IDs):{' '}
              <strong className="text-emerald-400">+{curationStats.addedCount}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>
              Convertidos (basic↔cloze):{' '}
              <strong className="text-sky-300">{curationStats.convertedCount}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>
              IDs FSRS mantidos:{' '}
              <strong className="text-slate-100">{curationStats.preservedIdsCount}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>
              Final: <strong className="text-slate-100">{curationStats.finalCount}</strong> cards (
              {curationStats.basicPct}% basic / {curationStats.clozePct}% cloze)
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenQuickReview}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-indigo-400 hover:bg-indigo-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>👁️ Revisão Rápida (Anki)</span>
          </button>

          <button
            type="button"
            onClick={onCurateAndRebalance}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              !curationStats
                ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                : 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>⚖️ Revisar, Podar &amp; Auditar</span>
          </button>

          <button
            type="button"
            onClick={onAutoRepairAllFlagged}
            disabled={isRepairing || totalFlaggedCards === 0}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              totalFlaggedCards > 0
                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                : 'bg-slate-800 text-slate-500 border border-slate-700/70 cursor-not-allowed'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>
              {isRepairing
                ? 'Reparando...'
                : `⚡ Auto-Reparar Avisos (${totalFlaggedCards})`}
            </span>
          </button>

          {totalCardsWithMissingMedia > 0 && (
            <>
              <button
                type="button"
                onClick={onAutoResolveMissingImages}
                disabled={isAutoResolvingImages}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Search className="w-3.5 h-3.5" />
                <span>
                  {isAutoResolvingImages
                    ? 'Buscando no Google...'
                    : `🔍 Auto-Buscar Imagens no Google (${totalCardsWithMissingMedia})`}
                </span>
              </button>
              <button
                type="button"
                onClick={onRemoveAllMissingMedia}
                title="Remove referências de mídia que não encontraram imagem correspondente"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-200 bg-red-950/70 border border-red-700/70 rounded-lg hover:bg-red-900/70 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                <span>Limpar Órfãs</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handleCopyJson}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copiedJson ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>📋 JSON</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onDownloadJson}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>💾 {cleanDeckKey}_notes.json</span>
          </button>

          <button
            type="button"
            onClick={onDownloadOfflineBundle}
            disabled={isExportingBundle}
            title="Baixa o JSON com links locais + pasta collection.media + note_guid_registry.json + RELATORIO_MIDIAS.json"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 rounded-lg hover:bg-sky-300 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>
              {isExportingBundle ? 'Empacotando .zip...' : '📦 Pacote .zip'}
            </span>
          </button>

          <button
            type="button"
            onClick={onExportApkg}
            disabled={isExportingApkg}
            title="Gera diretamente o pacote .apkg (SQLite collection.anki21 + mídias embutidas) preservando FSRS (nid e guid determinísticos)"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <PackageCheck className="w-3.5 h-3.5" />
            <span>
              {isExportingApkg ? 'Gerando .apkg...' : '🎯 Exportar .apkg (Anki)'}
            </span>
          </button>

          <button
            type="button"
            onClick={onSyncAnkiConnect}
            disabled={isSyncingAnkiConnect}
            title="Conecta diretamente no AnkiConnect local (http://127.0.0.1:8765) para criar/atualizar as notas in-place pelo mesmo GUID FSRS"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <MonitorUp className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              {isSyncingAnkiConnect
                ? 'Sincronizando Anki...'
                : '🔌 Enviar para Anki Desktop (Local)'}
            </span>
          </button>
        </div>
      </div>

      {/* Minimalist Filter & View Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-lg">
          {(
            [
              { id: 'ALL', label: `Todos (${cards.length})` },
              { id: 'WARNINGS', label: `Avisos (${totalFlaggedCards})` },
              ...(totalCardsWithMissingMedia > 0
                ? [
                    {
                      id: 'MISSING_MEDIA' as const,
                      label: `Sem Imagem (${totalCardsWithMissingMedia})`,
                    },
                  ]
                : []),
              { id: 'BASIC', label: `Basic (${basicCount})` },
              { id: 'CLOZE', label: `Cloze (${clozeCount})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setViewTab('CARDS');
                setFilterMode(tab.id);
              }}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                viewTab === 'CARDS' && filterMode === tab.id
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setViewTab('RAW_JSON')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewTab === 'RAW_JSON'
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            JSON Canônico (Links Locais)
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar card..."
            aria-label="Filtrar cards por texto"
            className="px-3 py-1 text-xs bg-[#0B0F17] border border-slate-700 rounded-lg text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none w-44"
          />
          <button
            type="button"
            onClick={onAddNewCard}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Novo Card</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
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
                refreshingStripCardId={refreshingStripCardId}
                imageSearchTerm={imageSearchTerm}
                onImageSearchTermChange={setImageSearchTerm}
                imageResults={imageResults}
                isSearchingImages={isSearchingImages}
                customImageUrl={customImageUrl}
                onCustomImageUrlChange={setCustomImageUrl}
                customImageLegend={customImageLegend}
                onCustomImageLegendChange={setCustomImageLegend}
                deckImageUsage={deckImageUsage}
                onToggleSingleCardType={handleToggleSingleCardType}
                onAutoRepairSingleCard={onAutoRepairSingleCard}
                onOpenImagePicker={handleOpenImagePicker}
                onToggleEditing={(id) =>
                  setEditingCardId((prev) => (prev === id ? null : id))
                }
                onDeleteCard={onDeleteCard}
                onRemoveMissingMediaFromCard={onRemoveMissingMediaFromCard}
                onUpdateCard={onUpdateCard}
                onSearchImagesSubmit={(targetCard) =>
                  void triggerMedicalImageSearch(
                    targetCard,
                    imageSearchTerm,
                    targetCard.topic,
                    targetCard.question,
                    targetCard.hint
                  )
                }
                onAttachImage={handleAttachMedicalImage}
                onRemoveCardImages={handleRemoveCardImages}
                onCloseImagePicker={() => setImagePickerCardId(null)}
                onToggleZoom={(id) =>
                  setZoomedCardId((prev) => (prev === id ? null : id))
                }
                onApplySpoilerMask={handleApplySpoilerMaskToCard}
                onToggleImageVerified={handleToggleImageVerified}
                onQuickSwapFromStrip={handleQuickSwapFromStrip}
                onRefreshQuickGallery={handleRefreshQuickGallery}
              />
            );
          })}
        </div>
      )}
    </section>
  );
};
