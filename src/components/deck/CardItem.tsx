import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Copy,
  Edit3,
  Image as ImageIcon,
  Search,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  CanonicalCard,
  CardAuditVerdict,
  CardLintResult,
  CardType,
  MedicalImageResult,
  PriorityLevel,
} from '../../types/deck';
import {
  CardMediaPanel,
  DeckImageUsageMap,
  extractCardImagesWithMeta,
  getOtherCardIdsForImage,
  hasImageDescriptiveLegend,
  ParsedCardImage,
} from './CardMediaPanel';
import { ImageSearchDrawer } from './ImageSearchDrawer';
import { sanitizeMedicalHtml } from '../../utils/wozniakLinter';

interface CardItemProps {
  card: CanonicalCard;
  index: number;
  cleanDeckKey: string;
  localMediaAssets?: Record<string, string>;
  lint: CardLintResult;
  isEditing: boolean;
  isImagePickerOpen: boolean;
  isZoomed: boolean;
  isMasking: boolean;
  refreshingStripCardId: number | null;
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
  onToggleSingleCardType: (card: CanonicalCard) => void;
  onAutoRepairSingleCard: (cardId: number) => void;
  onAutoRepairSingleCardWithAi?: (
    cardId: number,
    targetField?: 'question' | 'answer' | 'hint' | 'topic',
    fieldInstruction?: string
  ) => void;
  isAiRepairing?: boolean;
  onOpenImagePicker: (card: CanonicalCard) => void;
  onOpenPdfGallery?: (cardId: number, tab?: 'extracted' | 'browse') => void;
  onToggleEditing: (cardId: number) => void;
  onDeleteCard: (cardId: number) => void;
  onRemoveMissingMediaFromCard: (cardId: number) => void;
  onUpdateCard: (updated: CanonicalCard) => void;
  onSearchImagesSubmit: (card: CanonicalCard) => void;
  onAttachImage: (
    card: CanonicalCard,
    imgUrl: string,
    legendText: string,
    mode: 'recognition' | 'feedback',
    suggestedFilename?: string
  ) => void;
  onRemoveCardImages: (card: CanonicalCard) => void;
  onCloseImagePicker: () => void;
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

const AUDIT_VERDICT_CYCLE: CardAuditVerdict[] = ['keep', 'rebuild', 'split', 'prune'];
const AUDIT_VERDICT_UI: Record<
  CardAuditVerdict,
  { label: string; cls: string }
> = {
  keep: {
    label: 'Auditoria: Bom (Manter)',
    cls: 'bg-emerald-950/70 border-emerald-700/70 text-emerald-300',
  },
  rebuild: {
    label: 'Auditoria: Refazer do Zero',
    cls: 'bg-amber-950/70 border-amber-600/80 text-amber-200',
  },
  split: {
    label: 'Auditoria: Desmembrar',
    cls: 'bg-indigo-950/70 border-indigo-600/80 text-indigo-200',
  },
  prune: {
    label: 'Auditoria: Podar',
    cls: 'bg-red-950/70 border-red-700/80 text-red-200',
  },
};

export const CardItem: React.FC<CardItemProps> = ({
  card,
  index,
  cleanDeckKey,
  localMediaAssets,
  lint,
  isEditing,
  isImagePickerOpen,
  isZoomed,
  isMasking,
  refreshingStripCardId,
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
  onToggleSingleCardType,
  onAutoRepairSingleCard,
  onAutoRepairSingleCardWithAi,
  isAiRepairing = false,
  onOpenImagePicker,
  onOpenPdfGallery,
  onToggleEditing,
  onDeleteCard,
  onRemoveMissingMediaFromCard,
  onUpdateCard,
  onSearchImagesSubmit,
  onAttachImage,
  onRemoveCardImages,
  onCloseImagePicker,
  onToggleZoom,
  onApplySpoilerMask,
  onToggleImageVerified,
  onQuickSwapFromStrip,
  onRefreshQuickGallery,
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const questionImgs = extractCardImagesWithMeta(card.question, card.id, cleanDeckKey);
  const hintImgs = extractCardImagesWithMeta(card.hint, card.id, cleanDeckKey);
  const allCardImgs = [...questionImgs, ...hintImgs];
  const hasAnyImage = allCardImgs.length > 0;
  const missingFiles = lint.metrics.missingMediaFiles;
  const hasMissingMedia = missingFiles.length > 0;

  const hasDescriptiveLegend = hasImageDescriptiveLegend(card);
  const isMissingDescriptiveLegend = hasAnyImage && !hasDescriptiveLegend;

  const repeatedImageCardIds = Array.from(
    new Set(
      allCardImgs.flatMap((imgMeta) =>
        getOtherCardIdsForImage(
          deckImageUsage,
          card.id,
          imgMeta.src,
          imgMeta.localFilename,
          imgMeta.hasExplicitAnkiFile ||
            (Boolean(imgMeta.src) && !/^(?:https?:|data:|blob:|\/)/i.test(imgMeta.src.trim()))
        )
      )
    )
  ).sort((a, b) => a - b);
  const hasRepeatedImage = repeatedImageCardIds.length > 0;

  const questionTextOnly = card.question
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/(?:<br\s*\/?>\s*)+$/i, '')
    .trim();

  const handleToggleImagePlacement = (
    targetCard: CanonicalCard,
    imgMeta: ParsedCardImage,
    currentlyInQuestion: boolean
  ) => {
    const imgTag = imgMeta.hasExplicitAnkiFile
      ? `<img src="${imgMeta.src}" data-anki-file="${imgMeta.localFilename}">`
      : `<img src="${imgMeta.src}">`;

    const stripTargetImg = (html: string): string =>
      (html || '')
        .replace(/<img\b[^>]*>/gi, (match) => {
          if (
            (imgMeta.src && match.includes(imgMeta.src)) ||
            (imgMeta.localFilename && match.includes(imgMeta.localFilename))
          ) {
            return '';
          }
          return match;
        })
        .replace(/^(?:\s*<br\s*\/?>\s*)+|(?:\s*<br\s*\/?>\s*)+$/gi, '')
        .trim();

    if (currentlyInQuestion) {
      const nextQuestion = stripTargetImg(targetCard.question);
      const cleanHint = stripTargetImg(targetCard.hint);
      const nextHint = cleanHint ? `${imgTag}<br>${cleanHint}` : imgTag;
      onUpdateCard({
        ...targetCard,
        question: nextQuestion,
        hint: nextHint,
        image_mode: 'feedback',
      });
    } else {
      const nextHint = stripTargetImg(targetCard.hint);
      const cleanQuestion = stripTargetImg(targetCard.question);
      const nextQuestion = cleanQuestion ? `${cleanQuestion}<br>${imgTag}` : imgTag;
      onUpdateCard({
        ...targetCard,
        question: nextQuestion,
        hint: nextHint,
        image_mode: 'recognition',
      });
    }
  };

  return (
    <article className="p-4 sm:p-5 bg-[#0F1623] space-y-3">
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
            onClick={() => onToggleSingleCardType(card)}
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

          {/* Discreet visual alert badges for rapid clinical review */}
          {hasRepeatedImage && (
            <span
              title={`Imagem repetida: também usada no(s) card(s) ID ${repeatedImageCardIds.join(', ')}`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/70 border border-amber-700/70 text-[11px] font-medium text-amber-300"
            >
              <Copy className="w-3 h-3 text-amber-400 shrink-0" />
              <span>Imagem repetida</span>
            </span>
          )}

          {isMissingDescriptiveLegend && (
            <span
              title="Imagem sem legenda descritiva (<i>...</i>) no campo hint"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/50 border border-amber-800/60 text-[11px] font-medium text-amber-200"
            >
              <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
              <span>Sem legenda &lt;i&gt;</span>
            </span>
          )}

          {card.auditVerdict && (
            <button
              type="button"
              onClick={() => {
                const idx = AUDIT_VERDICT_CYCLE.indexOf(card.auditVerdict!);
                const next = AUDIT_VERDICT_CYCLE[(idx + 1) % AUDIT_VERDICT_CYCLE.length];
                onUpdateCard({ ...card, auditVerdict: next });
              }}
              title="Clique para alterar o veredito da auditoria antes de reconstruir o deck"
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-semibold cursor-pointer ${
                AUDIT_VERDICT_UI[card.auditVerdict].cls
              }`}
            >
              <span>{AUDIT_VERDICT_UI[card.auditVerdict].label}</span>
              {typeof card.auditScore === 'number' && (
                <span className="font-mono opacity-80">({card.auditScore}/10)</span>
              )}
            </button>
          )}
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

          {onAutoRepairSingleCardWithAi && (
            <button
              type="button"
              disabled={isAiRepairing}
              onClick={() => onAutoRepairSingleCardWithAi(card.id)}
              title="Reescreve este card com IA segundo diretrizes Matuschak & Nielsen e material anexado"
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-sky-300 bg-sky-950/60 border border-sky-700/60 hover:bg-sky-900/70 disabled:opacity-50 rounded transition-colors cursor-pointer"
            >
              <Sparkles className="w-3 h-3" />
              <span>{isAiRepairing ? 'Reescrevendo...' : 'Reescrever com IA'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onOpenImagePicker(card)}
            className={`inline-flex items-center gap-1 text-xs cursor-pointer transition-colors ${
              isImagePickerOpen || hasAnyImage
                ? 'text-sky-400 hover:text-sky-300 font-medium'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>{hasAnyImage ? 'Buscar no Google/Web' : '+ Imagem Google'}</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleEditing(card.id)}
            className="text-xs text-slate-400 hover:text-slate-100 inline-flex items-center gap-1 cursor-pointer"
          >
            <Edit3 className="w-3 h-3" />
            <span>{isEditing ? 'Fechar' : 'Editar'}</span>
          </button>

          {confirmDelete ? (
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  onDeleteCard(card.id);
                }}
                aria-label={`Confirmar exclusão do card ${card.id}`}
                className="px-1.5 py-0.5 text-[11px] font-semibold text-red-100 bg-red-900/90 border border-red-600 rounded hover:bg-red-800 cursor-pointer"
              >
                Excluir?
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Cancelar
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label={`Excluir card ${card.id}`}
              className="text-slate-500 hover:text-red-400 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Prompt to pick manually from Apostila PDF Gallery when Web images were strictly rejected */}
      {card.needsManualImage && !hasAnyImage && !hasMissingMedia && (
        <div className="px-3.5 py-2 rounded-lg bg-indigo-950/50 border border-indigo-700/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-indigo-200">
            <ImageIcon className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>
              Nenhuma imagem automática passou na validação clínica — escolha ou recorte direto da Apostila.
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {onOpenPdfGallery && (
              <button
                type="button"
                onClick={() => onOpenPdfGallery(card.id, 'extracted')}
                className="px-2.5 py-1 text-xs font-semibold text-slate-950 bg-indigo-300 hover:bg-indigo-200 rounded cursor-pointer"
              >
                Escolher na Apostila / Recortar PDF
              </button>
            )}
            <button
              type="button"
              onClick={() => onUpdateCard({ ...card, needsManualImage: false })}
              className="px-2 py-1 text-[11px] text-slate-300 hover:text-white cursor-pointer"
            >
              Manter só texto
            </button>
          </div>
        </div>
      )}

      {/* Audit Verdict Reason Box */}
      {card.auditVerdict && card.auditReason && (
        <div className="px-3 py-1.5 rounded-md bg-slate-900/70 border border-slate-800 text-[11px] text-slate-300">
          <strong className="text-slate-100">Parecer da Auditoria:</strong> {card.auditReason}
          {card.auditTargetConcept && (
            <span className="ml-2 text-sky-300">
              · Alvo: {card.auditTargetConcept}
            </span>
          )}
        </div>
      )}

      {/* Alert Box if automatic Google/Web search did not find a match */}
      {hasMissingMedia && (
        <div className="px-3.5 py-2.5 rounded-lg bg-red-950/50 border border-red-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-start gap-2 text-xs text-red-200">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-red-300">
                MISSING_MEDIA — Imagem ainda não resolvida:{' '}
              </span>
              <code className="font-mono text-red-200">
                {missingFiles.join(', ')}
              </code>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {onOpenPdfGallery && (
              <button
                type="button"
                onClick={() => onOpenPdfGallery(card.id, 'extracted')}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-950 bg-indigo-300 hover:bg-indigo-200 rounded cursor-pointer"
              >
                <ImageIcon className="w-3 h-3" />
                <span>Escolher na Apostila</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenImagePicker(card)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded cursor-pointer"
            >
              <Search className="w-3 h-3" />
              <span>Pesquisar no Google Imagens</span>
            </button>

            <button
              type="button"
              onClick={() => onRemoveMissingMediaFromCard(card.id)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-200 bg-red-900/70 hover:bg-red-800/80 border border-red-700 rounded cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              <span>Remover tag ausente</span>
            </button>
          </div>
        </div>
      )}

      {/* Other Linter Warnings List */}
      {!lint.isValid && (
        <div className="px-3 py-2 rounded-md bg-amber-950/40 border border-amber-800/70 space-y-1.5">
          {lint.warnings.map((w, wIdx) => {
            const isError = w.severity === 'error';
            const rewriteField: 'question' | 'answer' | 'hint' | 'topic' =
              w.field === 'question' ||
              w.field === 'answer' ||
              w.field === 'hint' ||
              w.field === 'topic'
                ? w.field
                : 'hint';
            return (
              <div
                key={`${w.code}-${wIdx}`}
                className={`flex items-start justify-between gap-2 text-xs ${
                  isError ? 'text-red-200' : 'text-amber-200'
                }`}
              >
                <div className="flex items-start gap-1.5 min-w-0">
                  <AlertTriangle
                    className={`w-3 h-3 shrink-0 mt-0.5 ${
                      isError ? 'text-red-400' : 'text-amber-400'
                    }`}
                  />
                  <span>
                    <strong
                      className={`font-mono ${
                        isError ? 'text-red-300' : 'text-amber-300'
                      }`}
                    >
                      [{w.field}]
                    </strong>{' '}
                    <span
                      className={`inline-block px-1 py-0 mr-1 rounded text-[10px] font-mono ${
                        isError
                          ? 'bg-red-950/80 text-red-300 border border-red-800/70'
                          : 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                      }`}
                    >
                      {isError ? 'Bloqueio Estrutural' : 'Sugestão Pedagógica'}
                    </span>
                    {w.message}
                  </span>
                </div>
                {onAutoRepairSingleCardWithAi && (
                  <button
                    type="button"
                    disabled={isAiRepairing}
                    onClick={() =>
                      onAutoRepairSingleCardWithAi(card.id, rewriteField, w.message)
                    }
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium text-sky-300 bg-sky-950/70 hover:bg-sky-900/80 border border-sky-700/60 disabled:opacity-50 rounded shrink-0 cursor-pointer transition-colors"
                  >
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>{isAiRepairing ? 'Reescrevendo...' : 'Reescrever com IA'}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Inline Medical Image Search Drawer */}
      {isImagePickerOpen && (
        <ImageSearchDrawer
          card={card}
          hasAnyImage={hasAnyImage}
          imageSearchTerm={imageSearchTerm}
          onImageSearchTermChange={onImageSearchTermChange}
          imageResults={imageResults}
          pdfExtractedImages={pdfExtractedImages}
          isSearchingImages={isSearchingImages}
          customImageUrl={customImageUrl}
          onCustomImageUrlChange={onCustomImageUrlChange}
          customImageLegend={customImageLegend}
          onCustomImageLegendChange={onCustomImageLegendChange}
          deckImageUsage={deckImageUsage}
          currentCardImageSrcs={allCardImgs.map((img) => img.src)}
          onSearchSubmit={() => onSearchImagesSubmit(card)}
          onAttachImage={onAttachImage}
          onRemoveCardImages={onRemoveCardImages}
          onOpenPdfGallery={onOpenPdfGallery}
          onClose={onCloseImagePicker}
        />
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
          <div
            className="text-sm text-slate-100 font-medium leading-relaxed [&_b]:text-sky-300 [&_strong]:text-sky-300 [&_i]:text-slate-300 [&_em]:text-slate-300"
            dangerouslySetInnerHTML={{
              __html: sanitizeMedicalHtml(questionTextOnly, {
                highlightCloze: true,
                clozeMode: 'inline',
                stripImgs: true,
              }),
            }}
          />

          <CardMediaPanel
            card={card}
            allCardImgs={allCardImgs}
            localMediaAssets={localMediaAssets}
            isZoomed={isZoomed}
            isMasking={isMasking}
            refreshingStripCardId={refreshingStripCardId}
            deckImageUsage={deckImageUsage}
            hasDescriptiveLegend={hasDescriptiveLegend}
            onToggleZoom={onToggleZoom}
            onApplySpoilerMask={onApplySpoilerMask}
            onToggleImageVerified={onToggleImageVerified}
            onQuickSwapFromStrip={onQuickSwapFromStrip}
            onRefreshQuickGallery={onRefreshQuickGallery}
            onToggleImagePlacement={handleToggleImagePlacement}
          />

          {card.type === 'basic' && (
            <div className="text-emerald-300 font-semibold pt-0.5">
              <span className="text-slate-500 font-mono mr-1.5">R:</span>
              <span
                className="[&_b]:text-emerald-200 [&_strong]:text-emerald-200 [&_i]:text-emerald-200/80"
                dangerouslySetInnerHTML={{
                  __html: sanitizeMedicalHtml(card.answer || '', {
                    stripImgs: true,
                  }),
                }}
              />
            </div>
          )}
          <div
            className="text-slate-300 leading-relaxed pt-1 [&_b]:text-slate-100 [&_strong]:text-slate-100 [&_i]:text-slate-400"
            dangerouslySetInnerHTML={{
              __html: sanitizeMedicalHtml(card.hint || '', {
                stripImgs: true,
              }),
            }}
          />
        </div>
      )}
    </article>
  );
};
