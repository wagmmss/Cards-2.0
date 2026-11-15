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

async function pickValidatedUniqueCandidate(params: {
  card: CanonicalCard;
  candidates: MedicalImageResult[];
  usedImageKeys: Set<string>;
  imageMode: 'recognition' | 'feedback';
  model?: GeminiModelOption;
  signal: AbortSignal;
}): Promise<ValidatedImageSelection | null> {
  const { card, candidates, usedImageKeys, imageMode, model, signal } = params;
  const cleanQ = stripHtml(card.question);
  const cleanA = stripHtml(card.answer);
  const cleanH = stripHtml(card.hint);
  const expectedText = `${card.topic} ${cleanQ} ${cleanA}`;

  const availableCandidates = candidates.filter((cand) => {
    const keys = getImageCandidateTrackingKeys(cand);
    return !keys.some((k) => usedImageKeys.has(k));
  });

  if (availableCandidates.length === 0) return null;

  let hadRejection = false;
  let bestRasterFallback: {
    cand: MedicalImageResult;
    keys: string[];
    visualLegend: string;
    imageVerified: boolean;
  } | null = null;
  let bestSvgFallback: {
    cand: MedicalImageResult;
    keys: string[];
    visualLegend: string;
    imageVerified: boolean;
  } | null = null;

  // Inspect up to 5 top unique candidates (material candidates first, then Web candidates)
  for (const cand of availableCandidates.slice(0, 5)) {
    if (signal.aborted) return null;

    const candKeys = getImageCandidateTrackingKeys(cand);
    // Re-check atomic availability right before async call
    if (candKeys.some((k) => usedImageKeys.has(k))) {
      continue;
    }

    // Fast pre-filter for obvious cross-modality conflicts on candidate metadata
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

    // Atomically reserve keys before awaiting Gemini Flash pixel inspection
    for (const k of candKeys) usedImageKeys.add(k);

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
          model,
        },
        signal
      );

      if (signal.aborted) {
        for (const k of candKeys) usedImageKeys.delete(k);
        return null;
      }

      if (!validation.isCompatible || validation.reachable === false) {
        // Release keys so another card with matching modality can still use this figure if appropriate
        for (const k of candKeys) usedImageKeys.delete(k);
        hadRejection = true;
        continue;
      }

      const isAiVerified = Boolean(validation.validated && !validation.fallback);
      const isRawSvg = Boolean(
        validation.isSvg ||
          /\.svg(?:\?|$)|image\/svg\+xml/i.test(candidateImageUrl)
      );
      const isRasterizedSvg = /\.svg\.png(?:\?|$)/i.test(candidateImageUrl);

      if (isAiVerified && !isRawSvg && !isRasterizedSvg) {
        const alternatives = availableCandidates.filter((alt) => {
          if (alt.id === cand.id) return true;
          const altKeys = getImageCandidateTrackingKeys(alt);
          return !altKeys.some((k) => usedImageKeys.has(k));
        });

        return {
          chosen: cand,
          visualLegend: validation.visualLegend || '',
          imageVerified: true,
          alternatives: alternatives.slice(0, 6),
          hadRejection,
        };
      }

      // Release key tentatively and record best fallback so remaining candidates (real raster/verified) can still win
      for (const k of candKeys) usedImageKeys.delete(k);
      if (!isRawSvg && (!bestRasterFallback || (isAiVerified && !bestRasterFallback.imageVerified))) {
        bestRasterFallback = {
          cand,
          keys: candKeys,
          visualLegend: validation.visualLegend || '',
          imageVerified: isAiVerified,
        };
      } else if (!bestSvgFallback) {
        bestSvgFallback = {
          cand,
          keys: candKeys,
          visualLegend: validation.visualLegend || '',
          imageVerified: isAiVerified && !isRawSvg,
        };
      }
    } catch (err) {
      for (const k of candKeys) usedImageKeys.delete(k);
      if (err instanceof DOMException && err.name === 'AbortError') {
        return null;
      }
      hadRejection = true;
    }
  }

  for (const fallbackEntry of [bestRasterFallback, bestSvgFallback]) {
    if (!fallbackEntry) continue;
    if (fallbackEntry.keys.some((k) => usedImageKeys.has(k))) continue;
    for (const k of fallbackEntry.keys) usedImageKeys.add(k);

    const alternatives = availableCandidates.filter((alt) => {
      if (alt.id === fallbackEntry.cand.id) return true;
      const altKeys = getImageCandidateTrackingKeys(alt);
      return !altKeys.some((k) => usedImageKeys.has(k));
    });

    return {
      chosen: fallbackEntry.cand,
      visualLegend: fallbackEntry.visualLegend,
      imageVerified: fallbackEntry.imageVerified,
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
    async (targetCards: CanonicalCard[], availableNames: string[] = []) => {
      cancelAutoResolve();

      const cardsNeedingWebImage = targetCards.filter(
        (c) => extractUnresolvedLocalImages(c, availableNames).length > 0
      );
      if (cardsNeedingWebImage.length === 0) return;

      const runId = ++activeRunIdRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Deck-wide tracking set ensures 1 image = max 1 card
      const usedImageKeys = extractUsedImageKeysFromCards(targetCards, materialImages);

      setIsAutoResolvingImages(true);
      const pendingIds = new Set(cardsNeedingWebImage.map((c) => c.id));
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
              setCards((prev) =>
                prev.map((c) =>
                  c.id === card.id
                    ? {
                        ...applyResolvedWebImageToCard(
                          c,
                          targetRef.filename,
                          picked.chosen,
                          picked.alternatives,
                          picked.visualLegend || undefined
                        ),
                        imageVerified: picked.imageVerified,
                      }
                    : c
                )
              );
            } else {
              // If no valid/compatible image passed validation (or only synthetic placeholders existed),
              // strip the placeholder cleanly instead of forcing a conflicting image.
              leftTextOnlyCount++;
              cardUpdated = true;
              setCards((prev) =>
                prev.map((c) => {
                  if (c.id !== card.id) return c;
                  const cleaned = removeMissingMediaFromCard(c, availableNames);
                  return { ...cleaned, isResolvingImage: false };
                })
              );
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
              `${resolvedCount} imagem(ns) validadas por visão computacional (1 por card); ${leftTextOnlyCount} card(s) mantido(s) apenas em texto por falta de correspondência compatível.`,
              'success'
            );
          } else if (resolvedCount > 0) {
            showStatus(
              `${resolvedCount} imagem(ns) resolvida(s) e validadas com figuras únicas (materiais anexados + Web).`,
              'success'
            );
          } else if (leftTextOnlyCount > 0) {
            showStatus(
              `${leftTextOnlyCount} card(s) mantido(s) sem imagem após auditoria multimodal para evitar figuras incompatíveis.`,
              'info'
            );
          }
        }
      }
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
        const CONCURRENCY = 2;

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
