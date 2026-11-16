import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CanonicalCard,
  GeminiModelOption,
  MedicalImageResult,
  PdfExtractedImage,
} from '../types/deck';
import {
  fetchJsonWithTimeout,
  sanitizeDeckKey,
  searchMedicalImagesApi,
  validateCardImageApi,
} from '../utils/apiClient';
import {
  buildCatalogFromExtractedImages,
  extractUsedImageKeysFromCards,
  getImageCandidateTrackingKeys,
  hasLocalModalityConflict,
  matchMaterialImagesForCard,
  mergeMaterialAndWebImages,
} from '../utils/materialImageMatcher';
import {
  applyResolvedWebImageToCard,
  attachVisualSuggestionToCard,
  extractUnresolvedLocalImages,
  removeMissingMediaFromCard,
  stripHtml,
} from '../utils/wozniakLinter';

interface VisualCardSuggestion {
  cardId: number;
  mode: 'recognition' | 'feedback';
  pdfImageId?: string;
  searchQuery: string;
  legend: string;
  reason?: string;
}

interface ValidatedImageSelection {
  chosen: MedicalImageResult;
  visualLegend: string;
  imageVerified: boolean;
  alternatives: MedicalImageResult[];
  hadRejection: boolean;
}

function isGifCandidate(cand: MedicalImageResult): boolean {
  return /\.gif(?:\?|$|#)|animated|giphy/i.test(
    `${cand.fullUrl || ''} ${cand.thumbUrl || ''} ${cand.title || ''}`
  );
}

function computeCandidateCompositeScore(
  cand: MedicalImageResult,
  visualScore: number,
  isRawSvg: boolean,
  isRasterizedSvg: boolean
): number {
  const haystack = `${cand.fullUrl || ''} ${cand.thumbUrl || ''} ${cand.source || ''} ${cand.title || ''}`;
  let score = visualScore * 10;
  if (cand.fromMaterial) score += 8;
  if (/litfl|lifeinthefastlane|12[-_\s]?lead|ecg|ecgguide|healio/i.test(haystack)) {
    score += 6;
  }
  if (/holter|schematic|cartoon|vector|animated|\.gif/i.test(haystack)) {
    score -= 18;
  }
  if (isRawSvg) score -= 35;
  else if (isRasterizedSvg) score -= 12;
  return score;
}

async function pickValidatedUniqueCandidate(params: {
  card: CanonicalCard;
  candidates: MedicalImageResult[];
  usedImageKeys: Set<string>;
  imageMode: 'recognition' | 'feedback';
  model?: GeminiModelOption;
  signal: AbortSignal;
}): Promise<ValidatedImageSelection | null> {
  const { card, candidates, usedImageKeys, imageMode, model: _model, signal } = params;
  const cleanQ = stripHtml(card.question);
  const cleanA = stripHtml(card.answer);
  const cleanH = stripHtml(card.hint);
  const expectedText = `${card.topic} ${cleanQ} ${cleanA}`;

  const rawAvailable = candidates.filter((cand) => {
    const keys = getImageCandidateTrackingKeys(cand);
    return !keys.some((k) => usedImageKeys.has(k));
  });

  if (rawAvailable.length === 0) return null;

  // Prefer static raster candidates over animated GIFs unless GIFs are all that exist
  const nonGif = rawAvailable.filter((c) => !isGifCandidate(c));
  const orderedAvailable =
    nonGif.length > 0 ? [...nonGif, ...rawAvailable.filter((c) => isGifCandidate(c))] : rawAvailable;

  // Fast pre-filter for obvious cross-modality conflicts on candidate metadata
  const prefiltered: Array<{ cand: MedicalImageResult; keys: string[] }> = [];
  let hadRejection = false;
  for (const cand of orderedAvailable) {
    if (
      hasLocalModalityConflict(
        expectedText,
        `${cand.title || ''} ${cand.description || ''}`,
        ''
      )
    ) {
      hadRejection = true;
      continue;
    }
    prefiltered.push({ cand, keys: getImageCandidateTrackingKeys(cand) });
  }

  if (prefiltered.length === 0) return null;

  interface ScoredHit {
    cand: MedicalImageResult;
    keys: string[];
    visualLegend: string;
    imageVerified: boolean;
    isRawSvg: boolean;
    visualScore: number;
    compositeScore: number;
  }

  const evaluateBatch = async (
    batch: Array<{ cand: MedicalImageResult; keys: string[] }>
  ): Promise<ScoredHit[]> => {
    const reserved: Array<{ cand: MedicalImageResult; keys: string[] }> = [];
    for (const item of batch) {
      if (item.keys.some((k) => usedImageKeys.has(k))) continue;
      for (const k of item.keys) usedImageKeys.add(k);
      reserved.push(item);
    }
    if (reserved.length === 0) return [];

    const results = await Promise.all(
      reserved.map(async ({ cand, keys }) => {
        const candidateImageUrl = cand.thumbUrl || cand.fullUrl;
        try {
          const validation = await validateCardImageApi(
            {
              imageSource: candidateImageUrl,
              cardTopic: card.topic,
              cardQuestion: cleanQ,
              cardAnswer: cleanA,
              cardHint: cleanH,
              imageMode,
              captionHint: cand.description || cand.title,
            },
            signal
          );

          if (signal.aborted || !validation.isCompatible || validation.reachable === false) {
            hadRejection = true;
            return null;
          }

          const isAiVerified = Boolean(validation.validated && !validation.fallback);
          const isRawSvg = Boolean(
            validation.isSvg || /\.svg(?:\?|$)|image\/svg\+xml/i.test(candidateImageUrl)
          );
          const isRasterizedSvg = /\.svg\.png(?:\?|$)/i.test(candidateImageUrl);
          const visualScore =
            typeof validation.visualScore === 'number'
              ? validation.visualScore
              : isAiVerified
                ? 7
                : 4;

          return {
            cand,
            keys,
            visualLegend: validation.visualLegend || '',
            imageVerified: isAiVerified,
            isRawSvg,
            visualScore,
            compositeScore: computeCandidateCompositeScore(
              cand,
              visualScore,
              isRawSvg,
              isRasterizedSvg
            ),
          } satisfies ScoredHit;
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw err;
          }
          hadRejection = true;
          return null;
        }
      })
    );

    // Release all tentatively reserved keys first; caller will re-acquire the winner only
    for (const item of reserved) {
      for (const k of item.keys) usedImageKeys.delete(k);
    }

    return results.filter((r): r is ScoredHit => r !== null);
  };

  let scoredHits: ScoredHit[] = [];
  try {
    // Evaluate Top-2 first; if a crisp static raster achieves visualScore >= 8, skip extra RPM calls
    scoredHits = await evaluateBatch(prefiltered.slice(0, 2));
    const hasStrongVerifiedRaster = scoredHits.some(
      (h) => h.imageVerified && !h.isRawSvg && h.visualScore >= 8
    );
    if (!signal.aborted && !hasStrongVerifiedRaster && prefiltered.length > 2) {
      const nextBatch = await evaluateBatch(prefiltered.slice(2, 4));
      scoredHits = [...scoredHits, ...nextBatch];
    }
    const hasAnyVerifiedRaster = scoredHits.some((h) => h.imageVerified && !h.isRawSvg);
    if (!signal.aborted && !hasAnyVerifiedRaster && prefiltered.length > 4) {
      const fallbackBatch = await evaluateBatch(prefiltered.slice(4, 6));
      scoredHits = [...scoredHits, ...fallbackBatch];
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return null;
    }
  }

  if (signal.aborted || scoredHits.length === 0) return null;

  // Strict "Sem Imagem > Imagem Ruim": NEVER auto-attach unverified Web/Google images
  const eligibleHits = scoredHits.filter((h) => h.cand.fromMaterial || h.imageVerified);
  if (eligibleHits.length === 0) return null;

  eligibleHits.sort((a, b) => {
    if (a.imageVerified !== b.imageVerified) return a.imageVerified ? -1 : 1;
    if (a.isRawSvg !== b.isRawSvg) return a.isRawSvg ? 1 : -1;
    return b.compositeScore - a.compositeScore;
  });

  for (const winner of eligibleHits) {
    if (winner.keys.some((k) => usedImageKeys.has(k))) continue;
    for (const k of winner.keys) usedImageKeys.add(k);

    const alternatives = orderedAvailable.filter((alt) => {
      if (alt.id === winner.cand.id) return true;
      const altKeys = getImageCandidateTrackingKeys(alt);
      return !altKeys.some((k) => usedImageKeys.has(k));
    });

    return {
      chosen: winner.cand,
      visualLegend: winner.visualLegend,
      imageVerified: winner.imageVerified,
      alternatives: alternatives.slice(0, 6),
      hadRejection,
    };
  }

  return null;
}

export function useImageAutoResolver(params: {
  materialImages: PdfExtractedImage[];
  selectedModel?: GeminiModelOption;
  setCards: React.Dispatch<React.SetStateAction<CanonicalCard[]>>;
  showStatus: (message: string, tone?: 'info' | 'success' | 'error') => void;
}) {
  const { materialImages, selectedModel, setCards, showStatus } = params;
  const [isAutoResolvingImages, setIsAutoResolvingImages] = useState(false);
  const [isSuggestingVisuals, setIsSuggestingVisuals] = useState(false);

  const activeRunIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const suggestRunIdRef = useRef(0);
  const suggestAbortRef = useRef<AbortController | null>(null);

  const cancelAutoResolve = useCallback(() => {
    activeRunIdRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsAutoResolvingImages(false);
    setCards((prev) =>
      prev.map((c) => (c.isResolvingImage ? { ...c, isResolvingImage: false } : c))
    );
  }, [setCards]);

  const cancelSuggestVisuals = useCallback(() => {
    suggestRunIdRef.current += 1;
    if (suggestAbortRef.current) {
      suggestAbortRef.current.abort();
      suggestAbortRef.current = null;
    }
    setIsSuggestingVisuals(false);
  }, []);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      suggestAbortRef.current?.abort();
    };
  }, []);

  const autoResolveDeckMissingImages = useCallback(
    async (
      targetCards: CanonicalCard[],
      availableNames: string[] = []
    ): Promise<CanonicalCard[]> => {
      cancelAutoResolve();

      const cardsNeedingWebImage = targetCards.filter(
        (c) => extractUnresolvedLocalImages(c, availableNames).length > 0
      );
      if (cardsNeedingWebImage.length === 0) return targetCards;

      const runId = ++activeRunIdRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Deck-wide tracking set ensures 1 image = max 1 card
      const usedImageKeys = extractUsedImageKeysFromCards(targetCards, materialImages);

      setIsAutoResolvingImages(true);
      const pendingIds = new Set(cardsNeedingWebImage.map((c) => c.id));
      const updatedMap = new Map<number, CanonicalCard>(
        targetCards.map((c) => [c.id, c])
      );

      setCards((prev) =>
        prev.map((c) => (pendingIds.has(c.id) ? { ...c, isResolvingImage: true } : c))
      );

      let resolvedCount = 0;
      let leftTextOnlyCount = 0;
      let cursor = 0;
      const CONCURRENCY = 2;

      const worker = async () => {
        while (cursor < cardsNeedingWebImage.length) {
          if (controller.signal.aborted || activeRunIdRef.current !== runId) return;
          const card = cardsNeedingWebImage[cursor++];
          let cardUpdated = false;
          try {
            const unresolvedList = extractUnresolvedLocalImages(card, availableNames);
            if (unresolvedList.length === 0) continue;

            const targetRef = unresolvedList[0];
            const cleanQuestion = stripHtml(card.question);
            const cleanAnswer = stripHtml(card.answer);
            const cleanHint = stripHtml(card.hint);
            const effectiveMode: 'recognition' | 'feedback' =
              targetRef.field === 'hint' || card.image_mode === 'feedback'
                ? 'feedback'
                : 'recognition';

            const materialHits = matchMaterialImagesForCard(materialImages, {
              query: targetRef.searchQuery,
              topic: card.topic,
              question: cleanQuestion,
              answer: cleanAnswer,
              hint: cleanHint,
              preferredPdfImageId: targetRef.pdfImageId,
              usedImageIds: usedImageKeys,
            });

            const webImages = await searchMedicalImagesApi(
              {
                query: targetRef.searchQuery,
                topic: card.topic,
                question: cleanQuestion,
                answer: cleanAnswer,
                hint: cleanHint,
                preferGoogleGrounding: true,
              },
              controller.signal
            );

            if (controller.signal.aborted || activeRunIdRef.current !== runId) return;

            const mergedCandidates = mergeMaterialAndWebImages(materialHits, webImages, 8);
            const picked = await pickValidatedUniqueCandidate({
              card,
              candidates: mergedCandidates,
              usedImageKeys,
              imageMode: effectiveMode,
              model: selectedModel,
              signal: controller.signal,
            });

            if (controller.signal.aborted || activeRunIdRef.current !== runId) return;

            if (picked) {
              resolvedCount++;
              cardUpdated = true;
              const nextCard: CanonicalCard = {
                ...applyResolvedWebImageToCard(
                  card,
                  targetRef.filename,
                  picked.chosen,
                  picked.alternatives,
                  picked.visualLegend || undefined
                ),
                imageVerified: picked.imageVerified,
                needsManualImage: false,
                isResolvingImage: false,
              };
              updatedMap.set(card.id, nextCard);
              setCards((prev) => prev.map((c) => (c.id === card.id ? nextCard : c)));
            } else {
              // If no valid/compatible image passed validation (or only synthetic placeholders existed),
              // strip the placeholder cleanly AND mark needsManualImage so user can pick from Apostila Gallery.
              leftTextOnlyCount++;
              cardUpdated = true;
              const cleaned = removeMissingMediaFromCard(card, availableNames);
              const nextCard: CanonicalCard = {
                ...cleaned,
                isResolvingImage: false,
                needsManualImage: true,
              };
              updatedMap.set(card.id, nextCard);
              setCards((prev) => prev.map((c) => (c.id === card.id ? nextCard : c)));
            }
          } finally {
            if (!cardUpdated) {
              setCards((prev) =>
                prev.map((c) =>
                  c.id === card.id && c.isResolvingImage
                    ? { ...c, isResolvingImage: false }
                    : c
                )
              );
            }
          }
        }
      };

      try {
        await Promise.all(
          Array.from(
            { length: Math.min(CONCURRENCY, cardsNeedingWebImage.length) },
            () => worker()
          )
        );
      } finally {
        setCards((prev) =>
          prev.map((c) => (c.isResolvingImage ? { ...c, isResolvingImage: false } : c))
        );
        if (activeRunIdRef.current === runId) {
          abortControllerRef.current = null;
          setIsAutoResolvingImages(false);
          if (resolvedCount > 0 && leftTextOnlyCount > 0) {
            showStatus(
              `${resolvedCount} imagem(ns) validadas por visão computacional (1 por card); ${leftTextOnlyCount} card(s) sinalizado(s) para escolha manual na Apostila.`,
              'success'
            );
          } else if (resolvedCount > 0) {
            showStatus(
              `${resolvedCount} imagem(ns) resolvida(s) e validadas com figuras únicas (materiais anexados + Web).`,
              'success'
            );
          } else if (leftTextOnlyCount > 0) {
            showStatus(
              `${leftTextOnlyCount} card(s) sinalizado(s) para escolha manual na Apostila para evitar imagens incompatíveis.`,
              'info'
            );
          }
        }
      }

      return targetCards.map((c) => updatedMap.get(c.id) || c);
    },
    [cancelAutoResolve, materialImages, selectedModel, setCards, showStatus]
  );

  const suggestAndAttachVisualCards = useCallback(
    async (targetCards: CanonicalCard[], deckKey: string) => {
      const cardsWithoutImage = targetCards.filter(
        (c) => !/<img\b/i.test(`${c.question || ''} ${c.hint || ''}`)
      );
      if (cardsWithoutImage.length === 0) {
        showStatus('Todos os cards deste baralho já possuem imagens vinculadas.', 'info');
        return;
      }

      cancelSuggestVisuals();
      const runId = ++suggestRunIdRef.current;
      const controller = new AbortController();
      suggestAbortRef.current = controller;
      setIsSuggestingVisuals(true);

      // Seed uniqueness tracker with every image already attached across the entire deck
      const usedImageKeys = extractUsedImageKeysFromCards(targetCards, materialImages);

      try {
        showStatus(
          `Analisando ${Math.min(40, cardsWithoutImage.length)} card(s) sem imagem com validação multimodal (Materiais + Web)...`,
          'info'
        );

        const pdfImagesCatalog = buildCatalogFromExtractedImages(materialImages);
        const cleanDeck = sanitizeDeckKey(deckKey || 'internato_deck');

        const data = await fetchJsonWithTimeout<{
          suggestions?: VisualCardSuggestion[];
          fallback?: boolean;
          error?: string;
        }>('/api/gemini/suggest-visual-cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deckKey: cleanDeck,
            cards: cardsWithoutImage.slice(0, 40).map((c) => ({
              id: c.id,
              type: c.type,
              topic: c.topic,
              question: c.question,
              answer: c.answer,
              hint: c.hint,
            })),
            pdfImagesCatalog,
            model: selectedModel,
          }),
          timeoutMs: 125_000,
          signal: controller.signal,
        });

        if (controller.signal.aborted || suggestRunIdRef.current !== runId) return;

        if (data?.fallback || data?.error) {
          showStatus(
            `Não foi possível sugerir imagens com IA (${data.error || 'erro desconhecido'}).`,
            'error'
          );
          return;
        }

        const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
        if (suggestions.length === 0) {
          showStatus(
            'A IA avaliou os cards sem imagem e manteve todos apenas em texto (nenhum precisou de figura clínica).',
            'info'
          );
          return;
        }

        const cardById = new Map(cardsWithoutImage.map((c) => [c.id, c]));
        let attachedCount = 0;
        let matUsedCount = 0;
        let cursor = 0;
        const CONCURRENCY = 3;

        const worker = async () => {
          while (cursor < suggestions.length) {
            if (controller.signal.aborted || suggestRunIdRef.current !== runId) return;
            const suggestion = suggestions[cursor++];
            const card = cardById.get(suggestion.cardId);
            if (!card) continue;

            const cleanQ = stripHtml(card.question);
            const cleanA = stripHtml(card.answer);
            const cleanH = stripHtml(card.hint);

            const materialHits = matchMaterialImagesForCard(materialImages, {
              query: suggestion.searchQuery,
              topic: card.topic,
              question: cleanQ,
              answer: cleanA,
              hint: cleanH,
              preferredPdfImageId: suggestion.pdfImageId,
              usedImageIds: usedImageKeys,
            });

            const webHits = await searchMedicalImagesApi(
              {
                query: suggestion.searchQuery,
                topic: card.topic,
                question: cleanQ,
                answer: cleanA,
                hint: cleanH,
                preferGoogleGrounding: true,
              },
              controller.signal
            );

            if (controller.signal.aborted || suggestRunIdRef.current !== runId) return;

            const merged = mergeMaterialAndWebImages(materialHits, webHits, 8);
            const picked = await pickValidatedUniqueCandidate({
              card,
              candidates: merged,
              usedImageKeys,
              imageMode: suggestion.mode,
              model: selectedModel,
              signal: controller.signal,
            });

            if (controller.signal.aborted || suggestRunIdRef.current !== runId) return;
            if (!picked) continue;

            attachedCount++;
            if (picked.chosen.fromMaterial) matUsedCount++;

            setCards((prev) =>
              prev.map((c) =>
                c.id === card.id
                  ? {
                      ...attachVisualSuggestionToCard(
                        c,
                        picked.chosen,
                        picked.visualLegend || suggestion.legend,
                        suggestion.mode,
                        picked.alternatives
                      ),
                      imageVerified: picked.imageVerified,
                    }
                  : c
              )
            );
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, suggestions.length) }, () => worker())
        );

        if (!controller.signal.aborted && suggestRunIdRef.current === runId) {
          if (attachedCount > 0) {
            showStatus(
              `IA vinculou ${attachedCount} figura(s) única(s) e validadas (${matUsedCount} dos materiais + ${attachedCount - matUsedCount} da Web).`,
              'success'
            );
          } else {
            showStatus(
              'Nenhuma imagem compatível passou na validação multimodal para os cards analisados.',
              'info'
            );
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        const msg = err instanceof Error ? err.message : 'erro inesperado';
        showStatus(`Falha ao sugerir imagens com IA (${msg}).`, 'error');
      } finally {
        if (suggestRunIdRef.current === runId) {
          suggestAbortRef.current = null;
          setIsSuggestingVisuals(false);
        }
      }
    },
    [cancelSuggestVisuals, materialImages, selectedModel, setCards, showStatus]
  );

  return {
    isAutoResolvingImages,
    isSuggestingVisuals,
    autoResolveDeckMissingImages,
    suggestAndAttachVisualCards,
    cancelAutoResolve,
    cancelSuggestVisuals,
  };
}
