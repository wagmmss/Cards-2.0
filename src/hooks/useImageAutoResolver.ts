import { useCallback, useEffect, useRef, useState } from 'react';
import { CanonicalCard } from '../types/deck';
import { searchMedicalImagesApi } from '../utils/apiClient';
import {
  applyResolvedWebImageToCard,
  extractUnresolvedLocalImages,
  stripHtml,
} from '../utils/wozniakLinter';

export function useImageAutoResolver(params: {
  setCards: React.Dispatch<React.SetStateAction<CanonicalCard[]>>;
  showStatus: (message: string, tone?: 'info' | 'success' | 'error') => void;
}) {
  const { setCards, showStatus } = params;
  const [isAutoResolvingImages, setIsAutoResolvingImages] = useState(false);
  const activeRunIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelAutoResolve = useCallback(() => {
    activeRunIdRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsAutoResolvingImages(false);
    setCards((prev) => prev.map((c) => (c.isResolvingImage ? { ...c, isResolvingImage: false } : c)));
  }, [setCards]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
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
          const webImages = await searchMedicalImagesApi(
            {
              query: targetRef.searchQuery,
              topic: card.topic,
              question: stripHtml(card.question),
              hint: stripHtml(card.hint),
              preferGoogleGrounding: true,
            },
            controller.signal
          );

          if (controller.signal.aborted || activeRunIdRef.current !== runId) return;

          const mergedCandidates = webImages.slice(0, 6);
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
              `${resolvedCount} imagem(ns) ausente(s) resolvida(s) automaticamente via busca clínica (com até 6 opções de troca rápida).`,
              'success'
            );
          }
        }
      }
    },
    [cancelAutoResolve, setCards, showStatus]
  );

  return {
    isAutoResolvingImages,
    autoResolveDeckMissingImages,
    cancelAutoResolve,
  };
}
