import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CanonicalCard,
  ClinicalMapResponse,
  DeckCurationStats,
  DomainProfile,
  ExtractedDeckMetadata,
  GeminiModelOption,
  UploadedPdfFile,
} from '../types/deck';
import { buildGenericClinicalMap } from '../data/demoDecks';
import { fetchJsonWithTimeout, sanitizeDeckKey } from '../utils/apiClient';
import { buildPdfImagesCatalog } from '../utils/materialImageMatcher';
import {
  curateAndRebalanceDeck,
  lintCard,
  surgicalRepairCardLocal,
} from '../utils/wozniakLinter';

export interface GenerationProgress {
  phase: 'upload' | 'map' | 'batches' | 'gaps' | 'repair';
  label: string;
  currentBatch: number;
  totalBatches: number;
  cardsReady: number;
  elapsedSec: number;
}

export function useBatchDeckGenerator(params: {
  pdfs: UploadedPdfFile[];
  setPdfs: React.Dispatch<React.SetStateAction<UploadedPdfFile[]>>;
  deckKey: string;
  setDeckKey: React.Dispatch<React.SetStateAction<string>>;
  selectedProfile: 'auto' | DomainProfile;
  selectedModel?: GeminiModelOption;
  useGoogleSearch: boolean;
  extractedMeta: ExtractedDeckMetadata;
  clinicalMap: ClinicalMapResponse | null;
  setClinicalMap: React.Dispatch<React.SetStateAction<ClinicalMapResponse | null>>;
  cards: CanonicalCard[];
  setCards: React.Dispatch<React.SetStateAction<CanonicalCard[]>>;
  setCurationStats: React.Dispatch<React.SetStateAction<DeckCurationStats | null>>;
  availableMediaNames?: string[];
  autoResolveDeckMissingImages: (cards: CanonicalCard[], names?: string[]) => Promise<void>;
  showStatus: (message: string, tone?: 'info' | 'success' | 'error') => void;
}) {
  const {
    pdfs,
    setPdfs,
    deckKey,
    setDeckKey,
    selectedProfile,
    selectedModel = 'gemini-4-hydrogen',
    useGoogleSearch,
    extractedMeta,
    clinicalMap,
    setClinicalMap,
    cards,
    setCards,
    setCurationStats,
    availableMediaNames,
    autoResolveDeckMissingImages,
    showStatus,
  } = params;

  const [isGeneratingMap, setIsGeneratingMap] = useState(false);
  const [isDeepeningGuidelines, setIsDeepeningGuidelines] = useState(false);
  const [isGeneratingDeck, setIsGeneratingDeck] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);

  const startTimer = useCallback((initial: GenerationProgress) => {
    const startedAt = Date.now();
    setProgress(initial);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      setProgress((prev) => (prev ? { ...prev, elapsedSec } : prev));
    }, 1000);
  }, []);

  const stopTimerAndReset = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    abortControllerRef.current = null;
    setProgress(null);
  }, []);

  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    stopTimerAndReset();
    setIsGeneratingMap(false);
    setIsDeepeningGuidelines(false);
    setIsGeneratingDeck(false);
    setIsRepairing(false);
    showStatus('Operação cancelada. Seu baralho atual foi preservado sem alterações.', 'info');
  }, [showStatus, stopTimerAndReset]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  const ensurePdfsUploadedToGemini = useCallback(
    async (
      sourcePdfs: UploadedPdfFile[],
      signal: AbortSignal
    ): Promise<UploadedPdfFile[]> => {
      if (!Array.isArray(sourcePdfs) || sourcePdfs.length === 0) return sourcePdfs;
      const updated = [...sourcePdfs];

      const pendingIndices = updated
        .map((p, idx) => (p.base64Data && !p.fileUri && !p.textContent ? idx : -1))
        .filter((idx) => idx !== -1);

      for (let i = 0; i < pendingIndices.length; i++) {
        if (signal.aborted) {
          throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
        }
        const idx = pendingIndices[i];
        const pdf = updated[idx];
        setProgress((prev) =>
          prev
            ? {
                ...prev,
                phase: 'upload',
                label: `Enviando anexo ${i + 1}/${pendingIndices.length}: ${pdf.name}`,
              }
            : prev
        );
        try {
          const data = await fetchJsonWithTimeout<{
            fileUri?: string;
            fileName?: string;
            mimeType?: string;
            fileSha256?: string;
            keyFingerprint?: string;
            fallback?: boolean;
          }>('/api/gemini/upload-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: pdf.name,
              mimeType: pdf.mimeType || 'application/pdf',
              base64Data: pdf.base64Data,
            }),
            timeoutMs: 75_000,
            signal,
          });
          if (data?.fileUri && !data.fallback) {
            const enriched: UploadedPdfFile = {
              ...pdf,
              fileUri: data.fileUri,
              fileName: data.fileName,
              mimeType: data.mimeType || pdf.mimeType,
              fileSha256: data.fileSha256 || pdf.fileSha256,
              keyFingerprint: data.keyFingerprint || pdf.keyFingerprint,
            };
            updated[idx] = enriched;
            // Functional state update prevents race conditions if user adds/removes PDFs concurrently
            setPdfs((prev) =>
              prev.map((item) =>
                item.name === pdf.name && item.size === pdf.size
                  ? {
                      ...item,
                      fileUri: enriched.fileUri,
                      fileName: enriched.fileName,
                      mimeType: enriched.mimeType,
                      fileSha256: enriched.fileSha256,
                      keyFingerprint: enriched.keyFingerprint,
                    }
                  : item
              )
            );
          }
        } catch (err) {
          if (signal.aborted) throw err;
          // Keep base64Data fallback if pre-upload fails
        }
      }

      return updated;
    },
    [setPdfs]
  );

  const serializePdfsForApi = (sourcePdfs: UploadedPdfFile[]) =>
    sourcePdfs.map((p) => {
      if (p.fileUri) {
        return {
          name: p.name,
          size: p.size,
          mimeType: p.mimeType,
          fileUri: p.fileUri,
          fileName: p.fileName,
          fileSha256: p.fileSha256,
          keyFingerprint: p.keyFingerprint,
          docRole: p.docRole,
        };
      }
      const { extractedImages: _omitExtracted, ...rest } = p;
      return rest;
    });

  const handleGenerateClinicalMap = useCallback(async (): Promise<ClinicalMapResponse> => {
    const effectiveKey = sanitizeDeckKey(
      deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato'
    );
    if (!deckKey.trim()) setDeckKey(effectiveKey);

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const profileOverride = selectedProfile === 'auto' ? undefined : selectedProfile;
    const optimisticMap = buildGenericClinicalMap(
      effectiveKey,
      extractedMeta.rawCards,
      profileOverride
    );
    setClinicalMap(optimisticMap);
    setIsGeneratingMap(true);
    startTimer({
      phase: 'map',
      label: 'Mapeando prioridades P1–P4 e consultando diretrizes clínicas...',
      currentBatch: 0,
      totalBatches: 1,
      cardsReady: 0,
      elapsedSec: 0,
    });

    try {
      const preparedPdfs = await ensurePdfsUploadedToGemini(pdfs, controller.signal);
      setProgress((prev) =>
        prev
          ? {
              ...prev,
              phase: 'map',
              label: 'Sintetizando Mapa Clínico P1–P4 com Gemini...',
            }
          : prev
      );

      const existingSummary = extractedMeta.rawCards
        .slice(0, 30)
        .map((c) => `ID ${c.id} [${c.type}]: ${c.topic} -> ${c.question.slice(0, 140)}`)
        .join('\n');

      const data = await fetchJsonWithTimeout<
        ClinicalMapResponse & { fallback?: boolean; error?: string }
      >('/api/gemini/clinical-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckKey: effectiveKey,
          profile: selectedProfile,
          pdfs: serializePdfsForApi(preparedPdfs),
          existingJsonSummary: existingSummary,
          useGoogleSearch,
          model: selectedModel,
        }),
        timeoutMs: 165_000,
        signal: controller.signal,
      });

      if (data?.fallback || data?.error) {
        showStatus(
          `IA indisponível no Mapa Clínico (${data.error || 'erro desconhecido'}). Exibindo rascunho local para edição.`,
          'error'
        );
        return optimisticMap;
      }

      if (data && Array.isArray(data.items) && data.items.length > 0) {
        setClinicalMap(data);
        const updCount = Array.isArray(data.guidelineUpdates) ? data.guidelineUpdates.length : 0;
        const srcCount = Array.isArray(data.groundingSources) ? data.groundingSources.length : 0;
        showStatus(
          `Mapa Clínico P1–P4 gerado para "${data.themeTitle}" (${data.items.length} conceitos · ${updCount} achados clínicos · ${srcCount} fontes web).`,
          'success'
        );
        return data;
      }
      return optimisticMap;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return optimisticMap;
      }
      const msg = err instanceof Error ? err.message : 'erro de rede';
      showStatus(
        `Falha ao gerar Mapa Clínico (${msg}). Rascunho local mantido para edição.`,
        'error'
      );
      return optimisticMap;
    } finally {
      setIsGeneratingMap(false);
      stopTimerAndReset();
    }
  }, [
    deckKey,
    ensurePdfsUploadedToGemini,
    extractedMeta,
    pdfs,
    selectedModel,
    selectedProfile,
    setClinicalMap,
    setDeckKey,
    showStatus,
    startTimer,
    stopTimerAndReset,
    useGoogleSearch,
  ]);

  const handleDeepenGuidelines = useCallback(
    async (focusQuery?: string) => {
      if (!clinicalMap) return;
      const effectiveKey = sanitizeDeckKey(
        clinicalMap.deckKey || deckKey.trim() || 'tema_clinico_internato'
      );
      setIsDeepeningGuidelines(true);
      try {
        const data = await fetchJsonWithTimeout<{
          newUpdates?: string[];
          groundingSources?: Array<{ title: string; uri: string }>;
          searchQueries?: string[];
          fallback?: boolean;
          error?: string;
        }>('/api/gemini/deepen-guidelines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deckKey: effectiveKey,
            themeTitle: clinicalMap.themeTitle,
            profile: clinicalMap.profile || selectedProfile,
            focusQuery: (focusQuery || '').trim(),
            existingUpdates: clinicalMap.guidelineUpdates || [],
            model: selectedModel,
          }),
          timeoutMs: 110_000,
        });

        if (data?.fallback || data?.error) {
          showStatus(
            `Não foi possível aprofundar no Google Search (${data.error || 'erro desconhecido'}).`,
            'error'
          );
          return;
        }

        const newUpdates = Array.isArray(data.newUpdates) ? data.newUpdates : [];
        const newSources = Array.isArray(data.groundingSources) ? data.groundingSources : [];
        const newQueries = Array.isArray(data.searchQueries) ? data.searchQueries : [];

        setClinicalMap((prev) => {
          if (!prev) return prev;
          const existingUpd = new Set(
            (prev.guidelineUpdates || []).map((u) => u.trim().toLowerCase())
          );
          const mergedUpdates = [...(prev.guidelineUpdates || [])];
          for (const u of newUpdates) {
            const norm = u.trim().toLowerCase();
            if (u.trim() && !existingUpd.has(norm)) {
              existingUpd.add(norm);
              mergedUpdates.push(u.trim());
            }
          }

          const existingUris = new Set((prev.groundingSources || []).map((s) => s.uri));
          const mergedSources = [...(prev.groundingSources || [])];
          for (const s of newSources) {
            if (s?.uri && !existingUris.has(s.uri)) {
              existingUris.add(s.uri);
              mergedSources.push(s);
            }
          }

          const mergedQueries = Array.from(
            new Set([...(prev.searchQueries || []), ...newQueries])
          );

          return {
            ...prev,
            guidelineUpdates: mergedUpdates,
            groundingSources: mergedSources,
            searchQueries: mergedQueries,
            googleSearchUsed: true,
          };
        });

        showStatus(
          `${newUpdates.length} novo(s) achado(s) clínico(s) e ${newSources.length} fonte(s) web adicionados ao Mapa Clínico.`,
          'success'
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'erro de rede';
        showStatus(`Falha ao aprofundar diretrizes (${msg}).`, 'error');
      } finally {
        setIsDeepeningGuidelines(false);
      }
    },
    [clinicalMap, deckKey, selectedModel, selectedProfile, setClinicalMap, showStatus]
  );

  const handleRecreateCanonicalDeck = useCallback(
    async (mapOverride?: ClinicalMapResponse) => {
      const effectiveKey = sanitizeDeckKey(
        deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato'
      );
      if (!deckKey.trim()) setDeckKey(effectiveKey);

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const profileOverride = selectedProfile === 'auto' ? undefined : selectedProfile;
      const activeMap =
        mapOverride ||
        clinicalMap ||
        buildGenericClinicalMap(effectiveKey, extractedMeta.rawCards, profileOverride);
      if (!clinicalMap) setClinicalMap(activeMap);

      const sourceCards = extractedMeta.rawCards.length > 0 ? extractedMeta.rawCards : cards;
      const totalBatches = sourceCards.length > 0 ? Math.ceil(sourceCards.length / 10) : 1;

      setIsGeneratingDeck(true);
      startTimer({
        phase: 'batches',
        label: 'Preparando documentos e lotes FSRS...',
        currentBatch: 0,
        totalBatches,
        cardsReady: 0,
        elapsedSec: 0,
      });

      try {
        const preparedPdfs = await ensurePdfsUploadedToGemini(pdfs, controller.signal);
        const apiPdfs = serializePdfsForApi(preparedPdfs);
        const pdfImagesCatalog = buildPdfImagesCatalog(preparedPdfs);
        const allRebuiltNotes: CanonicalCard[] = [];

        if (sourceCards.length > 0) {
          const BATCH_SIZE = 10;
          const CONCURRENCY = 2;
          const ID_STRIDE = 100;
          const baseNewIdStart =
            Math.max(
              171000100,
              ...(extractedMeta.existingIds || []),
              ...sourceCards.map((c) => Number(c.id) || 0)
            ) + 1;

          const deckOutline = sourceCards.map((c, idx) => ({
            batch: Math.floor(idx / BATCH_SIZE) + 1,
            id: c.id,
            summary: String(c.topic || c.question || '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 90),
          }));

          const batchResults: CanonicalCard[][] = Array.from({ length: totalBatches }, () => []);
          let completedBatches = 0;
          let nextBatchIdx = 0;

          const runWorker = async () => {
            while (nextBatchIdx < totalBatches) {
              if (controller.signal.aborted) {
                throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
              }
              const batchIndex = nextBatchIdx++;
              const batchCards = sourceCards.slice(
                batchIndex * BATCH_SIZE,
                (batchIndex + 1) * BATCH_SIZE
              );
              const batchNewIdStart = baseNewIdStart + batchIndex * ID_STRIDE;

              setProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      phase: 'batches',
                      label: `Reconstruindo lote ${completedBatches + 1} de ${totalBatches} (Matuschak & Nielsen)...`,
                    }
                  : prev
              );

              const data = await fetchJsonWithTimeout<{
                notes?: CanonicalCard[];
                fallback?: boolean;
                error?: string;
              }>('/api/gemini/generate-deck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  deckKey: effectiveKey,
                  pdfs: apiPdfs,
                  pdfImagesCatalog,
                  clinicalMap: activeMap,
                  existingMetadata: extractedMeta,
                  batchCards,
                  batchIndex,
                  totalBatches,
                  nextNewIdStart: batchNewIdStart,
                  deckOutline,
                  model: selectedModel,
                }),
                timeoutMs: 185_000,
                signal: controller.signal,
              });

              if (data?.fallback || data?.error) {
                throw new Error(
                  data.error || `Falha da IA no lote ${batchIndex + 1}/${totalBatches}`
                );
              }

              const batchNotes: CanonicalCard[] = Array.isArray(data.notes) ? data.notes : [];
              if (batchNotes.length === 0) {
                throw new Error(`Lote ${batchIndex + 1}/${totalBatches} retornou 0 cards.`);
              }

              batchResults[batchIndex] = batchNotes;
              completedBatches++;
              const rebuiltSoFar = batchResults.reduce((acc, arr) => acc + arr.length, 0);
              setProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      phase: 'batches',
                      currentBatch: completedBatches,
                      cardsReady: rebuiltSoFar,
                      label: `Lote ${completedBatches}/${totalBatches} concluído (${rebuiltSoFar} cards prontos)`,
                    }
                  : prev
              );
            }
          };

          const workerCount = Math.min(CONCURRENCY, totalBatches);
          await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
          for (const notes of batchResults) {
            allRebuiltNotes.push(...notes);
          }

          if (activeMap?.items?.some((item) => item.checked !== false)) {
            setProgress((prev) =>
              prev
                ? {
                    ...prev,
                    phase: 'gaps',
                    label: `Auditando lacunas do Mapa P1–P4 sobre ${allRebuiltNotes.length} cards...`,
                  }
                : prev
            );
            const gapNewIdStart =
              Math.max(
                171000200,
                ...(extractedMeta.existingIds || []),
                ...allRebuiltNotes.map((n) => Number(n.id) || 0)
              ) + 1;

            try {
              const gapData = await fetchJsonWithTimeout<{
                notes?: CanonicalCard[];
                fallback?: boolean;
                error?: string;
              }>('/api/gemini/fill-map-gaps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  deckKey: effectiveKey,
                  clinicalMap: activeMap,
                  rebuiltCards: allRebuiltNotes,
                  pdfImagesCatalog,
                  nextNewIdStart: gapNewIdStart,
                  model: selectedModel,
                }),
                timeoutMs: 145_000,
                signal: controller.signal,
              });
              if (!gapData?.fallback && !gapData?.error && Array.isArray(gapData.notes)) {
                const seenIds = new Set(allRebuiltNotes.map((n) => Number(n.id)));
                for (const g of gapData.notes) {
                  const gid = Number(g.id);
                  if (!seenIds.has(gid)) {
                    seenIds.add(gid);
                    allRebuiltNotes.push(g);
                  }
                }
              }
            } catch (gapErr) {
              if (controller.signal.aborted) throw gapErr;
              // Non-fatal: batch notes remain valid
            }
          }
        } else {
          setProgress((prev) =>
            prev
              ? {
                  ...prev,
                  phase: 'batches',
                  label: 'Gerando baralho completo do zero com Gemini (Matuschak & Nielsen)...',
                }
              : prev
          );
          const data = await fetchJsonWithTimeout<{
            notes?: CanonicalCard[];
            fallback?: boolean;
            error?: string;
          }>('/api/gemini/generate-deck', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              deckKey: effectiveKey,
              pdfs: apiPdfs,
              pdfImagesCatalog,
              clinicalMap: activeMap,
              existingMetadata: extractedMeta,
              model: selectedModel,
            }),
            timeoutMs: 185_000,
            signal: controller.signal,
          });

          if (data?.fallback || data?.error) {
            throw new Error(data.error || 'Falha ao gerar deck com Gemini.');
          }
          const notes = Array.isArray(data.notes) ? data.notes : [];
          if (notes.length === 0) {
            throw new Error('A IA retornou 0 cards.');
          }
          allRebuiltNotes.push(...notes);
        }

        const { cards: finalCurated, stats: finalStats } = curateAndRebalanceDeck(
          allRebuiltNotes,
          extractedMeta,
          effectiveKey,
          activeMap,
          { skipTemplateGapAdditions: true }
        );
        setCards(finalCurated);
        setCurationStats(finalStats);
        showStatus(
          `Reconstrução concluída: ${finalStats.originalCount} → ${finalStats.finalCount} cards (${finalStats.preservedIdsCount} IDs FSRS mantidos, ${finalStats.basicPct}% basic / ${finalStats.clozePct}% cloze).`,
          'success'
        );
        void autoResolveDeckMissingImages(finalCurated, availableMediaNames);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        const msg = err instanceof Error ? err.message : 'erro desconhecido';
        showStatus(
          `Reconstrução por IA falhou (${msg}). Seus cards atuais foram preservados intactos.`,
          'error'
        );
      } finally {
        setIsGeneratingDeck(false);
        stopTimerAndReset();
      }
    },
    [
      autoResolveDeckMissingImages,
      availableMediaNames,
      cards,
      clinicalMap,
      deckKey,
      ensurePdfsUploadedToGemini,
      extractedMeta,
      pdfs,
      selectedModel,
      selectedProfile,
      setCards,
      setClinicalMap,
      setCurationStats,
      setDeckKey,
      showStatus,
      startTimer,
      stopTimerAndReset,
    ]
  );

  const handleAutoRepairAllFlagged = useCallback(async () => {
    const effectiveKey = sanitizeDeckKey(
      deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato'
    );
    const activeMap =
      clinicalMap ||
      buildGenericClinicalMap(
        effectiveKey,
        extractedMeta.rawCards.length > 0 ? extractedMeta.rawCards : cards
      );

    const { cards: curatedAndRepaired, stats } = curateAndRebalanceDeck(
      cards,
      extractedMeta,
      effectiveKey,
      activeMap,
      { skipTemplateGapAdditions: true }
    );
    setCards(curatedAndRepaired);
    setCurationStats(stats);
    showStatus(
      `Curadoria aplicada (${stats.finalCount} cards · ${stats.preservedIdsCount} IDs FSRS mantidos).`,
      'info'
    );

    const flaggedWithWarnings = curatedAndRepaired
      .map((card) => ({ card, lint: lintCard(card) }))
      .filter((item) => !item.lint.isValid);

    if (flaggedWithWarnings.length === 0) return;

    const CHUNK_SIZE = 12;
    const chunks: Array<typeof flaggedWithWarnings> = [];
    for (let i = 0; i < flaggedWithWarnings.length; i += CHUNK_SIZE) {
      chunks.push(flaggedWithWarnings.slice(i, i + CHUNK_SIZE));
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsRepairing(true);
    startTimer({
      phase: 'repair',
      label: `Reparando lote 1/${chunks.length} (${flaggedWithWarnings.length} card(s) sinalizado(s))...`,
      currentBatch: 1,
      totalBatches: chunks.length,
      cardsReady: 0,
      elapsedSec: 0,
    });

    const origById = new Map<number, CanonicalCard>(
      curatedAndRepaired.map((c) => [c.id, c])
    );

    try {
      const repairedById = new Map<number, CanonicalCard>();
      let fallbackErrorMsg: string | null = null;

      for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        if (controller.signal.aborted) break;
        const chunk = chunks[chunkIdx];
        setProgress((prev) =>
          prev
            ? {
                ...prev,
                phase: 'repair',
                label: `Reparando lote ${chunkIdx + 1}/${chunks.length} (${flaggedWithWarnings.length} card(s) sinalizado(s))...`,
                currentBatch: chunkIdx + 1,
                totalBatches: chunks.length,
                cardsReady: repairedById.size,
              }
            : prev
        );

        const dataUriPlaceholders = new Map<string, string>();
        let uriSeq = 0;
        const tokenizeDataUris = (html: string) =>
          (html || '').replace(/data:image\/[^"'\s>]+/gi, (uriMatch) => {
            const token = `__EMBEDDED_DATA_URI_${uriSeq++}__`;
            dataUriPlaceholders.set(token, uriMatch);
            return token;
          });
        const restoreDataUris = (html: string) =>
          (html || '').replace(/__EMBEDDED_DATA_URI_\d+__/g, (tok) =>
            dataUriPlaceholders.get(tok) || tok
          );

        const compactFlaggedPayload = chunk.map((f) => {
          const {
            imageAlternatives: _omitAlt,
            isResolvingImage: _omitRes,
            imageVerified: _omitVer,
            ...restCard
          } = f.card;
          return {
            ...restCard,
            question: tokenizeDataUris(restCard.question || ''),
            hint: tokenizeDataUris(restCard.hint || ''),
            warnings: f.lint.warnings.map((w) => w.message),
          };
        });

        const data = await fetchJsonWithTimeout<{
          repairedCards?: CanonicalCard[];
          fallback?: boolean;
          error?: string;
        }>('/api/gemini/repair-cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deckKey: effectiveKey,
            flaggedCards: compactFlaggedPayload,
            model: selectedModel,
          }),
          timeoutMs: 145_000,
          signal: controller.signal,
        });

        if (data?.fallback || data?.error) {
          fallbackErrorMsg = data?.error || 'erro na API';
          break;
        }

        const repairedList = Array.isArray(data.repairedCards) ? data.repairedCards : [];
        for (const rc of repairedList) {
          if (!rc || typeof rc.id !== 'number') continue;
          const orig = origById.get(rc.id);
          const mergedRaw: CanonicalCard = {
            ...orig,
            ...rc,
            question: restoreDataUris(rc.question || ''),
            hint: restoreDataUris(rc.hint || ''),
            priority: rc.priority ?? orig?.priority,
            deck_key: rc.deck_key ?? orig?.deck_key ?? effectiveKey,
            exam_refs: rc.exam_refs ?? orig?.exam_refs,
            last_synced_hash: rc.last_synced_hash ?? orig?.last_synced_hash,
            imageVerified: orig?.imageVerified,
            imageAlternatives: orig?.imageAlternatives,
          };
          repairedById.set(rc.id, surgicalRepairCardLocal(mergedRaw));
        }
      }

      if (repairedById.size > 0) {
        setCards((prev) =>
          prev.map((c) => (repairedById.has(c.id) ? repairedById.get(c.id)! : c))
        );
      }

      if (fallbackErrorMsg) {
        showStatus(
          repairedById.size > 0
            ? `${repairedById.size} card(s) reparado(s) parcialmente; lote restante manteve ajustes locais (${fallbackErrorMsg}).`
            : `Ajustes locais aplicados; reparo avançado com IA indisponível (${fallbackErrorMsg}).`,
          'error'
        );
      } else if (repairedById.size > 0) {
        showStatus(`${repairedById.size} card(s) reparado(s) com sucesso.`, 'success');
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        showStatus('Ajustes determinísticos aplicados localmente.', 'info');
      }
    } finally {
      setIsRepairing(false);
      stopTimerAndReset();
    }
  }, [
    cards,
    clinicalMap,
    deckKey,
    extractedMeta,
    selectedModel,
    setCards,
    setCurationStats,
    showStatus,
    startTimer,
    stopTimerAndReset,
  ]);

  return {
    isGeneratingMap,
    isDeepeningGuidelines,
    isGeneratingDeck,
    isRepairing,
    progress,
    cancelGeneration,
    handleGenerateClinicalMap,
    handleDeepenGuidelines,
    handleRecreateCanonicalDeck,
    handleAutoRepairAllFlagged,
  };
}
