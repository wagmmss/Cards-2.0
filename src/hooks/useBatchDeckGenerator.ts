import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CanonicalCard,
  ClinicalMapResponse,
  DeckAuditReport,
  DeckCurationStats,
  DeckFinalVerificationReport,
  DomainProfile,
  ExtractedDeckMetadata,
  GeminiModelOption,
  UploadedPdfFile,
} from '../types/deck';
import { buildGenericClinicalMap } from '../data/demoDecks';
import {
  auditDeckApi,
  fetchJsonWithTimeout,
  sanitizeDeckKey,
  verifyDeckApi,
} from '../utils/apiClient';
import { buildPdfImagesCatalog } from '../utils/materialImageMatcher';
import {
  curateAndRebalanceDeck,
  lintCard,
  surgicalRepairCardLocal,
} from '../utils/wozniakLinter';

export interface GenerationProgress {
  phase: 'upload' | 'map' | 'audit' | 'batches' | 'gaps' | 'images' | 'repair' | 'verify';
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
  blockedImageFilenames?: string[];
  autoResolveDeckMissingImages: (
    cards: CanonicalCard[],
    names?: string[]
  ) => Promise<CanonicalCard[]>;
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
    blockedImageFilenames,
    autoResolveDeckMissingImages,
    showStatus,
  } = params;

  const [isGeneratingMap, setIsGeneratingMap] = useState(false);
  const [isDeepeningGuidelines, setIsDeepeningGuidelines] = useState(false);
  const [isAuditingDeck, setIsAuditingDeck] = useState(false);
  const [isGeneratingDeck, setIsGeneratingDeck] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [repairingCardId, setRepairingCardId] = useState<number | null>(null);
  const [isVerifyingDeck, setIsVerifyingDeck] = useState(false);
  const [isRunningFullPipeline, setIsRunningFullPipeline] = useState(false);
  const [deckAuditReport, setDeckAuditReport] = useState<DeckAuditReport | null>(null);
  const [finalVerificationReport, setFinalVerificationReport] =
    useState<DeckFinalVerificationReport | null>(null);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const singleRepairAbortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const pdfsRef = useRef<UploadedPdfFile[]>(pdfs);
  pdfsRef.current = pdfs;
  const blockedImagesRef = useRef<string[]>(blockedImageFilenames || []);
  blockedImagesRef.current = blockedImageFilenames || [];

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
    if (singleRepairAbortRef.current) {
      singleRepairAbortRef.current.abort();
      singleRepairAbortRef.current = null;
    }
    stopTimerAndReset();
    setIsGeneratingMap(false);
    setIsDeepeningGuidelines(false);
    setIsAuditingDeck(false);
    setIsGeneratingDeck(false);
    setIsRepairing(false);
    setRepairingCardId(null);
    setIsVerifyingDeck(false);
    setIsRunningFullPipeline(false);
    showStatus('Operação cancelada. Seu baralho atual foi preservado sem alterações.', 'info');
  }, [showStatus, stopTimerAndReset]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      singleRepairAbortRef.current?.abort();
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  const ensurePdfsUploadedToGemini = useCallback(
    async (
      sourcePdfs: UploadedPdfFile[],
      signal: AbortSignal
    ): Promise<UploadedPdfFile[]> => {
      const latestList = pdfsRef.current.length > 0 ? pdfsRef.current : sourcePdfs;
      if (!Array.isArray(latestList) || latestList.length === 0) return latestList;
      const updated = latestList.map((p) => {
        const match = pdfsRef.current.find((cur) => cur.name === p.name && cur.size === p.size);
        return match?.fileUri ? { ...p, ...match } : p;
      });

      const pendingIndices = updated
        .map((p, idx) => (p.base64Data && !p.fileUri && !p.textContent ? idx : -1))
        .filter((idx) => idx !== -1);

      for (let i = 0; i < pendingIndices.length; i++) {
        if (signal.aborted) {
          throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
        }
        const idx = pendingIndices[i];
        const pdf = updated[idx];

        // Avoid hitting Express 50MB JSON body limit (~37MB raw PDF -> ~49MB base64)
        const approxJsonBytes = pdf.base64Data.length + 2048;
        if (approxJsonBytes > 48 * 1024 * 1024) {
          showStatus(
            `O PDF "${pdf.name}" excede o limite de upload (~36 MB). Comprima ou divida o PDF antes de enviar para evitar erro 413.`,
            'error'
          );
          updated[idx] = { ...pdf, base64Data: '' };
          continue;
        }

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
              base64Data: '',
              fileUri: data.fileUri,
              fileName: data.fileName,
              mimeType: data.mimeType || pdf.mimeType,
              fileSha256: data.fileSha256 || pdf.fileSha256,
              keyFingerprint: data.keyFingerprint || pdf.keyFingerprint,
            };
            updated[idx] = enriched;
            pdfsRef.current = pdfsRef.current.map((item) =>
              item.name === pdf.name && item.size === pdf.size
                ? {
                    ...item,
                    base64Data: '',
                    fileUri: enriched.fileUri,
                    fileName: enriched.fileName,
                    mimeType: enriched.mimeType,
                    fileSha256: enriched.fileSha256,
                    keyFingerprint: enriched.keyFingerprint,
                  }
                : item
            );
            setPdfs((prev) =>
              prev.map((item) =>
                item.name === pdf.name && item.size === pdf.size
                  ? {
                      ...item,
                      base64Data: '',
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
          const errMsg = err instanceof Error ? err.message : String(err);
          if (/413|payload too large|entity too large/i.test(errMsg)) {
            showStatus(
              `O PDF "${pdf.name}" ultrapassou o limite de payload (HTTP 413). Reduza o tamanho do PDF para enviá-lo à IA.`,
              'error'
            );
            updated[idx] = { ...pdf, base64Data: '' };
          }
        }
      }

      return updated;
    },
    [setPdfs, showStatus]
  );

  const serializePdfsForApi = (sourcePdfs: UploadedPdfFile[]): Array<Record<string, unknown>> =>
    sourcePdfs
      .filter((p) => Boolean(p.fileUri || p.textContent || p.base64Data))
      .map((p) => {
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
        const { extractedImages: _omitExtracted, rawArrayBuffer: _omitBuf, ...rest } = p;
        return { ...rest };
      });

  const handleGenerateClinicalMap = useCallback(
    async (externalSignal?: AbortSignal): Promise<ClinicalMapResponse> => {
      const effectiveKey = sanitizeDeckKey(
        deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato'
      );
      if (!deckKey.trim()) setDeckKey(effectiveKey);

      let controller: AbortController | null = null;
      if (!externalSignal) {
        abortControllerRef.current?.abort();
        controller = new AbortController();
        abortControllerRef.current = controller;
      }
      const activeSignal = externalSignal || controller!.signal;

      const profileOverride = selectedProfile === 'auto' ? undefined : selectedProfile;
      const optimisticMap = buildGenericClinicalMap(
        effectiveKey,
        extractedMeta.rawCards,
        profileOverride
      );
      setClinicalMap(optimisticMap);
      setIsGeneratingMap(true);
      if (!externalSignal) {
        startTimer({
          phase: 'map',
          label: 'Mapeando prioridades P1–P4 e consultando diretrizes clínicas...',
          currentBatch: 0,
          totalBatches: 1,
          cardsReady: 0,
          elapsedSec: 0,
        });
      }

      try {
        const preparedPdfs = await ensurePdfsUploadedToGemini(pdfs, activeSignal);
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
          signal: activeSignal,
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
        if (!externalSignal) {
          stopTimerAndReset();
        }
      }
    },
    [
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
    ]
  );

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

  const handleAuditExistingDeck = useCallback(
    async (
      mapOverride?: ClinicalMapResponse,
      externalSignal?: AbortSignal
    ): Promise<{ report: DeckAuditReport | null; auditedCards: CanonicalCard[] }> => {
      const targetCards = cards.length > 0 ? cards : extractedMeta.rawCards;
      if (targetCards.length === 0) {
        showStatus('Importe um JSON existente ou gere cards antes de auditar.', 'info');
        return { report: null, auditedCards: [] };
      }

      const effectiveKey = sanitizeDeckKey(
        deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato'
      );
      const activeMap =
        mapOverride ||
        clinicalMap ||
        buildGenericClinicalMap(
          effectiveKey,
          targetCards,
          selectedProfile === 'auto' ? undefined : selectedProfile
        );

      let controller: AbortController | null = null;
      if (!externalSignal) {
        abortControllerRef.current?.abort();
        controller = new AbortController();
        abortControllerRef.current = controller;
      }
      const activeSignal = externalSignal || controller!.signal;

      setIsAuditingDeck(true);
      if (!externalSignal) {
        startTimer({
          phase: 'audit',
          label: `Julgando qualidade de ${targetCards.length} card(s) frente aos PDFs e Mapa P1–P4...`,
          currentBatch: 0,
          totalBatches: 1,
          cardsReady: 0,
          elapsedSec: 0,
        });
      }

      try {
        const preparedPdfs = await ensurePdfsUploadedToGemini(pdfs, activeSignal);
        const apiPdfs = serializePdfsForApi(preparedPdfs);

        const data = (await auditDeckApi(
          {
            deckKey: effectiveKey,
            cards: targetCards.map((c) => ({
              id: c.id,
              type: c.type,
              topic: c.topic,
              question: c.question,
              answer: c.answer,
              hint: c.hint,
              priority: c.priority,
            })),
            clinicalMap: activeMap,
            pdfs: apiPdfs,
            model: selectedModel,
          },
          activeSignal
        )) as DeckAuditReport & { fallback?: boolean; error?: string };

        if (data?.fallback || data?.error) {
          showStatus(
            `Auditoria por IA indisponível (${data.error || 'erro desconhecido'}).`,
            'error'
          );
          return { report: null, auditedCards: targetCards };
        }

        const itemMap = new Map(
          (Array.isArray(data.items) ? data.items : []).map((it) => [it.cardId, it])
        );
        const auditedCards: CanonicalCard[] = targetCards.map((c) => {
          const item = itemMap.get(c.id);
          if (!item) return c;
          return {
            ...c,
            priority: item.priority || c.priority,
            auditVerdict: item.verdict,
            auditReason: item.clinicalIssue
              ? `${item.reason} [${item.clinicalIssue}]`
              : item.reason,
            auditScore: item.score,
            auditTargetConcept: item.targetConcept,
            auditSuggestedType: item.suggestedType,
          };
        });

        setCards(auditedCards);
        setDeckAuditReport(data);
        showStatus(
          `Auditoria concluída: ${data.counts.keep} mantidos · ${data.counts.rebuild} para refazer do zero · ${data.counts.split} desmembrar · ${data.counts.prune} podar.`,
          'success'
        );
        return { report: data, auditedCards };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return { report: null, auditedCards: targetCards };
        }
        const msg = err instanceof Error ? err.message : 'erro de rede';
        showStatus(`Falha ao auditar deck (${msg}).`, 'error');
        return { report: null, auditedCards: targetCards };
      } finally {
        setIsAuditingDeck(false);
        if (!externalSignal) {
          stopTimerAndReset();
        }
      }
    },
    [
      cards,
      clinicalMap,
      deckKey,
      ensurePdfsUploadedToGemini,
      extractedMeta,
      pdfs,
      selectedModel,
      selectedProfile,
      setCards,
      showStatus,
      startTimer,
      stopTimerAndReset,
    ]
  );

  const handleRecreateCanonicalDeck = useCallback(
    async (
      mapOverride?: ClinicalMapResponse,
      sourceCardsOverride?: CanonicalCard[],
      externalSignal?: AbortSignal
    ): Promise<CanonicalCard[] | null> => {
      const effectiveKey = sanitizeDeckKey(
        deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato'
      );
      if (!deckKey.trim()) setDeckKey(effectiveKey);

      let controller: AbortController | null = null;
      if (!externalSignal) {
        abortControllerRef.current?.abort();
        controller = new AbortController();
        abortControllerRef.current = controller;
      }
      const activeSignal = externalSignal || controller!.signal;

      const profileOverride = selectedProfile === 'auto' ? undefined : selectedProfile;
      const activeMap =
        mapOverride ||
        clinicalMap ||
        buildGenericClinicalMap(effectiveKey, extractedMeta.rawCards, profileOverride);
      if (!clinicalMap) setClinicalMap(activeMap);

      const rawSourceCards =
        sourceCardsOverride ??
        (cards.length > 0 ? cards : extractedMeta.rawCards);
      // Apply audit verdicts: keep intact, prune removed, send rebuild/split/unaudited to LLM
      const keptCards = rawSourceCards
        .filter((c) => c.auditVerdict === 'keep')
        .map((c) =>
          surgicalRepairCardLocal(c, { availableMediaNames, preserveLocalAudio: true })
        );
      const cardsToProcess = rawSourceCards.filter(
        (c) => c.auditVerdict !== 'keep' && c.auditVerdict !== 'prune'
      );

      const totalBatches =
        cardsToProcess.length > 0 ? Math.ceil(cardsToProcess.length / 10) : rawSourceCards.length === 0 ? 1 : 0;

      setIsGeneratingDeck(true);
      if (!externalSignal) {
        startTimer({
          phase: 'batches',
          label: 'Preparando documentos e lotes FSRS...',
          currentBatch: 0,
          totalBatches: Math.max(1, totalBatches),
          cardsReady: keptCards.length,
          elapsedSec: 0,
        });
      }

      try {
        const preparedPdfs = await ensurePdfsUploadedToGemini(pdfs, activeSignal);
        const apiPdfs = serializePdfsForApi(preparedPdfs);
        const pdfImagesCatalog = buildPdfImagesCatalog(preparedPdfs);
        const allRebuiltNotes: CanonicalCard[] = [...keptCards];
        let partialFailureSummary: string | null = null;

        if (cardsToProcess.length > 0) {
          const BATCH_SIZE = 10;
          const CONCURRENCY = 2;
          const ID_STRIDE = 100;
          const baseNewIdStart =
            Math.max(
              171000100,
              ...(extractedMeta.existingIds || []),
              ...rawSourceCards.map((c) => Number(c.id) || 0)
            ) + 1;

          const deckOutline = rawSourceCards
            .filter((c) => c.auditVerdict !== 'prune')
            .map((c, idx) => ({
              batch: Math.floor(idx / BATCH_SIZE) + 1,
              id: c.id,
              summary: String(c.auditTargetConcept || c.topic || c.question || '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 90),
            }));

          const batchResults: CanonicalCard[][] = Array.from({ length: totalBatches }, () => []);
          const failedBatchErrors: Array<{ batchNumber: number; message: string; fallbackCards: CanonicalCard[] }> = [];
          let completedBatches = 0;
          let nextBatchIdx = 0;

          const runWorker = async () => {
            while (nextBatchIdx < totalBatches) {
              if (activeSignal.aborted) {
                throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
              }
              const batchIndex = nextBatchIdx++;
              const rawBatchSlice = cardsToProcess.slice(
                batchIndex * BATCH_SIZE,
                (batchIndex + 1) * BATCH_SIZE
              );
              const batchCards = rawBatchSlice.map(
                ({ imageAlternatives: _omitAlt, isResolvingImage: _omitRes, ...rest }) => rest
              );
              const batchNewIdStart = baseNewIdStart + batchIndex * ID_STRIDE;

              setProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      phase: 'batches',
                      label: `Reconstruindo do zero lote ${completedBatches + 1} de ${totalBatches} (Matuschak & Nielsen)...`,
                    }
                  : prev
              );

              try {
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
                  signal: activeSignal,
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
                const rebuiltSoFar =
                  keptCards.length + batchResults.reduce((acc, arr) => acc + arr.length, 0);
                setProgress((prev) =>
                  prev
                    ? {
                        ...prev,
                        phase: 'batches',
                        currentBatch: completedBatches,
                        totalBatches,
                        cardsReady: rebuiltSoFar,
                        label: `Lote ${completedBatches}/${totalBatches} concluído (${rebuiltSoFar} cards prontos)`,
                      }
                    : prev
                );
              } catch (batchErr) {
                if (
                  activeSignal.aborted ||
                  (batchErr instanceof DOMException && batchErr.name === 'AbortError')
                ) {
                  throw batchErr;
                }
                const message =
                  batchErr instanceof Error
                    ? batchErr.message
                    : `Erro no lote ${batchIndex + 1}/${totalBatches}`;
                failedBatchErrors.push({
                  batchNumber: batchIndex + 1,
                  message,
                  fallbackCards: rawBatchSlice,
                });
              }
            }
          };

          const workerCount = Math.min(CONCURRENCY, totalBatches);
          await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

          if (completedBatches === 0 && failedBatchErrors.length > 0) {
            throw new Error(failedBatchErrors[0].message);
          }

          for (const notes of batchResults) {
            allRebuiltNotes.push(...notes);
          }
          if (failedBatchErrors.length > 0) {
            for (const failed of failedBatchErrors) {
              allRebuiltNotes.push(
                ...failed.fallbackCards.map((c) =>
                  surgicalRepairCardLocal(c, { availableMediaNames, preserveLocalAudio: true })
                )
              );
            }
            const failedNums = failedBatchErrors
              .map((f) => `#${f.batchNumber}`)
              .sort()
              .join(', ');
            partialFailureSummary = `Reconstrução parcial preservada: ${completedBatches}/${totalBatches} lote(s) concluído(s); lote(s) ${failedNums} mantiveram versão original após falha (${failedBatchErrors[0].message}).`;
            showStatus(partialFailureSummary, 'error');
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
                signal: activeSignal,
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
              if (activeSignal.aborted) throw gapErr;
            }
          }
        } else if (rawSourceCards.length === 0) {
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
            signal: activeSignal,
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
          {
            skipTemplateGapAdditions: true,
            availableMediaNames,
            preserveLocalAudio: true,
            blockedImageFilenames: blockedImagesRef.current,
          }
        );
        setCards(finalCurated);
        setCurationStats(finalStats);
        if (!externalSignal) {
          if (partialFailureSummary) {
            showStatus(partialFailureSummary, 'error');
          } else {
            showStatus(
              `Reconstrução concluída: ${finalStats.originalCount} → ${finalStats.finalCount} cards (${finalStats.preservedIdsCount} IDs FSRS mantidos, ${finalStats.basicPct}% basic / ${finalStats.clozePct}% cloze).`,
              'success'
            );
          }
          void autoResolveDeckMissingImages(finalCurated, availableMediaNames);
        }
        return finalCurated;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return null;
        }
        const msg = err instanceof Error ? err.message : 'erro desconhecido';
        showStatus(
          `Reconstrução por IA falhou (${msg}). Seus cards atuais foram preservados intactos.`,
          'error'
        );
        return null;
      } finally {
        setIsGeneratingDeck(false);
        if (!externalSignal) {
          stopTimerAndReset();
        }
      }
    },
    [
      autoResolveDeckMissingImages,
      availableMediaNames,
      blockedImageFilenames,
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

  const handleVerifyDeckAdequacy = useCallback(
    async (
      cardsOverride?: CanonicalCard[],
      mapOverride?: ClinicalMapResponse,
      externalSignal?: AbortSignal
    ): Promise<DeckFinalVerificationReport | null> => {
      const targetCards = cardsOverride ?? cards;
      if (targetCards.length === 0) {
        showStatus('Gere ou importe um baralho antes de verificar a adequação final.', 'info');
        return null;
      }

      const effectiveKey = sanitizeDeckKey(
        deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato'
      );
      const activeMap =
        mapOverride ||
        clinicalMap ||
        buildGenericClinicalMap(
          effectiveKey,
          targetCards,
          selectedProfile === 'auto' ? undefined : selectedProfile
        );

      let controller: AbortController | null = null;
      if (!externalSignal) {
        abortControllerRef.current?.abort();
        controller = new AbortController();
        abortControllerRef.current = controller;
      }
      const activeSignal = externalSignal || controller!.signal;

      setIsVerifyingDeck(true);
      if (!externalSignal) {
        startTimer({
          phase: 'verify',
          label: `Confirmando adequação clínica, cobertura P1–P4 e mídia de ${targetCards.length} cards...`,
          currentBatch: 0,
          totalBatches: 1,
          cardsReady: targetCards.length,
          elapsedSec: 0,
        });
      }

      try {
        const preparedPdfs = await ensurePdfsUploadedToGemini(pdfs, activeSignal);
        const apiPdfs = serializePdfsForApi(preparedPdfs);

        const report = (await verifyDeckApi(
          {
            deckKey: effectiveKey,
            cards: targetCards.map((c) => ({
              id: c.id,
              type: c.type,
              topic: c.topic,
              question: c.question,
              answer: c.answer,
              hint: c.hint,
              image_mode: c.image_mode,
              priority: c.priority,
            })),
            clinicalMap: activeMap,
            pdfs: apiPdfs,
            model: selectedModel,
          },
          activeSignal
        )) as DeckFinalVerificationReport & { fallback?: boolean; error?: string };

        if (report?.fallback || report?.error) {
          showStatus(
            `Verificação final indisponível (${report.error || 'erro desconhecido'}).`,
            'error'
          );
          return null;
        }

        setFinalVerificationReport(report);
        showStatus(
          `Verificação final: nota ${report.overallScore}/10 · Cobertura do Mapa ${report.mapCoveragePct}% (${report.approved ? 'Aprovado' : 'Ajustes sugeridos'}).`,
          report.approved ? 'success' : 'info'
        );
        return report;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return null;
        }
        const msg = err instanceof Error ? err.message : 'erro de rede';
        showStatus(`Falha na verificação final do baralho (${msg}).`, 'error');
        return null;
      } finally {
        setIsVerifyingDeck(false);
        if (!externalSignal) {
          stopTimerAndReset();
        }
      }
    },
    [
      cards,
      clinicalMap,
      deckKey,
      ensurePdfsUploadedToGemini,
      extractedMeta,
      pdfs,
      selectedModel,
      selectedProfile,
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
      {
        skipTemplateGapAdditions: true,
        availableMediaNames,
        preserveLocalAudio: true,
        blockedImageFilenames,
      }
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
      const preparedPdfs = await ensurePdfsUploadedToGemini(pdfs, controller.signal);
      const apiPdfs = serializePdfsForApi(preparedPdfs);
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
            clinicalMap: activeMap,
            pdfs: apiPdfs,
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
          repairedById.set(
            rc.id,
            surgicalRepairCardLocal(mergedRaw, { availableMediaNames, preserveLocalAudio: true })
          );
        }
      }

      if (repairedById.size > 0) {
        let mergedLatestDeck: CanonicalCard[] = curatedAndRepaired.map((c) =>
          repairedById.has(c.id) ? repairedById.get(c.id)! : c
        );
        setCards((prev) => {
          mergedLatestDeck = prev.map((c) =>
            repairedById.has(c.id) ? repairedById.get(c.id)! : c
          );
          return mergedLatestDeck;
        });
        const hasNewPlaceholders = Array.from(repairedById.values()).some((c) =>
          /(?:buscar_imagem|pdfimg):/i.test(`${c.question || ''} ${c.hint || ''}`)
        );
        if (hasNewPlaceholders) {
          void autoResolveDeckMissingImages(mergedLatestDeck, availableMediaNames);
        }
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
    autoResolveDeckMissingImages,
    availableMediaNames,
    blockedImageFilenames,
    cards,
    clinicalMap,
    deckKey,
    ensurePdfsUploadedToGemini,
    extractedMeta,
    pdfs,
    selectedModel,
    setCards,
    setCurationStats,
    showStatus,
    startTimer,
    stopTimerAndReset,
  ]);

  const handleAutoRepairSingleCardWithAi = useCallback(
    async (
      cardId: number,
      targetField?: 'question' | 'answer' | 'hint' | 'topic',
      fieldInstruction?: string
    ) => {
      const targetCard = cards.find((c) => c.id === cardId);
      if (!targetCard) return;

      const effectiveKey = sanitizeDeckKey(
        deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato'
      );
      const activeMap =
        clinicalMap ||
        buildGenericClinicalMap(
          effectiveKey,
          extractedMeta.rawCards.length > 0 ? extractedMeta.rawCards : cards
        );

      const lint = lintCard(targetCard);
      singleRepairAbortRef.current?.abort();
      const controller = new AbortController();
      singleRepairAbortRef.current = controller;
      setRepairingCardId(cardId);

      try {
        const preparedPdfs = await ensurePdfsUploadedToGemini(pdfs, controller.signal);
        const apiPdfs = serializePdfsForApi(preparedPdfs);

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

        const {
          imageAlternatives: _omitAlt,
          isResolvingImage: _omitRes,
          imageVerified: _omitVer,
          ...restCard
        } = targetCard;

        const warningsList = lint.warnings.map((w) => `[${w.field}] ${w.message}`);
        if (fieldInstruction) {
          warningsList.unshift(fieldInstruction);
        } else if (warningsList.length === 0) {
          warningsList.push(
            'Refinar clareza clínica, rigor Matuschak/Nielsen, comentário objetivo e tabela HTML comparativa se útil.'
          );
        }

        const data = await fetchJsonWithTimeout<{
          repairedCards?: CanonicalCard[];
          fallback?: boolean;
          error?: string;
        }>('/api/gemini/repair-cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deckKey: effectiveKey,
            flaggedCards: [
              {
                ...restCard,
                question: tokenizeDataUris(restCard.question || ''),
                hint: tokenizeDataUris(restCard.hint || ''),
                warnings: warningsList,
              },
            ],
            clinicalMap: activeMap,
            pdfs: apiPdfs,
            targetField,
            fieldInstruction,
            model: selectedModel,
          }),
          timeoutMs: 90_000,
          signal: controller.signal,
        });

        if (data?.fallback || data?.error || !Array.isArray(data.repairedCards) || data.repairedCards.length === 0) {
          throw new Error(data?.error || 'IA indisponível');
        }

        const rc = data.repairedCards[0];
        const mergedRaw: CanonicalCard = {
          ...targetCard,
          ...rc,
          question: restoreDataUris(rc.question || targetCard.question),
          hint: restoreDataUris(rc.hint || targetCard.hint),
          priority: rc.priority ?? targetCard.priority,
          deck_key: rc.deck_key ?? targetCard.deck_key ?? effectiveKey,
          exam_refs: rc.exam_refs ?? targetCard.exam_refs,
          last_synced_hash: rc.last_synced_hash ?? targetCard.last_synced_hash,
          imageVerified: targetCard.imageVerified,
          imageAlternatives: targetCard.imageAlternatives,
        };
        const finalCard = surgicalRepairCardLocal(mergedRaw, {
          availableMediaNames,
          preserveLocalAudio: true,
        });
        let latestDeck: CanonicalCard[] = cards.map((c) => (c.id === cardId ? finalCard : c));
        setCards((prev) => {
          latestDeck = prev.map((c) => (c.id === cardId ? finalCard : c));
          return latestDeck;
        });

        showStatus(
          targetField
            ? `Campo [${targetField}] do Card ID ${cardId} reescrito com IA.`
            : `Card ID ${cardId} reescrito com IA segundo diretrizes Matuschak & Nielsen.`,
          'success'
        );

        if (/(?:buscar_imagem|pdfimg):/i.test(`${finalCard.question || ''} ${finalCard.hint || ''}`)) {
          void autoResolveDeckMissingImages(latestDeck, availableMediaNames);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const locallyFixed = surgicalRepairCardLocal(targetCard, {
          availableMediaNames,
          preserveLocalAudio: true,
        });
        setCards((prev) => prev.map((c) => (c.id === cardId ? locallyFixed : c)));
        const msg = err instanceof Error ? err.message : 'erro inesperado';
        showStatus(
          `Ajuste local aplicado ao Card ID ${cardId}; reescrita avançada com IA falhou (${msg}).`,
          'info'
        );
      } finally {
        if (singleRepairAbortRef.current === controller) {
          singleRepairAbortRef.current = null;
        }
        setRepairingCardId(null);
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
      setCards,
      showStatus,
    ]
  );

  const handleRunFullPipeline = useCallback(async () => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    const existingCards = cards.length > 0 ? cards : extractedMeta.rawCards;
    const totalStages = existingCards.length > 0 ? 5 : 4;
    let stage = 1;

    setIsRunningFullPipeline(true);
    setFinalVerificationReport(null);
    startTimer({
      phase: 'map',
      label: `Etapa ${stage}/${totalStages}: Planejando Mapa Clínico P1–P4 e diretrizes...`,
      currentBatch: stage,
      totalBatches: totalStages,
      cardsReady: existingCards.length,
      elapsedSec: 0,
    });

    try {
      // 1. Mapa Clínico
      const activeMap = await handleGenerateClinicalMap(signal);
      if (signal.aborted) return;

      // 2. Auditoria card-a-card (se houver deck anterior)
      let cardsForRebuild = existingCards;
      if (existingCards.length > 0) {
        stage++;
        setProgress((prev) =>
          prev
            ? {
                ...prev,
                phase: 'audit',
                currentBatch: stage,
                totalBatches: totalStages,
                label: `Etapa ${stage}/${totalStages}: Julgando ${existingCards.length} card(s) antigo(s)...`,
              }
            : prev
        );
        const auditRes = await handleAuditExistingDeck(activeMap, signal);
        if (signal.aborted) return;
        cardsForRebuild = auditRes.auditedCards;
      }

      // 3. Criar / Reconstruir do Zero + Preencher Lacunas
      stage++;
      setProgress((prev) =>
        prev
          ? {
              ...prev,
              phase: 'batches',
              currentBatch: stage,
              totalBatches: totalStages,
              label: `Etapa ${stage}/${totalStages}: Reconstruindo cards fracos do zero e cobrindo P1–P4...`,
            }
          : prev
      );
      const rebuiltCards = await handleRecreateCanonicalDeck(
        activeMap,
        cardsForRebuild,
        signal
      );
      if (signal.aborted || !rebuiltCards) return;

      // 4. Imagens (Apostila + Visão Computacional Estrita Web)
      stage++;
      setProgress((prev) =>
        prev
          ? {
              ...prev,
              phase: 'images',
              currentBatch: stage,
              totalBatches: totalStages,
              cardsReady: rebuiltCards.length,
              label: `Etapa ${stage}/${totalStages}: Validando imagens da Apostila e Web (visão computacional)...`,
            }
          : prev
      );
      let cardsWithImages = await autoResolveDeckMissingImages(
        rebuiltCards,
        availableMediaNames
      );
      if (signal.aborted) return;

      // 5. Verificação Final Holística (+ 1 rodada automática de correção se necessário)
      stage++;
      setProgress((prev) =>
        prev
          ? {
              ...prev,
              phase: 'verify',
              currentBatch: stage,
              totalBatches: totalStages,
              cardsReady: cardsWithImages.length,
              label: `Etapa ${stage}/${totalStages}: Confirmando adequação clínica e cobertura final...`,
            }
          : prev
      );
      let finalReport = await handleVerifyDeckAdequacy(
        cardsWithImages,
        activeMap,
        signal
      );
      if (signal.aborted) return;

      if (
        finalReport &&
        !finalReport.approved &&
        (finalReport.missingConcepts.length > 0 || finalReport.weakCardFixes.length > 0)
      ) {
        setProgress((prev) =>
          prev
            ? {
                ...prev,
                phase: 'repair',
                label: 'Aplicando rodada automática de ajustes finais detectados na verificação...',
              }
            : prev
        );
        const effectiveKey = sanitizeDeckKey(
          activeMap.deckKey || deckKey || extractedMeta.detectedDeckKey || 'tema_clinico_internato'
        );
        let workingCards = [...cardsWithImages];

        if (finalReport.weakCardFixes.length > 0) {
          const fixMap = new Map(
            finalReport.weakCardFixes.map((f) => [f.cardId, f])
          );
          const preparedVerifyPdfs = await ensurePdfsUploadedToGemini(pdfs, signal);
          const apiVerifyPdfs = serializePdfsForApi(preparedVerifyPdfs);
          const allFlaggedPayload = workingCards
            .filter((c) => fixMap.has(c.id))
            .map((c) => {
              const fix = fixMap.get(c.id)!;
              return {
                id: c.id,
                type: c.type,
                priority: c.priority,
                topic: c.topic,
                question: c.question,
                answer: c.answer,
                hint: c.hint,
                warnings: [`${fix.issue} -> ${fix.fixInstruction}`],
              };
            });
          const CHUNK_VERIFY_FIX = 12;
          for (let i = 0; i < allFlaggedPayload.length; i += CHUNK_VERIFY_FIX) {
            if (signal.aborted) break;
            const flaggedChunk = allFlaggedPayload.slice(i, i + CHUNK_VERIFY_FIX);
            try {
              const fixResp = await fetchJsonWithTimeout<{
                repairedCards?: CanonicalCard[];
                fallback?: boolean;
              }>('/api/gemini/repair-cards', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  deckKey: effectiveKey,
                  flaggedCards: flaggedChunk,
                  clinicalMap: activeMap,
                  pdfs: apiVerifyPdfs,
                  model: selectedModel,
                }),
                timeoutMs: 120_000,
                signal,
              });
              if (!fixResp?.fallback && Array.isArray(fixResp.repairedCards)) {
                const fixedById = new Map(
                  fixResp.repairedCards.map((r) => [
                    r.id,
                    surgicalRepairCardLocal(r, { availableMediaNames, preserveLocalAudio: true }),
                  ])
                );
                workingCards = workingCards.map((c) =>
                  fixedById.has(c.id) ? { ...c, ...fixedById.get(c.id)! } : c
                );
              }
            } catch {
              // keep workingCards
            }
          }
        }

        if (finalReport.missingConcepts.length > 0) {
          const syntheticMap: ClinicalMapResponse = {
            ...activeMap,
            items: finalReport.missingConcepts.map((m, idx) => ({
              id: `verify-gap-${idx + 1}`,
              priority: m.priority,
              subtopic: m.subtopic,
              concept: m.concept,
              guidelineNote: 'Lacuna detectada na verificação final.',
              targetCardType: m.recommendedType,
              checked: true,
            })),
          };
          const gapIdStart =
            Math.max(
              171000200,
              ...(extractedMeta.existingIds || []),
              ...workingCards.map((c) => Number(c.id) || 0)
            ) + 1;
          try {
            const gapResp = await fetchJsonWithTimeout<{
              notes?: CanonicalCard[];
              fallback?: boolean;
            }>('/api/gemini/fill-map-gaps', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                deckKey: effectiveKey,
                clinicalMap: syntheticMap,
                rebuiltCards: workingCards,
                pdfImagesCatalog: buildPdfImagesCatalog(pdfsRef.current),
                nextNewIdStart: gapIdStart,
                model: selectedModel,
              }),
              timeoutMs: 120_000,
              signal,
            });
            if (!gapResp?.fallback && Array.isArray(gapResp.notes)) {
              const seenIds = new Set([
                ...(extractedMeta.existingIds || []),
                ...workingCards.map((c) => c.id),
              ]);
              for (const n of gapResp.notes) {
                if (!seenIds.has(n.id)) {
                  seenIds.add(n.id);
                  workingCards.push(n);
                }
              }
            }
          } catch {
            // non-fatal
          }
        }

        const { cards: reCurated, stats: reStats } = curateAndRebalanceDeck(
          workingCards,
          extractedMeta,
          effectiveKey,
          activeMap,
          {
            skipTemplateGapAdditions: true,
            availableMediaNames,
            preserveLocalAudio: true,
            blockedImageFilenames: blockedImagesRef.current,
          }
        );
        setCards(reCurated);
        setCurationStats(reStats);
        cardsWithImages = await autoResolveDeckMissingImages(
          reCurated,
          availableMediaNames
        );
        finalReport = await handleVerifyDeckAdequacy(
          cardsWithImages,
          activeMap,
          signal
        );
      }

      if (finalReport) {
        showStatus(
          `Pipeline Completo finalizado! Nota final: ${finalReport.overallScore}/10 · Cobertura: ${finalReport.mapCoveragePct}% (${cardsWithImages.length} cards).`,
          finalReport.approved ? 'success' : 'info'
        );
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        const msg = err instanceof Error ? err.message : 'erro inesperado';
        showStatus(`Pipeline completo interrompido (${msg}).`, 'error');
      }
    } finally {
      setIsRunningFullPipeline(false);
      stopTimerAndReset();
    }
  }, [
    autoResolveDeckMissingImages,
    availableMediaNames,
    blockedImageFilenames,
    cards,
    deckKey,
    ensurePdfsUploadedToGemini,
    extractedMeta,
    handleAuditExistingDeck,
    handleGenerateClinicalMap,
    handleRecreateCanonicalDeck,
    handleVerifyDeckAdequacy,
    pdfs,
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
    isAuditingDeck,
    isGeneratingDeck,
    isRepairing,
    repairingCardId,
    isVerifyingDeck,
    isRunningFullPipeline,
    deckAuditReport,
    finalVerificationReport,
    progress,
    cancelGeneration,
    handleGenerateClinicalMap,
    handleDeepenGuidelines,
    handleAuditExistingDeck,
    handleRecreateCanonicalDeck,
    handleAutoRepairAllFlagged,
    handleAutoRepairSingleCardWithAi,
    handleVerifyDeckAdequacy,
    handleRunFullPipeline,
  };
}
