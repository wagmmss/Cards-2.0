import { useCallback, useEffect, useRef, useState } from 'react';
import { CanonicalCard, PdfExtractedImage } from '../types/deck';
import {
  fetchJsonWithTimeout,
  sanitizeDeckKey,
  searchMedicalImagesApi,
} from '../utils/apiClient';
import {
  buildCatalogFromExtractedImages,
  matchMaterialImagesForCard,
  mergeMaterialAndWebImages,
} from '../utils/materialImageMatcher';
import {
  applyResolvedWebImageToCard,
  attachVisualSuggestionToCard,
  extractUnresolvedLocalImages,
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

export function useImageAutoResolver(params: {
  materialImages: PdfExtractedImage[];
  setCards: React.Dispatch<React.SetStateAction<CanonicalCard[]>>;
  showStatus: (message: string, tone?: 'info' | 'success' | 'error') => void;
}) {
  const { materialImages, setCards, showStatus } = params;
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
      // Cancel any stale background run so loading a new deck never suffers race conditions
      cancelAutoResolve();

      const cardsNeedingWebImage = targetCards.filter(
        (c) => extractUnresolvedLocalImages(c, availableNames).length > 0
      );
      if (cardsNeedingWebImage.length === 0) return;

      const runId = ++activeRunIdRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsAutoResolvingImages(true);
      const pendingIds = new Set(cardsNeedingWebImage.map((c) => c.id));
      setCards((prev) =>
        prev.map((c) => (pendingIds.has(c.id) ? { ...c, isResolvingImage: true } : c))
      );

      let resolvedCount = 0;
      let cursor = 0;
      const CONCURRENCY = 2;

      const worker = async () => {
        while (cursor < cardsNeedingWebImage.length) {
          if (controller.signal.aborted || activeRunIdRef.current !== runId) return;
          const card = cardsNeedingWebImage[cursor++];
          const unresolvedList = extractUnresolvedLocalImages(card, availableNames);
          if (unresolvedList.length === 0) continue;

          const targetRef = unresolvedList[0];
          const cleanQuestion = stripHtml(card.question);
          const cleanAnswer = stripHtml(card.answer);
          const cleanHint = stripHtml(card.hint);

          const materialHits = matchMaterialImagesForCard(materialImages, {
            query: targetRef.searchQuery,
            topic: card.topic,
            question: cleanQuestion,
            answer: cleanAnswer,
            hint: cleanHint,
            preferredPdfImageId: targetRef.pdfImageId,
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

          const mergedCandidates = mergeMaterialAndWebImages(materialHits, webImages, 6);
          if (mergedCandidates.length > 0) {
            resolvedCount++;
            const bestImage = mergedCandidates[0];
            setCards((prev) =>
              prev.map((c) =>
                c.id === card.id
                  ? applyResolvedWebImageToCard(
                      c,
                      targetRef.filename,
                      bestImage,
                      mergedCandidates
                    )
                  : c
              )
            );
          } else {
            setCards((prev) =>
              prev.map((c) => (c.id === card.id ? { ...c, isResolvingImage: false } : c))
            );
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
        if (activeRunIdRef.current === runId) {
          abortControllerRef.current = null;
          setIsAutoResolvingImages(false);
          if (resolvedCount > 0) {
            showStatus(
              `${resolvedCount} imagem(ns) resolvida(s) com figuras dos materiais anexados e busca clínica na Web.`,
              'success'
            );
          }
        }
      }
    },
    [cancelAutoResolve, materialImages, setCards, showStatus]
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

      try {
        showStatus(
          `Analisando ${Math.min(40, cardsWithoutImage.length)} card(s) sem imagem para sugerir figuras úteis (Materiais + Web)...`,
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

            const merged = mergeMaterialAndWebImages(materialHits, webHits, 6);
            if (merged.length === 0) continue;

            const chosen = merged[0];
            attachedCount++;
            if (chosen.fromMaterial) matUsedCount++;

            setCards((prev) =>
              prev.map((c) =>
                c.id === card.id
                  ? attachVisualSuggestionToCard(
                      c,
                      chosen,
                      suggestion.legend,
                      suggestion.mode,
                      merged
                    )
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
              `IA adicionou imagens em ${attachedCount} card(s) (${matUsedCount} dos seus materiais + ${attachedCount - matUsedCount} da Web). Revise e aprove abaixo.`,
              'success'
            );
          } else {
            showStatus(
              'Nenhuma imagem compatível com alta relevância foi encontrada para as sugestões da IA.',
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
    [cancelSuggestVisuals, materialImages, setCards, showStatus]
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
