import React, { useEffect, useState } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Edit3,
  Search,
  RefreshCw,
  Eye,
  Volume2,
  PackageCheck,
  MonitorUp,
  Download,
  RotateCcw,
} from 'lucide-react';
import { CanonicalCard, MedicalImageResult } from '../types/deck';
import {
  applyResolvedWebImageToCard,
  resolveLocalMediaFilename,
  sanitizeMedicalHtml,
  stripHtml,
} from '../utils/wozniakLinter';
import { extractAudioRefsFromHtml } from '../utils/ankiConnectHelpers';

interface QuickReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  cards: CanonicalCard[];
  deckKey: string;
  localMediaAssets?: Record<string, string>;
  onUpdateCard: (updated: CanonicalCard) => void;
  onExportApkg?: () => void;
  onSyncAnkiConnect?: () => void;
  onDownloadJson?: () => void;
  isExportingApkg?: boolean;
  isSyncingAnkiConnect?: boolean;
}

export const QuickReviewModal: React.FC<QuickReviewModalProps> = ({
  isOpen,
  onClose,
  cards,
  deckKey,
  localMediaAssets,
  onUpdateCard,
  onExportApkg,
  onSyncAnkiConnect,
  onDownloadJson,
  isExportingApkg = false,
  isSyncingAnkiConnect = false,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isBackShown, setIsBackShown] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isSearchingGallery, setIsSearchingGallery] = useState(false);
  const [galleryQuery, setGalleryQuery] = useState('');

  const safeIndex = cards.length > 0 ? Math.min(currentIndex, cards.length - 1) : 0;
  const currentCard = cards[safeIndex] || null;
  const cleanDeckKey = (deckKey || 'deck').trim().toLowerCase().replace(/\s+/g, '_');
  const approvedCount = cards.filter((c) => Boolean(c.imageVerified)).length;
  const isLastCard = safeIndex >= cards.length - 1;

  useEffect(() => {
    if (!isOpen) {
      setIsCompleted(false);
      return;
    }
    if (!currentCard) return;
    setIsBackShown(false);
    setIsEditing(false);
    setGalleryQuery(currentCard.topic.replace(/\s*-\s*/g, ' ').trim());
  }, [safeIndex, isOpen]);

  // Keyboard shortcuts: Space flips card, Left/Right arrows navigate
  useEffect(() => {
    if (!isOpen || isEditing || isCompleted) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsBackShown((prev) => !prev);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (safeIndex < cards.length - 1) {
          setCurrentIndex(safeIndex + 1);
        }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (safeIndex > 0) {
          setCurrentIndex(safeIndex - 1);
        }
      } else if (e.code === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isEditing, isCompleted, safeIndex, cards.length, onClose]);

  if (!isOpen || !currentCard) return null;

  const hasImageInCard = /<img\b/i.test(`${currentCard.question} ${currentCard.hint}`);
  const alternatives: MedicalImageResult[] =
    currentCard.imageAlternatives && currentCard.imageAlternatives.length > 0
      ? currentCard.imageAlternatives
      : [];

  const handleSearchAlternativeImages = async (customQuery?: string) => {
    const q = (customQuery ?? galleryQuery).trim() || currentCard.topic;
    setIsSearchingGallery(true);
    try {
      const res = await fetch('/api/media/search-medical-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q,
          topic: currentCard.topic,
          question: stripHtml(currentCard.question),
          answer: stripHtml(currentCard.answer),
          hint: stripHtml(currentCard.hint),
          deckKey: cleanDeckKey,
          preferGoogleGrounding: true,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const webImgs: MedicalImageResult[] = Array.isArray(data.images) ? data.images : [];
        if (webImgs.length > 0) {
          onUpdateCard({
            ...currentCard,
            imageAlternatives: webImgs.slice(0, 6),
          });
        }
      }
    } catch {
      // Keep existing alternatives
    } finally {
      setIsSearchingGallery(false);
    }
  };

  const handleSelectThumbnail = (img: MedicalImageResult) => {
    const imgMatch = `${currentCard.question} ${currentCard.hint}`.match(
      /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i
    );
    const existingLocalFile = imgMatch
      ? resolveLocalMediaFilename(
          imgMatch[0],
          imgMatch[1],
          currentCard.id,
          0,
          cleanDeckKey
        )
      : img.suggestedFilename || `${cleanDeckKey}_${currentCard.id}.jpg`;

    const updated = applyResolvedWebImageToCard(
      currentCard,
      existingLocalFile,
      img,
      alternatives
    );
    onUpdateCard({
      ...updated,
      imageVerified: true,
    });
  };

  const handleApproveAndNext = () => {
    onUpdateCard({
      ...currentCard,
      imageVerified: true,
    });
    if (safeIndex < cards.length - 1) {
      setCurrentIndex(safeIndex + 1);
    } else {
      setIsCompleted(true);
    }
  };

  const questionAudio = extractAudioRefsFromHtml(currentCard.question, localMediaAssets);
  const hintAudio = extractAudioRefsFromHtml(currentCard.hint || '', localMediaAssets);

  const frontHtml = sanitizeMedicalHtml(questionAudio.cleanedHtml, {
    highlightCloze: currentCard.type === 'cloze',
    clozeMode: 'front',
    localMediaAssets,
    stripUnresolvedPlaceholderImgs: false,
  });

  const backQuestionHtml = sanitizeMedicalHtml(questionAudio.cleanedHtml, {
    highlightCloze: currentCard.type === 'cloze',
    clozeMode: 'back',
    localMediaAssets,
    stripUnresolvedPlaceholderImgs: false,
  });

  const answerHtml = sanitizeMedicalHtml(currentCard.answer || '', {
    stripImgs: true,
  });

  const hintHtml = sanitizeMedicalHtml(hintAudio.cleanedHtml, {
    localMediaAssets,
    stripUnresolvedPlaceholderImgs: false,
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Modo Revisão Rápida estilo Anki"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto"
    >
      <div className="w-full max-w-3xl bg-[#0F1623] border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Top Header */}
        <div className="px-5 py-3.5 bg-[#0B0F17] border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs text-slate-300 tabular-nums">
            <span className="font-bold text-slate-100">
              Revisão Rápida ({safeIndex + 1}/{cards.length})
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-sky-400">ID {currentCard.id}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-300">{currentCard.type}</span>
            {currentCard.imageVerified && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-400 font-medium">✓ Aprovado</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-[11px] text-slate-400">
              Atalhos: <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono">Espaço</kbd> virar ·{' '}
              <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono">←</kbd>{' '}
              <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono">→</kbd> navegar
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar revisão rápida"
              className="p-1 text-slate-400 hover:text-slate-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Card Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {isCompleted ? (
            <div className="py-6 px-4 text-center space-y-5">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-950/80 border border-emerald-700/70 text-emerald-400 mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-bold text-slate-100 font-display">
                  Revisão Rápida Concluída
                </h3>
                <p className="text-xs text-slate-300 tabular-nums">
                  <strong className="text-emerald-400">{approvedCount}</strong> de{' '}
                  <strong className="text-slate-100">{cards.length}</strong> card(s) aprovado(s) no deck{' '}
                  <code className="font-mono text-sky-300">{cleanDeckKey}</code>. Escolha como enviar para o Anki:
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                {onExportApkg && (
                  <button
                    type="button"
                    disabled={isExportingApkg}
                    onClick={() => {
                      onClose();
                      onExportApkg();
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 rounded-lg cursor-pointer"
                  >
                    <PackageCheck className="w-4 h-4" />
                    <span>{isExportingApkg ? 'Gerando .apkg...' : 'Exportar .apkg (Anki)'}</span>
                  </button>
                )}
                {onSyncAnkiConnect && (
                  <button
                    type="button"
                    disabled={isSyncingAnkiConnect}
                    onClick={() => {
                      onClose();
                      onSyncAnkiConnect();
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 rounded-lg cursor-pointer"
                  >
                    <MonitorUp className="w-4 h-4 text-emerald-400" />
                    <span>
                      {isSyncingAnkiConnect
                        ? 'Sincronizando Anki...'
                        : 'Sincronizar AnkiConnect'}
                    </span>
                  </button>
                )}
                {onDownloadJson && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onDownloadJson();
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-sky-400" />
                    <span>Baixar JSON</span>
                  </button>
                )}
              </div>
              <div className="pt-2 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentIndex(0);
                    setIsCompleted(false);
                    setIsBackShown(false);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Revisar novamente do início</span>
                </button>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <button
                  type="button"
                  onClick={onClose}
                  className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  Voltar ao Editor
                </button>
              </div>
            </div>
          ) : isEditing ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Tópico (Tema - Subtema)</label>
                <input
                  type="text"
                  value={currentCard.topic}
                  onChange={(e) =>
                    onUpdateCard({ ...currentCard, topic: e.target.value })
                  }
                  className="w-full px-3 py-1.5 text-xs bg-[#0B0F17] border border-slate-700 rounded-md text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Enunciado (Question)</label>
                <textarea
                  rows={3}
                  value={currentCard.question}
                  onChange={(e) =>
                    onUpdateCard({ ...currentCard, question: e.target.value })
                  }
                  className="w-full p-2.5 text-xs bg-[#0B0F17] border border-slate-700 rounded-md text-slate-100"
                />
              </div>
              {currentCard.type === 'basic' && (
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Resposta Atômica (Answer)
                  </label>
                  <input
                    type="text"
                    value={currentCard.answer}
                    onChange={(e) =>
                      onUpdateCard({ ...currentCard, answer: e.target.value })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-[#0B0F17] border border-slate-700 rounded-md text-slate-100"
                  />
                </div>
              )}
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Comentário & Legenda (Hint)
                </label>
                <textarea
                  rows={3}
                  value={currentCard.hint}
                  onChange={(e) =>
                    onUpdateCard({ ...currentCard, hint: e.target.value })
                  }
                  className="w-full p-2.5 text-xs font-mono bg-[#0B0F17] border border-slate-700 rounded-md text-slate-100"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Topic Header */}
              <div className="text-xs font-semibold uppercase tracking-wider text-sky-400">
                {currentCard.topic}
              </div>

              {/* FRENTE / VERSO Question */}
              <div
                className="text-base text-slate-100 font-medium leading-relaxed [&_img]:mt-3 [&_img]:max-h-64 [&_img]:w-auto [&_img]:mx-auto [&_img]:rounded-lg [&_img]:border [&_img]:border-slate-700"
                dangerouslySetInnerHTML={{
                  __html: isBackShown ? backQuestionHtml : frontHtml,
                }}
              />

              {/* Audio Preview (Front) */}
              {questionAudio.audioItems.length > 0 && (
                <div className="space-y-2">
                  {questionAudio.audioItems.map((aud) => (
                    <div
                      key={`q-aud-${aud.filename}`}
                      className="px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center gap-2 text-[11px] text-sky-300">
                        <Volume2 className="w-3.5 h-3.5 shrink-0" />
                        <span className="font-mono truncate">{aud.filename}</span>
                        {!aud.isPlayable && (
                          <span className="text-amber-300">
                            (anexe em &ldquo;+ Mídias Locais&rdquo; para ouvir no navegador)
                          </span>
                        )}
                      </div>
                      {aud.isPlayable && aud.resolvedSrc && (
                        <audio
                          controls
                          preload="none"
                          src={aud.resolvedSrc}
                          className="w-full h-9"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* VERSO Reveal */}
              {isBackShown ? (
                <div className="pt-4 border-t border-slate-800 space-y-3">
                  {currentCard.type === 'basic' && (
                    <div
                      className="p-3.5 rounded-lg bg-emerald-950/30 border border-emerald-800/60 text-sm font-semibold text-emerald-300"
                      dangerouslySetInnerHTML={{
                        __html: answerHtml,
                      }}
                    />
                  )}

                  {hintAudio.audioItems.length > 0 && (
                    <div className="space-y-2">
                      {hintAudio.audioItems.map((aud) => (
                        <div
                          key={`h-aud-${aud.filename}`}
                          className="px-3 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 flex flex-col gap-1.5"
                        >
                          <div className="flex items-center gap-2 text-[11px] text-sky-300">
                            <Volume2 className="w-3.5 h-3.5 shrink-0" />
                            <span className="font-mono truncate">{aud.filename}</span>
                            {!aud.isPlayable && (
                              <span className="text-amber-300">
                                (anexe em &ldquo;+ Mídias Locais&rdquo; para ouvir no navegador)
                              </span>
                            )}
                          </div>
                          {aud.isPlayable && aud.resolvedSrc && (
                            <audio
                              controls
                              preload="none"
                              src={aud.resolvedSrc}
                              className="w-full h-9"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div
                    className="p-3.5 rounded-lg bg-[#0B0F17] border border-slate-800 text-xs text-slate-300 leading-relaxed [&_b]:text-slate-100 [&_strong]:text-slate-100 [&_i]:text-slate-400 [&_img]:mt-2 [&_img]:max-h-56 [&_img]:rounded-lg"
                    dangerouslySetInnerHTML={{
                      __html: hintHtml,
                    }}
                  />
                </div>
              ) : (
                <div className="pt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setIsBackShown(true)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg cursor-pointer transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                    <span>Mostrar Resposta (Barra de Espaço)</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Galeria de Troca Rápida Online (4–6 Miniaturas Alternativas em 1 clique) */}
          {!isCompleted && (hasImageInCard || alternatives.length > 0) && (
            <div className="p-3.5 rounded-lg bg-[#0B0F17] border border-slate-800 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-200">
                  Galeria de Troca Rápida Online (1 clique para substituir imagem)
                </span>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSearchAlternativeImages(galleryQuery);
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    value={galleryQuery}
                    onChange={(e) => setGalleryQuery(e.target.value)}
                    placeholder="Buscar no Google Imagens..."
                    className="px-2.5 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-100 w-48"
                  />
                  <button
                    type="submit"
                    disabled={isSearchingGallery}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded cursor-pointer"
                  >
                    {isSearchingGallery ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Search className="w-3 h-3" />
                    )}
                    <span>Google/Web</span>
                  </button>
                </form>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {alternatives.slice(0, 6).map((alt) => (
                  <button
                    key={alt.id}
                    type="button"
                    onClick={() => handleSelectThumbnail(alt)}
                    title={`${alt.title} (${alt.source})`}
                    className="group relative h-16 rounded border border-slate-800 hover:border-sky-400 bg-slate-950 overflow-hidden flex items-center justify-center cursor-pointer transition-all"
                  >
                    <img
                      src={alt.thumbUrl}
                      alt={alt.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        {!isCompleted && (
          <div className="px-5 py-3.5 bg-[#0B0F17] border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={safeIndex === 0}
                onClick={() => setCurrentIndex(Math.max(0, safeIndex - 1))}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 rounded-lg cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Anterior (←)</span>
              </button>

              <button
                type="button"
                disabled={safeIndex >= cards.length - 1}
                onClick={() => setCurrentIndex(Math.min(cards.length - 1, safeIndex + 1))}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 rounded-lg cursor-pointer"
              >
                <span>Próximo (→)</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsEditing((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>{isEditing ? 'Concluir Edição' : 'Editar Texto'}</span>
              </button>

              <button
                type="button"
                onClick={handleApproveAndNext}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{isLastCard ? '✓ Aprovar & Finalizar' : '✓ Aprovar & Próximo'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
