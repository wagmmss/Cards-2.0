import React, { useState } from 'react';
import {
  Zap,
  Copy,
  Download,
  Check,
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Plus,
  Trash2,
  Image as ImageIcon,
  Search,
  X,
  ArrowLeftRight,
  Archive,
  ShieldCheck,
  Eye,
  Maximize2,
} from 'lucide-react';
import {
  CanonicalCard,
  CardLintResult,
  CardType,
  DeckCurationStats,
  ExtractedDeckMetadata,
  MedicalImageResult,
  PriorityLevel,
} from '../types/deck';
import {
  convertBasicToCloze,
  convertClozeToBasic,
  extractDeckMediaManifest,
  formatCanonicalDeckJson,
  lintCard,
  resolveLocalMediaFilename,
  stripHtml,
} from '../utils/wozniakLinter';
import { matchMedicalAtlasImages } from '../data/medicalDiagnosticAtlas';

interface WozniakLinterDeckProps {
  cards: CanonicalCard[];
  deckKey: string;
  extractedMeta: ExtractedDeckMetadata;
  curationStats?: DeckCurationStats | null;
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
  isExportingBundle?: boolean;
}

interface ParsedCardImage {
  src: string;
  localFilename: string;
  index: number;
}

function extractCardImagesWithMeta(
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
async function applyCanvasSpoilerMask(
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

export const WozniakLinterDeck: React.FC<WozniakLinterDeckProps> = ({
  cards,
  deckKey,
  extractedMeta,
  curationStats,
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
  isExportingBundle = false,
}) => {
  const [filterMode, setFilterMode] = useState<'ALL' | 'WARNINGS' | 'BASIC' | 'CLOZE'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingCardId, setEditingCardId] = useState<number | null>(null);
  const [viewTab, setViewTab] = useState<'CARDS' | 'RAW_JSON'>('CARDS');
  const [copiedJson, setCopiedJson] = useState(false);

  // Medical Image Picker state per card
  const [imagePickerCardId, setImagePickerCardId] = useState<number | null>(null);
  const [imageSearchTerm, setImageSearchTerm] = useState('');
  const [imageResults, setImageResults] = useState<MedicalImageResult[]>([]);
  const [isSearchingImages, setIsSearchingImages] = useState(false);
  const [customImageUrl, setCustomImageUrl] = useState('');
  const [customImageLegend, setCustomImageLegend] = useState('');

  // Visual Anti-Spoiler Zoom & Masking state
  const [zoomedCardId, setZoomedCardId] = useState<number | null>(null);
  const [maskingCardId, setMaskingCardId] = useState<number | null>(null);

  const cleanDeckKey = (deckKey || 'deck').trim().toLowerCase().replace(/\s+/g, '_');

  const lintMap = new Map<number, CardLintResult>();
  let totalFlaggedCards = 0;

  cards.forEach((card) => {
    const res = lintCard(card);
    lintMap.set(card.id, res);
    if (!res.isValid) {
      totalFlaggedCards++;
    }
  });

  const basicCount = cards.filter((c) => c.type === 'basic').length;
  const clozeCount = cards.filter((c) => c.type === 'cloze').length;
  const basicPct = cards.length > 0 ? Math.round((basicCount / cards.length) * 100) : 0;
  const clozePct = cards.length > 0 ? 100 - basicPct : 0;

  const mediaManifest = extractDeckMediaManifest(cards, cleanDeckKey);

  const filteredCards = cards.filter((card) => {
    const lintRes = lintMap.get(card.id);
    if (filterMode === 'WARNINGS' && lintRes?.isValid) return false;
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
    await triggerMedicalImageSearch(defaultQuery, card.topic, card.question);
  };

  const triggerMedicalImageSearch = async (
    queryText: string,
    topicText: string = '',
    questionText: string = ''
  ) => {
    const localMatches = matchMedicalAtlasImages(`${queryText} ${topicText}`);
    setImageResults(localMatches);
    setIsSearchingImages(true);
    try {
      const res = await fetch('/api/media/search-medical-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: queryText,
          topic: topicText,
          question: stripHtml(questionText),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const webImages: MedicalImageResult[] = Array.isArray(data.images) ? data.images : [];
        if (webImages.length > 0) {
          setImageResults([...localMatches.slice(0, 3), ...webImages.slice(0, 6)]);
        }
      }
    } catch {
      // Keep local high-precision diagnostic atlas matches
    } finally {
      setIsSearchingImages(false);
    }
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
        question: `${cleanQ}<br><img src="${imgUrl.trim()}" data-anki-file="${localFile}">`,
        hint: `<i>${safeLegend}</i><br><br>${cleanHintWithoutImgs}`,
      });
    } else {
      onUpdateCard({
        ...card,
        image_mode: 'feedback',
        imageVerified: false,
        question: cleanQ,
        hint: `${cleanHintWithoutImgs}<br><img src="${imgUrl.trim()}" data-anki-file="${localFile}">`,
      });
    }
    setImagePickerCardId(null);
  };

  const handleApplySpoilerMaskToCard = async (
    card: CanonicalCard,
    imgMeta: ParsedCardImage,
    region: 'top' | 'bottom' | 'corner'
  ) => {
    setMaskingCardId(card.id);
    try {
      const maskedPngDataUri = await applyCanvasSpoilerMask(imgMeta.src, region);
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
            3. Linter Wozniak / Matuschak & Deck JSON
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

  const isProportionSkewed = cards.length >= 2 && (basicPct < 45 || basicPct > 55);

  const handleToggleSingleCardType = (card: CanonicalCard) => {
    if (card.type === 'cloze') {
      onUpdateCard(convertClozeToBasic(card));
    } else {
      onUpdateCard(convertBasicToCloze(card));
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
            3. Linter Wozniak / Matuschak & Deck Canônico
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 tabular-nums">
            <span>
              <strong className="text-slate-100">{cards.length}</strong> cards
            </span>
            <span aria-hidden="true">·</span>
            <span className={isProportionSkewed ? 'text-amber-400 font-medium' : 'text-slate-400'}>
              Proporção: <strong className="text-slate-100">{basicPct}%</strong> basic /{' '}
              <strong className="text-slate-100">{clozePct}%</strong> cloze
              {isProportionSkewed ? ' (meta: 50%/50%)' : ''}
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-sky-300">
              <strong>{mediaManifest.length}</strong> mídia(s) offline (<code className="font-mono">collection.media</code>)
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
            onClick={onCurateAndRebalance}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isProportionSkewed || !curationStats
                ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                : 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>⚖️ Revisar, Podar & Rebalancear 50/50</span>
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
                : `⚡ Auto-Reparar Avisos com IA (${totalFlaggedCards})`}
            </span>
          </button>

          <button
            type="button"
            onClick={handleCopyJson}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copiedJson ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>📋 Copiar JSON</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onDownloadJson}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>💾 Baixar {cleanDeckKey}_notes.json</span>
          </button>

          <button
            type="button"
            onClick={onDownloadOfflineBundle}
            disabled={isExportingBundle}
            title="Baixa o JSON com links locais (<img src='arquivo.ext'>) + pasta collection.media com todas as imagens salvas para estudo offline no Anki"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 rounded-lg hover:bg-sky-300 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>
              {isExportingBundle
                ? 'Empacotando mídias...'
                : `📦 Baixar Pacote Offline (.zip + collection.media)`}
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
            const isEditing = editingCardId === card.id;
            const isImagePickerOpen = imagePickerCardId === card.id;
            const questionImgs = extractCardImagesWithMeta(card.question, card.id, cleanDeckKey);
            const hintImgs = extractCardImagesWithMeta(card.hint, card.id, cleanDeckKey);
            const hasAnyImage = questionImgs.length > 0 || hintImgs.length > 0;
            const isZoomed = zoomedCardId === card.id;
            const isMasking = maskingCardId === card.id;
            const questionTextOnly = card.question
              .replace(/<img\b[^>]*>/gi, '')
              .replace(/(?:<br\s*\/?>\s*)+$/i, '')
              .trim();

            return (
              <article key={card.id} className="p-4 sm:p-5 bg-[#0F1623] space-y-3">
                {/* Metadata & Counters Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2 text-slate-400 tabular-nums">
                    <span className="font-mono font-semibold text-slate-100">
                      #{index + 1} · ID {card.id}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-sky-400">{card.priority || 'P1'}</span>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => handleToggleSingleCardType(card)}
                      title="Converter entre basic e cloze mantendo o ID FSRS"
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800/90 hover:bg-slate-700 border border-slate-700 font-mono text-slate-200 cursor-pointer transition-colors"
                    >
                      <span>{card.type}</span>
                      <ArrowLeftRight className="w-2.5 h-2.5 text-slate-400" />
                    </button>
                    {card.image_mode && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-indigo-300">
                          img:{card.image_mode}
                        </span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        lint.metrics.questionWordCount > 50
                          ? 'text-red-400 font-medium'
                          : 'text-slate-400'
                      }
                    >
                      Enunciado: {lint.metrics.questionWordCount}/50 pal.
                    </span>
                    <span aria-hidden="true">·</span>
                    {card.type === 'basic' ? (
                      <span
                        className={
                          lint.metrics.answerWordCount > 15 || lint.metrics.answerWordCount === 0
                            ? 'text-red-400 font-medium'
                            : 'text-slate-400'
                        }
                      >
                        Resposta: {lint.metrics.answerWordCount}/15 pal.
                      </span>
                    ) : (
                      <span
                        className={
                          lint.metrics.clozeCount !== 1 || lint.metrics.maxClozeWords > 5
                            ? 'text-red-400 font-medium'
                            : 'text-slate-400'
                        }
                      >
                        Cloze: {lint.metrics.clozeCount}/1 ({lint.metrics.maxClozeWords}/5 pal.)
                      </span>
                    )}
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        lint.metrics.commentVisibleCharCount > 320 ||
                        lint.metrics.commentVisibleCharCount < 140
                          ? 'text-amber-400 font-medium'
                          : 'text-slate-400'
                      }
                    >
                      Comentário: {lint.metrics.commentVisibleCharCount}/320 chars
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5">
                    {lint.isValid ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>OK</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onAutoRepairSingleCard(card.id)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-amber-300 bg-amber-950/60 border border-amber-700/60 hover:bg-amber-900/70 rounded transition-colors cursor-pointer"
                      >
                        <Zap className="w-3 h-3" />
                        <span>Reparar ({lint.warnings.length})</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleOpenImagePicker(card)}
                      className={`inline-flex items-center gap-1 text-xs cursor-pointer transition-colors ${
                        isImagePickerOpen || hasAnyImage
                          ? 'text-sky-400 hover:text-sky-300 font-medium'
                          : 'text-slate-400 hover:text-slate-100'
                      }`}
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>{hasAnyImage ? 'Trocar Imagem' : 'Buscar Imagem'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditingCardId(isEditing ? null : card.id)}
                      className="text-xs text-slate-400 hover:text-slate-100 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>{isEditing ? 'Fechar' : 'Editar'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteCard(card.id)}
                      aria-label={`Excluir card ${card.id}`}
                      className="text-slate-500 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Warnings List */}
                {!lint.isValid && (
                  <div className="px-3 py-2 rounded-md bg-amber-950/40 border border-amber-800/70 space-y-1">
                    {lint.warnings.map((w, wIdx) => (
                      <div
                        key={`${w.code}-${wIdx}`}
                        className="flex items-center gap-1.5 text-xs text-amber-200"
                      >
                        <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                        <span>
                          <strong className="font-mono text-amber-300">[{w.field}]</strong> {w.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Inline Web Medical Image Search Drawer (Google / Wikimedia Medical / Open-i) */}
                {isImagePickerOpen && (
                  <div className="p-3.5 rounded-lg bg-[#0B0F17] border border-slate-700 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-semibold text-slate-100">
                          Buscar Imagem Médica Fidedigna (Embutida Offline em collection.media)
                        </h4>
                        <p className="text-[11px] text-slate-400">
                          Ao escolher uma imagem, ela será salva com nome local (<code className="font-mono text-sky-400">&lt;img src=&quot;arquivo.ext&quot;&gt;</code>) e incluída no pacote <code className="font-mono text-sky-400">.zip</code> offline.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {hasAnyImage && (
                          <button
                            type="button"
                            onClick={() => handleRemoveCardImages(card)}
                            className="px-2 py-1 text-[11px] text-red-400 hover:text-red-300 border border-red-900/60 rounded cursor-pointer"
                          >
                            Remover imagem atual
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setImagePickerCardId(null)}
                          className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Search input bar */}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        triggerMedicalImageSearch(imageSearchTerm, card.topic, card.question);
                      }}
                      className="flex items-center gap-2"
                    >
                      <input
                        type="text"
                        value={imageSearchTerm}
                        onChange={(e) => setImageSearchTerm(e.target.value)}
                        placeholder="Ex.: apendicite aguda TC, IAM supra ST ECG, pneumotórax RX, hematoma epidural..."
                        className="flex-1 px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={isSearchingImages}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-md transition-colors cursor-pointer"
                      >
                        <Search className="w-3.5 h-3.5" />
                        <span>{isSearchingImages ? 'Buscando...' : 'Buscar na Web'}</span>
                      </button>
                    </form>

                    {/* Image Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-80 overflow-y-auto pr-1">
                      {imageResults.map((img) => (
                        <div
                          key={img.id}
                          className="flex flex-col justify-between p-2.5 rounded-lg bg-[#111827] border border-slate-800 gap-2"
                        >
                          <div className="space-y-1.5">
                            <div className="h-28 w-full bg-slate-950 rounded overflow-hidden flex items-center justify-center border border-slate-800/80">
                              <img
                                src={img.thumbUrl}
                                alt={img.title}
                                loading="lazy"
                                className="max-h-full max-w-full object-contain"
                              />
                            </div>
                            <div className="text-[11px] font-semibold text-slate-200 line-clamp-1">
                              {img.title}
                            </div>
                            <p className="text-[10px] text-slate-400 line-clamp-2 leading-snug">
                              {img.description}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() =>
                                handleAttachMedicalImage(
                                  card,
                                  img.thumbUrl,
                                  img.defaultLegend,
                                  'recognition',
                                  img.suggestedFilename
                                )
                              }
                              className="flex-1 px-2 py-1 text-[10px] font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded text-center cursor-pointer"
                            >
                              + Recognition (Pergunta)
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleAttachMedicalImage(
                                  card,
                                  img.thumbUrl,
                                  img.defaultLegend,
                                  'feedback',
                                  img.suggestedFilename
                                )
                              }
                              className="px-2 py-1 text-[10px] font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-center cursor-pointer"
                            >
                              + Feedback
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Direct Custom Google Image URL input */}
                    <div className="pt-2 border-t border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <input
                        type="url"
                        value={customImageUrl}
                        onChange={(e) => setCustomImageUrl(e.target.value)}
                        placeholder="Ou cole a URL direta de qualquer imagem do Google Imagens (https://...)"
                        className="flex-1 px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500"
                      />
                      <input
                        type="text"
                        value={customImageLegend}
                        onChange={(e) => setCustomImageLegend(e.target.value)}
                        placeholder="Legenda visual opcional (para modo recognition)"
                        className="sm:w-64 px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500"
                      />
                      <button
                        type="button"
                        disabled={!customImageUrl.trim()}
                        onClick={() =>
                          handleAttachMedicalImage(
                            card,
                            customImageUrl,
                            customImageLegend,
                            'recognition'
                          )
                        }
                        className="px-3 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-40 rounded-md whitespace-nowrap cursor-pointer"
                      >
                        Baixar & Embutir URL
                      </button>
                    </div>
                  </div>
                )}

                {isEditing ? (
                  <div className="space-y-3 pt-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <input
                        type="text"
                        value={card.topic}
                        onChange={(e) => onUpdateCard({ ...card, topic: e.target.value })}
                        placeholder="Tema - Subtema"
                        className="px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-700 text-slate-100 rounded-md"
                      />
                      <select
                        value={card.type}
                        onChange={(e) => {
                          const nextType = e.target.value as CardType;
                          onUpdateCard({
                            ...card,
                            type: nextType,
                            answer: nextType === 'cloze' ? '' : card.answer,
                          });
                        }}
                        className="px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 text-slate-100 rounded-md"
                      >
                        <option value="basic">basic</option>
                        <option value="cloze">cloze</option>
                      </select>
                      <select
                        value={card.priority || 'P1'}
                        onChange={(e) =>
                          onUpdateCard({
                            ...card,
                            priority: e.target.value as PriorityLevel,
                          })
                        }
                        className="px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 text-slate-100 rounded-md"
                      >
                        <option value="P1">P1</option>
                        <option value="P2">P2</option>
                        <option value="P3">P3</option>
                        <option value="P4">P4</option>
                      </select>
                    </div>
                    <textarea
                      rows={2}
                      value={card.question}
                      onChange={(e) => onUpdateCard({ ...card, question: e.target.value })}
                      className="w-full p-2.5 text-xs bg-[#0B0F17] border border-slate-700 text-slate-100 rounded-md"
                    />
                    {card.type === 'basic' && (
                      <input
                        type="text"
                        value={card.answer}
                        onChange={(e) => onUpdateCard({ ...card, answer: e.target.value })}
                        placeholder="Resposta atômica (1 a 12 palavras, máx 15, sem ';')"
                        className="w-full px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-700 text-slate-100 rounded-md"
                      />
                    )}
                    <textarea
                      rows={2}
                      value={card.hint}
                      onChange={(e) => onUpdateCard({ ...card, hint: e.target.value })}
                      className="w-full p-2.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 text-slate-100 rounded-md"
                    />
                  </div>
                ) : (
                  <div className="space-y-2 text-xs">
                    <div className="text-sky-400/90 font-medium">{card.topic}</div>
                    <div className="text-sm text-slate-100 font-medium leading-relaxed">
                      {questionTextOnly}
                    </div>

                    {/* Visual rendering + Anti-Spoiler & Offline Media Inspector */}
                    {questionImgs.length > 0 && (
                      <div className="space-y-2 pt-1">
                        {questionImgs.map((imgMeta, i) => (
                          <div
                            key={`${imgMeta.localFilename}-${i}`}
                            className={`rounded-lg overflow-hidden border bg-[#0B0F17] p-2.5 space-y-2 ${
                              card.imageVerified
                                ? 'border-emerald-700/70'
                                : 'border-slate-700/90'
                            } ${isZoomed ? 'max-w-full' : 'max-w-xl'}`}
                          >
                            {imgMeta.src.startsWith('http://') ||
                            imgMeta.src.startsWith('https://') ||
                            imgMeta.src.startsWith('data:') ||
                            imgMeta.src.startsWith('/') ? (
                              <img
                                src={imgMeta.src}
                                alt={`Exame clínico do card ${card.id}`}
                                className={`${
                                  isZoomed ? 'max-h-[460px]' : 'max-h-56'
                                } w-auto rounded object-contain mx-auto transition-all`}
                              />
                            ) : (
                              <div className="px-3 py-2 text-[11px] font-mono text-slate-400 flex items-center gap-2">
                                <ImageIcon className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                <span>
                                  Arquivo local em collection.media: <strong className="text-slate-200">{imgMeta.localFilename}</strong> (clique em &quot;Trocar Imagem&quot; para buscar na web)
                                </span>
                              </div>
                            )}

                            {/* Barra de Inspeção Visual: Offline Filename + Checagem Anti-Spoiler */}
                            <div className="pt-2 border-t border-slate-800/90 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                              <div className="flex items-center gap-1.5 font-mono text-slate-400 truncate">
                                <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-sky-300">
                                  collection.media/{imgMeta.localFilename}
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setZoomedCardId(isZoomed ? null : card.id)
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
                                >
                                  <Maximize2 className="w-3 h-3" />
                                  <span>{isZoomed ? 'Reduzir' : 'Inspecionar Zoom'}</span>
                                </button>

                                <button
                                  type="button"
                                  disabled={isMasking}
                                  onClick={() =>
                                    handleApplySpoilerMaskToCard(card, imgMeta, 'top')
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
                                    handleApplySpoilerMaskToCard(card, imgMeta, 'bottom')
                                  }
                                  title="Aplica uma tarja escura no rodapé da figura para cobrir legendas ou marcas d'água e salva como PNG offline"
                                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                                >
                                  Tarjar Base
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleToggleImageVerified(card)}
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
                                      <span>Marcar Verificada</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {card.type === 'basic' && (
                      <div className="text-emerald-300 font-semibold pt-0.5">
                        <span className="text-slate-500 font-mono mr-1.5">R:</span>
                        {card.answer}
                      </div>
                    )}
                    <div
                      className="text-slate-300 leading-relaxed pt-1 [&_b]:text-slate-100 [&_i]:text-slate-400 [&_img]:mt-2 [&_img]:max-h-52 [&_img]:rounded-lg [&_img]:border [&_img]:border-slate-700"
                      dangerouslySetInnerHTML={{ __html: card.hint }}
                    />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
