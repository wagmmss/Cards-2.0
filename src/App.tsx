import React, { useCallback, useEffect, useState } from 'react';
import { TopBar } from './components/TopBar';
import { InputPanel } from './components/InputPanel';
import { ClinicalMapSection } from './components/ClinicalMapSection';
import { WozniakLinterDeck } from './components/WozniakLinterDeck';
import { QuickReviewModal } from './components/QuickReviewModal';
import { DoctrineReferenceSection } from './components/DoctrineReferenceSection';
import {
  CanonicalCard,
  CardType,
  ClinicalMapResponse,
  DeckCurationStats,
  DomainProfile,
  ExtractedDeckMetadata,
  GuidRegistryData,
  MedicalImageResult,
  PriorityLevel,
  UploadedPdfFile,
} from './types/deck';
import {
  applyResolvedWebImageToCard,
  computeDeterministicDeckId,
  curateAndRebalanceDeck,
  extractDeckMediaManifest,
  extractDeckMetadata,
  extractUnresolvedLocalImages,
  formatCanonicalDeckJson,
  lintCard,
  lintDeck,
  removeMissingMediaFromCard,
  resolveOrCreateNoteGuid,
  stripHtml,
  surgicalRepairCardLocal,
} from './utils/wozniakLinter';
import {
  buildGenericCanonicalCards,
  buildGenericClinicalMap,
  GENERIC_SAMPLE_DECK_JSON,
} from './data/demoDecks';

const EMPTY_META: ExtractedDeckMetadata = {
  existingIds: [],
  mediaTags: [],
  detectedDeckKey: '',
  rawCards: [],
  removedOrphanAudioCount: 0,
};

const STORAGE_DECK_STATE_KEY = 'cards2_deck_state_v2';
const STORAGE_GUID_REGISTRY_KEY = 'cards2_guid_registry_v2';

function loadSavedGuidRegistry(): GuidRegistryData {
  try {
    const raw = localStorage.getItem(STORAGE_GUID_REGISTRY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.entries === 'object' && parsed.entries !== null) {
        return { version: 1, entries: parsed.entries };
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return { version: 1, entries: {} };
}

export default function App() {
  const [pdfs, setPdfs] = useState<UploadedPdfFile[]>([]);
  const [rawJsonText, setRawJsonText] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [extractedMeta, setExtractedMeta] = useState<ExtractedDeckMetadata>(EMPTY_META);
  const [deckKey, setDeckKey] = useState<string>('');
  const [selectedProfile, setSelectedProfile] = useState<'auto' | DomainProfile>('auto');
  const [useGoogleSearch, setUseGoogleSearch] = useState<boolean>(true);

  const [clinicalMap, setClinicalMap] = useState<ClinicalMapResponse | null>(null);
  const [cards, setCards] = useState<CanonicalCard[]>([]);
  const [curationStats, setCurationStats] = useState<DeckCurationStats | null>(null);

  const [guidRegistry, setGuidRegistry] = useState<GuidRegistryData>(() =>
    loadSavedGuidRegistry()
  );

  const [isGeneratingMap, setIsGeneratingMap] = useState<boolean>(false);
  const [isGeneratingDeck, setIsGeneratingDeck] = useState<boolean>(false);
  const [isRepairing, setIsRepairing] = useState<boolean>(false);
  const [isAutoResolvingImages, setIsAutoResolvingImages] = useState<boolean>(false);
  const [isExportingBundle, setIsExportingBundle] = useState<boolean>(false);
  const [isExportingApkg, setIsExportingApkg] = useState<boolean>(false);
  const [isSyncingAnkiConnect, setIsSyncingAnkiConnect] = useState<boolean>(false);
  const [isQuickReviewOpen, setIsQuickReviewOpen] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'info' | 'success' | 'error'>('info');

  const showStatus = useCallback((message: string, tone: 'info' | 'success' | 'error' = 'info') => {
    setStatusTone(tone);
    setStatusMessage(message);
  }, []);

  // Automatically resolves any card with `<img src="arquivo_local.png">` via Google/Web medical image search
  const autoResolveDeckMissingImages = useCallback(
    async (targetCards: CanonicalCard[], availableNames: string[] = []) => {
      const cardsNeedingWebImage = targetCards.filter(
        (c) => extractUnresolvedLocalImages(c, availableNames).length > 0
      );
      if (cardsNeedingWebImage.length === 0) return;

      setIsAutoResolvingImages(true);
      const pendingIds = new Set(cardsNeedingWebImage.map((c) => c.id));
      setCards((prev) =>
        prev.map((c) => (pendingIds.has(c.id) ? { ...c, isResolvingImage: true } : c))
      );

      let resolvedCount = 0;

      for (const card of cardsNeedingWebImage) {
        const unresolvedList = extractUnresolvedLocalImages(card, availableNames);
        if (unresolvedList.length === 0) continue;

        const targetRef = unresolvedList[0];

        let webImages: MedicalImageResult[] = [];
        try {
          const resp = await fetch('/api/media/search-medical-images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: targetRef.searchQuery,
              topic: card.topic,
              question: stripHtml(card.question),
              hint: stripHtml(card.hint),
              preferGoogleGrounding: true,
            }),
          });
          if (resp.ok) {
            const data = await resp.json();
            if (Array.isArray(data.images)) {
              webImages = data.images;
            }
          }
        } catch {
          // Leave unresolved if network fails (never inject synthetic SVGs)
        }

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
            prev.map((c) =>
              c.id === card.id ? { ...c, isResolvingImage: false } : c
            )
          );
        }
      }

      setIsAutoResolvingImages(false);
      if (resolvedCount > 0) {
        setStatusMessage(
          `🔍 ${resolvedCount} imagem(ns) local(is) ausente(s) foram buscadas e substituídas automaticamente via Google/Web (com 4–6 alternativas de troca rápida em 1 clique).`
        );
      }
    },
    []
  );

  // Restore saved deck state on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DECK_STATE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.cards) && parsed.cards.length > 0) {
        setCards(parsed.cards);
        if (typeof parsed.deckKey === 'string') setDeckKey(parsed.deckKey);
        if (typeof parsed.rawJsonText === 'string') setRawJsonText(parsed.rawJsonText);
        if (parsed.extractedMeta) setExtractedMeta(parsed.extractedMeta);
        if (parsed.clinicalMap) setClinicalMap(parsed.clinicalMap);
        if (parsed.curationStats) setCurationStats(parsed.curationStats);
      }
    } catch {
      // Ignore invalid saved state
    }
  }, []);

  // Auto-save deck state & sync deterministic FSRS GUIDs whenever cards or deckKey change
  useEffect(() => {
    try {
      if (cards.length > 0 || deckKey.trim()) {
        localStorage.setItem(
          STORAGE_DECK_STATE_KEY,
          JSON.stringify({
            deckKey,
            rawJsonText,
            extractedMeta,
            clinicalMap,
            cards,
            curationStats,
          })
        );
      }
    } catch {
      // Ignore quota exceeded
    }

    if (cards.length > 0) {
      const effectiveKey = (deckKey || 'deck').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
      const deckId = computeDeterministicDeckId(effectiveKey);
      setGuidRegistry((prev) => {
        const next: GuidRegistryData = {
          version: 1,
          entries: { ...prev.entries },
        };
        let changed = false;
        for (const card of cards) {
          const regKey = `${effectiveKey}:id:${card.id}`;
          if (!next.entries[regKey]) {
            resolveOrCreateNoteGuid(effectiveKey, deckId, card.id, next.entries);
            changed = true;
          }
        }
        if (changed) {
          try {
            localStorage.setItem(STORAGE_GUID_REGISTRY_KEY, JSON.stringify(next));
          } catch {
            // Ignore storage write error
          }
          return next;
        }
        return prev;
      });
    }
  }, [cards, deckKey, rawJsonText, extractedMeta, clinicalMap, curationStats]);

  const handleRemoveMissingMediaFromCard = (cardId: number) => {
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? removeMissingMediaFromCard(c) : c))
    );
    setStatusMessage(`Referência de mídia ausente removida do Card ID ${cardId}.`);
  };

  const handleRemoveAllMissingMedia = () => {
    setCards((prev) => prev.map((c) => removeMissingMediaFromCard(c)));
    setStatusMessage('Todas as referências de mídias órfãs foram limpas do baralho.');
  };

  const handleImportGuidRegistry = (jsonText: string) => {
    try {
      const parsed = JSON.parse(jsonText);
      const entries =
        parsed?.entries && typeof parsed.entries === 'object' ? parsed.entries : parsed;
      if (!entries || typeof entries !== 'object') {
        throw new Error('Formato inválido para note_guid_registry.json');
      }
      const merged: GuidRegistryData = {
        version: 1,
        entries: {
          ...guidRegistry.entries,
          ...entries,
        },
      };
      setGuidRegistry(merged);
      localStorage.setItem(STORAGE_GUID_REGISTRY_KEY, JSON.stringify(merged));
      setStatusMessage(
        `Registro note_guid_registry.json importado (${Object.keys(merged.entries).length} GUIDs FSRS ativos).`
      );
    } catch (err: unknown) {
      setStatusMessage(
        err instanceof Error ? err.message : 'Erro ao importar note_guid_registry.json.'
      );
    }
  };

  const handleExportGuidRegistry = () => {
    const jsonString = JSON.stringify(guidRegistry, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'note_guid_registry.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRawJsonChange = (text: string) => {
    setRawJsonText(text);
    if (!text.trim()) {
      setJsonError(null);
      setExtractedMeta(EMPTY_META);
      setCurationStats(null);
      return;
    }

    try {
      const meta = extractDeckMetadata(text);
      setJsonError(null);
      setExtractedMeta(meta);
      setCurationStats(null);
      const effectiveKey = meta.detectedDeckKey || deckKey.trim() || 'tema_clinico_internato';
      if (meta.detectedDeckKey && !deckKey.trim()) {
        setDeckKey(meta.detectedDeckKey);
      }
      if (meta.rawCards.length > 0) {
        setCards(meta.rawCards);
        setClinicalMap(buildGenericClinicalMap(effectiveKey, meta.rawCards));
        const rawBasic = meta.rawCards.filter((c) => c.type === 'basic').length;
        const rawBasicPct = Math.round((rawBasic / meta.rawCards.length) * 100);
        const rawClozePct = 100 - rawBasicPct;
        const audioMsg =
          meta.removedOrphanAudioCount && meta.removedOrphanAudioCount > 0
            ? ` (${meta.removedOrphanAudioCount} tag(s) de áudio órfãs removidas automaticamente)`
            : '';
        setStatusMessage(
          `Deck carregado (${meta.rawCards.length} cards · ${rawBasicPct}% basic / ${rawClozePct}% cloze)${audioMsg}. Imagens locais sem arquivo estão sendo buscadas automaticamente no Google/Web.`
        );
        void autoResolveDeckMissingImages(meta.rawCards);
      }
    } catch (err: unknown) {
      setJsonError(err instanceof Error ? err.message : 'Erro ao analisar JSON.');
    }
  };

  const handleLoadGenericSample = () => {
    const meta = extractDeckMetadata(GENERIC_SAMPLE_DECK_JSON);
    const key = meta.detectedDeckKey || 'manejo_clinico_emergencia';
    setRawJsonText(GENERIC_SAMPLE_DECK_JSON);
    setJsonError(null);
    setExtractedMeta(meta);
    setDeckKey(key);
    setCurationStats(null);
    setClinicalMap(buildGenericClinicalMap(key, meta.rawCards));
    setCards(meta.rawCards);
    setStatusMessage(
      `Exemplo carregado (${meta.existingIds.length} IDs FSRS). Teste a Galeria de Troca Rápida Online (4–6 miniaturas), a "👁️ Revisão Rápida (Anki)" ou a exportação direta para .apkg.`
    );
    void autoResolveDeckMissingImages(meta.rawCards);
  };

  const handleAddPdfs = (newFiles: UploadedPdfFile[]) => {
    setPdfs((prev) => [...prev, ...newFiles]);
  };

  const handleRemovePdf = (index: number) => {
    setPdfs((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleClearPdfs = () => {
    setPdfs([]);
  };

  const ensurePdfsUploadedToGemini = useCallback(
    async (sourcePdfs: UploadedPdfFile[]): Promise<UploadedPdfFile[]> => {
      if (!Array.isArray(sourcePdfs) || sourcePdfs.length === 0) return sourcePdfs;
      const updated = [...sourcePdfs];
      let anyUploaded = false;

      const pendingIndices = updated
        .map((p, idx) => (p.base64Data && !p.fileUri && !p.textContent ? idx : -1))
        .filter((idx) => idx !== -1);

      for (let i = 0; i < pendingIndices.length; i++) {
        const idx = pendingIndices[i];
        const pdf = updated[idx];
        showStatus(
          `📄 Enviando documento ${i + 1}/${pendingIndices.length} (${pdf.name}) para leitura multimodal...`,
          'info'
        );
        try {
          const resp = await fetch('/api/gemini/upload-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: pdf.name,
              mimeType: pdf.mimeType || 'application/pdf',
              base64Data: pdf.base64Data,
            }),
          });
          if (resp.ok) {
            const data = (await resp.json()) as {
              fileUri?: string;
              fileName?: string;
              mimeType?: string;
              fallback?: boolean;
            };
            if (data?.fileUri && !data.fallback) {
              updated[idx] = {
                ...pdf,
                fileUri: data.fileUri,
                fileName: data.fileName,
                mimeType: data.mimeType || pdf.mimeType,
              };
              anyUploaded = true;
            }
          }
        } catch {
          // Keep base64Data fallback if pre-upload fails
        }
      }

      if (anyUploaded) {
        setPdfs(updated);
      }
      return updated;
    },
    [showStatus]
  );

  const serializePdfsForApi = (sourcePdfs: UploadedPdfFile[]) =>
    sourcePdfs.map((p) =>
      p.fileUri
        ? {
            name: p.name,
            size: p.size,
            mimeType: p.mimeType,
            fileUri: p.fileUri,
            fileName: p.fileName,
            docRole: p.docRole,
          }
        : p
    );

  // Passo 1: Gerar Mapa Clínico (P1 a P4) + Atualizações de Diretrizes
  const handleGenerateClinicalMap = async (): Promise<ClinicalMapResponse> => {
    const effectiveKey = deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato';
    if (!deckKey.trim()) {
      setDeckKey(effectiveKey);
    }

    const profileOverride = selectedProfile === 'auto' ? undefined : selectedProfile;
    setIsGeneratingMap(true);
    const optimisticMap = buildGenericClinicalMap(
      effectiveKey,
      extractedMeta.rawCards,
      profileOverride
    );
    setClinicalMap(optimisticMap);
    showStatus('Mapeando prioridades P1→P4 e consultando diretrizes...', 'info');

    try {
      const preparedPdfs = await ensurePdfsUploadedToGemini(pdfs);
      showStatus('Mapeando prioridades P1→P4 e consultando diretrizes...', 'info');

      const existingSummary = extractedMeta.rawCards
        .slice(0, 30)
        .map((c) => `ID ${c.id} [${c.type}]: ${c.topic} -> ${c.question.slice(0, 140)}`)
        .join('\n');

      const response = await fetch('/api/gemini/clinical-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckKey: effectiveKey,
          profile: selectedProfile,
          pdfs: serializePdfsForApi(preparedPdfs),
          existingJsonSummary: existingSummary,
          useGoogleSearch,
        }),
      });

      if (!response.ok) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(errPayload?.error || `HTTP ${response.status}`);
      }

      const data = (await response.json()) as ClinicalMapResponse & {
        fallback?: boolean;
        error?: string;
      };
      if (data?.fallback || data?.error) {
        showStatus(
          `⚠️ IA indisponível no Mapa Clínico (${data.error || 'erro desconhecido'}). Exibindo rascunho local para revisão.`,
          'error'
        );
        return optimisticMap;
      }
      if (data && Array.isArray(data.items) && data.items.length > 0) {
        setClinicalMap(data);
        showStatus(
          `Mapa Clínico P1–P4 gerado para "${data.themeTitle}" (${data.items.length} conceitos).`,
          'success'
        );
        return data;
      }
      return optimisticMap;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'erro de rede';
      showStatus(
        `⚠️ Falha ao chamar /api/gemini/clinical-map (${msg}). Exibindo rascunho local para revisão.`,
        'error'
      );
      return optimisticMap;
    } finally {
      setIsGeneratingMap(false);
    }
  };

  // Curadoria local determinística: Poda de redundâncias + Adição P1-P4 preservando IDs FSRS e formato fluido
  const handleCurateAndRebalance = () => {
    const effectiveKey = deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato';
    const profileOverride = selectedProfile === 'auto' ? undefined : selectedProfile;
    const activeMap =
      clinicalMap ||
      buildGenericClinicalMap(
        effectiveKey,
        extractedMeta.rawCards.length > 0 ? extractedMeta.rawCards : cards,
        profileOverride
      );
    if (!clinicalMap) {
      setClinicalMap(activeMap);
    }

    const sourceCards = cards.length > 0 ? cards : extractedMeta.rawCards;
    if (sourceCards.length === 0) return;

    const { cards: curated, stats } = curateAndRebalanceDeck(
      sourceCards,
      extractedMeta,
      effectiveKey,
      activeMap
    );
    setCards(curated);
    setCurationStats(stats);
    setStatusMessage(
      `Curadoria concluída: ${stats.originalCount} cards originais → ${stats.finalCount} cards finais (${stats.prunedCount} podados, +${stats.addedCount} novos P1–P4, ${stats.basicPct}% basic / ${stats.clozePct}% cloze).`
    );
    void autoResolveDeckMissingImages(curated);
  };

  // Passo 2: Reconstrução Profunda em Lotes via Gemini (sem fallback silencioso!)
  const handleRecreateCanonicalDeck = async (mapOverride?: ClinicalMapResponse) => {
    const effectiveKey = deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato';
    if (!deckKey.trim()) {
      setDeckKey(effectiveKey);
    }

    const profileOverride = selectedProfile === 'auto' ? undefined : selectedProfile;
    const activeMap =
      mapOverride ||
      clinicalMap ||
      buildGenericClinicalMap(effectiveKey, extractedMeta.rawCards, profileOverride);
    if (!clinicalMap) {
      setClinicalMap(activeMap);
    }

    const sourceCards = extractedMeta.rawCards.length > 0 ? extractedMeta.rawCards : cards;
    setIsGeneratingDeck(true);

    try {
      const preparedPdfs = await ensurePdfsUploadedToGemini(pdfs);
      const apiPdfs = serializePdfsForApi(preparedPdfs);
      const allRebuiltNotes: CanonicalCard[] = [];

      if (sourceCards.length > 0) {
        const BATCH_SIZE = 10;
        const CONCURRENCY = 2;
        const ID_STRIDE = 100;
        const totalBatches = Math.ceil(sourceCards.length / BATCH_SIZE);
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
            const batchIndex = nextBatchIdx++;
            const batchCards = sourceCards.slice(
              batchIndex * BATCH_SIZE,
              (batchIndex + 1) * BATCH_SIZE
            );
            const batchNewIdStart = baseNewIdStart + batchIndex * ID_STRIDE;

            showStatus(
              `🧠 Reconstruindo do zero em paralelo (${completedBatches}/${totalBatches} lotes concluídos)...`,
              'info'
            );

            const response = await fetch('/api/gemini/generate-deck', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                deckKey: effectiveKey,
                pdfs: apiPdfs,
                clinicalMap: activeMap,
                existingMetadata: extractedMeta,
                batchCards,
                batchIndex,
                totalBatches,
                nextNewIdStart: batchNewIdStart,
                deckOutline,
              }),
            });

            if (!response.ok) {
              throw new Error(`HTTP ${response.status} no lote ${batchIndex + 1}/${totalBatches}`);
            }

            const data = await response.json();
            if (data?.fallback || data?.error) {
              throw new Error(
                data.error || `Falha da IA no lote ${batchIndex + 1}/${totalBatches}`
              );
            }

            const batchNotes: CanonicalCard[] = Array.isArray(data.notes) ? data.notes : [];
            if (batchNotes.length === 0) {
              throw new Error(`Lote ${batchIndex + 1}/${totalBatches} retornou 0 cards da IA.`);
            }

            batchResults[batchIndex] = batchNotes;
            completedBatches++;
            const rebuiltSoFar = batchResults.reduce((acc, arr) => acc + arr.length, 0);
            showStatus(
              `🧠 Reconstruindo do zero (${completedBatches}/${totalBatches} lotes concluídos — ${rebuiltSoFar} cards prontos)...`,
              'info'
            );
          }
        };

        const workerCount = Math.min(CONCURRENCY, totalBatches);
        await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
        for (const notes of batchResults) {
          allRebuiltNotes.push(...notes);
        }

        if (activeMap?.items?.some((item) => item.checked !== false)) {
          showStatus(
            `🔎 Auditando lacunas do Mapa Clínico P1–P4 sobre ${allRebuiltNotes.length} cards reconstruídos...`,
            'info'
          );
          const gapNewIdStart =
            Math.max(
              171000200,
              ...(extractedMeta.existingIds || []),
              ...allRebuiltNotes.map((n) => Number(n.id) || 0)
            ) + 1;
          const gapResp = await fetch('/api/gemini/fill-map-gaps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              deckKey: effectiveKey,
              clinicalMap: activeMap,
              rebuiltCards: allRebuiltNotes,
              nextNewIdStart: gapNewIdStart,
            }),
          });
          if (gapResp.ok) {
            const gapData = await gapResp.json();
            if (!gapData?.fallback && !gapData?.error && Array.isArray(gapData.notes)) {
              const seenIds = new Set(allRebuiltNotes.map((n) => Number(n.id)));
              for (const g of gapData.notes as CanonicalCard[]) {
                const gid = Number(g.id);
                if (!seenIds.has(gid)) {
                  seenIds.add(gid);
                  allRebuiltNotes.push(g);
                }
              }
            }
          }
        }
      } else {
        showStatus('🧠 Gerando deck completo do zero com Gemini (Matuschak & Nielsen)...', 'info');
        const response = await fetch('/api/gemini/generate-deck', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deckKey: effectiveKey,
            pdfs: apiPdfs,
            clinicalMap: activeMap,
            existingMetadata: extractedMeta,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data?.fallback || data?.error) {
          throw new Error(data.error || 'Falha ao gerar deck com Gemini.');
        }

        const notes: CanonicalCard[] = Array.isArray(data.notes) ? data.notes : [];
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
        `✨ Reconstrução profunda por IA concluída! ${finalStats.originalCount} originais → ${finalStats.finalCount} cards reconstruídos (${finalStats.preservedIdsCount} IDs FSRS preservados, ${finalStats.prunedCount} podados, +${finalStats.addedCount} novos, ${finalStats.convertedCount} convertidos, ${finalStats.basicPct}% basic / ${finalStats.clozePct}% cloze).`,
        'success'
      );
      void autoResolveDeckMissingImages(finalCurated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'erro desconhecido';
      showStatus(
        `❌ Reconstrução por IA falhou (${msg}). Seus cards atuais NÃO foram sobrescritos. Verifique a GEMINI_API_KEY ou use "Revisar, Podar & Auditar" apenas para ajustes locais.`,
        'error'
      );
    } finally {
      setIsGeneratingDeck(false);
    }
  };

  // ⚡ Auto-Reparar Avisos com IA (Matuschak & Nielsen com formato fluido)
  const handleAutoRepairAllFlagged = async () => {
    const effectiveKey = deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato';
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
      activeMap
    );
    setCards(curatedAndRepaired);
    setCurationStats(stats);
    setStatusMessage(
      `Deck curado (${stats.finalCount} cards · ${stats.basicPct}% basic / ${stats.clozePct}% cloze · ${stats.preservedIdsCount} IDs FSRS mantidos).`
    );

    const flaggedWithWarnings = curatedAndRepaired
      .map((card) => ({
        card,
        lint: lintCard(card),
      }))
      .filter((item) => !item.lint.isValid);

    if (flaggedWithWarnings.length === 0) return;

    setIsRepairing(true);
    try {
      const response = await fetch('/api/gemini/repair-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckKey: deckKey || 'deck',
          flaggedCards: flaggedWithWarnings.slice(0, 25).map((f) => ({
            ...f.card,
            warnings: f.lint.warnings.map((w) => w.message),
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const repairedList: CanonicalCard[] = Array.isArray(data.repairedCards)
        ? data.repairedCards
        : [];

      if (repairedList.length > 0) {
        const repairedById = new Map<number, CanonicalCard>();
        repairedList.forEach((rc) => {
          if (rc && typeof rc.id === 'number') {
            repairedById.set(rc.id, surgicalRepairCardLocal(rc));
          }
        });

        setCards((prev) =>
          prev.map((c) => (repairedById.has(c.id) ? repairedById.get(c.id)! : c))
        );
      }
    } catch {
      // Already repaired deterministically
    } finally {
      setIsRepairing(false);
    }
  };

  const handleAutoRepairSingleCard = (cardId: number) => {
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? surgicalRepairCardLocal(c) : c))
    );
  };

  const handleUpdateCard = (updated: CanonicalCard) => {
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handleDeleteCard = (id: number) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  };

  const handleAddNewCard = () => {
    const maxId =
      cards.length > 0 ? Math.max(...cards.map((c) => c.id)) : 171000100;
    const effectiveKey = deckKey.trim() || 'tema_clinico';
    const newCard: CanonicalCard = {
      id: maxId + 1,
      type: 'basic',
      priority: 'P1',
      deck_key: effectiveKey,
      topic: 'Tema Clínico - Conduta Imediata',
      question:
        'Na Sala de Emergência, paciente adulto apresenta sinais de alarme e instabilidade aguda para a condição investigada. Qual a conduta imediata de estabilização (minuto zero)?',
      answer: 'Estabilização hemodinâmica imediata e início do tratamento de primeira escolha.',
      hint: '<b>Comentário:</b> A <b>conduta imediata no minuto zero</b> reduz desfechos adversos graves, ao passo que a <b>terapia de 2ª linha</b> reserva-se aos casos refratários.',
      tags: [effectiveKey, 'p1'],
    };
    setCards((prev) => [newCard, ...prev]);
  };

  const handleToggleMapItem = (id: string) => {
    setClinicalMap((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((item) =>
              item.id === id ? { ...item, checked: !item.checked } : item
            ),
          }
        : prev
    );
  };

  const handleToggleItemCardType = (id: string) => {
    setClinicalMap((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((item) =>
              item.id === id
                ? {
                    ...item,
                    targetCardType: item.targetCardType === 'basic' ? 'cloze' : 'basic',
                  }
                : item
            ),
          }
        : prev
    );
  };

  const handleAddCustomMapItem = (
    priority: PriorityLevel,
    subtopic: string,
    concept: string,
    targetCardType: CardType
  ) => {
    setClinicalMap((prev) => {
      const base = prev || buildGenericClinicalMap(deckKey || 'tema_clinico');
      return {
        ...base,
        items: [
          ...base.items,
          {
            id: `custom-${Date.now()}`,
            priority,
            subtopic,
            concept,
            guidelineNote: 'Adicionado manualmente',
            targetCardType,
            checked: true,
          },
        ],
      };
    });
  };

  const buildMediaAssetsPayload = (): Record<string, string> => ({});

  const handleDownloadJson = () => {
    const cleanDeckKey = (deckKey || 'deck')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    const jsonString = formatCanonicalDeckJson(cards, extractedMeta, cleanDeckKey);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cleanDeckKey}_notes.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadOfflineBundle = async () => {
    const cleanDeckKey = (deckKey || 'deck')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    const notesJson = formatCanonicalDeckJson(cards, extractedMeta, cleanDeckKey);
    const mediaManifest = extractDeckMediaManifest(cards, cleanDeckKey);
    const mediaAssets = buildMediaAssetsPayload();

    setIsExportingBundle(true);
    try {
      const response = await fetch('/api/media/export-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckKey: cleanDeckKey,
          notesJson,
          mediaManifest,
          mediaAssets,
          guidRegistry,
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const resolvedCount = Number(response.headers.get('X-Resolved-Media-Count') || 0);
      const missingCount = Number(response.headers.get('X-Missing-Media-Count') || 0);
      const missingHeader = response.headers.get('X-Missing-Media') || '';
      const missingList = missingHeader ? decodeURIComponent(missingHeader) : '';

      const zipBlob = await response.blob();
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cleanDeckKey}_anki_offline_bundle.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (missingCount > 0) {
        setStatusMessage(
          `⚠️ Pacote .zip baixado (${resolvedCount}/${mediaManifest.length} mídias embutidas), mas ${missingCount} mídia(s) não puderam ser baixadas (${missingList}).`
        );
      } else {
        setStatusMessage(
          `✅ Pacote Anki Offline (${cleanDeckKey}_anki_offline_bundle.zip) baixado com ${cleanDeckKey}_notes.json, note_guid_registry.json e ${resolvedCount}/${mediaManifest.length} mídia(s) em collection.media/.`
        );
      }
    } catch {
      handleDownloadJson();
    } finally {
      setIsExportingBundle(false);
    }
  };

  const handleExportApkg = async () => {
    if (cards.length === 0) return;
    const cleanDeckKey = (deckKey || 'deck')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    const canonicalJson = formatCanonicalDeckJson(cards, extractedMeta, cleanDeckKey);
    const canonicalNotes = JSON.parse(canonicalJson);
    const mediaManifest = extractDeckMediaManifest(cards, cleanDeckKey);
    const mediaAssets = buildMediaAssetsPayload();
    const deckTitle = clinicalMap?.themeTitle
      ? `Internato::${clinicalMap.themeTitle}`
      : `Internato::${cleanDeckKey}`;

    setIsExportingApkg(true);
    try {
      const response = await fetch('/api/export/apkg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckName: deckTitle,
          deckKey: cleanDeckKey,
          notes: canonicalNotes,
          mediaManifest,
          mediaAssets,
          guidRegistry,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      const resolvedCount = Number(response.headers.get('X-Resolved-Media-Count') || 0);
      const missingCount = Number(response.headers.get('X-Missing-Media-Count') || 0);
      const missingHeader = response.headers.get('X-Missing-Media') || '';
      const missingList = missingHeader ? decodeURIComponent(missingHeader) : '';
      const deckAudit = lintDeck(cards, undefined, cleanDeckKey);
      const auditNotes: string[] = [];
      if (deckAudit.duplicateImages.length > 0) {
        auditNotes.push(`${deckAudit.duplicateImages.length} imagem(ns) repetida(s)`);
      }
      const missingLegendErrs = deckAudit.errors.filter((e) => e.code === 'IMAGE_MISSING_LEGEND').length;
      if (missingLegendErrs > 0) {
        auditNotes.push(`${missingLegendErrs} legenda(s) <i/> curta(s)/ausente(s)`);
      }
      const modalityErrs = deckAudit.errors.filter((e) => e.code === 'MODALITY_CONFLICT').length;
      if (modalityErrs > 0) {
        auditNotes.push(`${modalityErrs} conflito(s) de modalidade`);
      }
      const auditSuffix =
        auditNotes.length > 0
          ? ` | Auditoria visual: ${auditNotes.join(', ')}.`
          : '';

      const apkgBlob = await response.blob();
      const url = URL.createObjectURL(apkgBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cleanDeckKey}.apkg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (missingCount > 0 || auditNotes.length > 0) {
        setStatusMessage(
          `⚠️ Pacote ${cleanDeckKey}.apkg exportado (${cards.length} notes com FSRS preservado + ${resolvedCount} mídia(s) embutida(s))${
            missingCount > 0 ? `, porém ${missingCount} mídia(s) não foram resolvidas (${missingList})` : ''
          }.${auditSuffix}`
        );
      } else {
        setStatusMessage(
          `🎯 Pacote ${cleanDeckKey}.apkg exportado com sucesso! (${cards.length} notes com nid/guid FSRS determinísticos + ${resolvedCount} mídia(s) embutida(s) prontas para importar no Anki Desktop).`
        );
      }
    } catch (err: unknown) {
      setStatusMessage(
        err instanceof Error ? `Erro ao gerar .apkg: ${err.message}` : 'Erro ao exportar .apkg.'
      );
    } finally {
      setIsExportingApkg(false);
    }
  };

  // Ponte Opcional para AnkiConnect Local (http://127.0.0.1:8765)
  const handleSyncAnkiConnect = async () => {
    if (cards.length === 0) return;
    setIsSyncingAnkiConnect(true);
    const cleanDeckKey = (deckKey || 'deck')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_');
    const deckTitle = clinicalMap?.themeTitle
      ? `Internato::${clinicalMap.themeTitle}`
      : `Internato::${cleanDeckKey}`;

    const invokeAnkiConnect = async (action: string, params: Record<string, unknown> = {}) => {
      const resp = await fetch('http://127.0.0.1:8765', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, version: 6, params }),
      });
      if (!resp.ok) {
        throw new Error(`AnkiConnect HTTP ${resp.status}`);
      }
      const data = await resp.json();
      if (data.error) {
        throw new Error(String(data.error));
      }
      return data.result;
    };

    try {
      await invokeAnkiConnect('version');
      await invokeAnkiConnect('createDeck', { deck: deckTitle });

      const canonicalJson = formatCanonicalDeckJson(cards, extractedMeta, cleanDeckKey);
      const canonicalNotes: Array<{
        id: number;
        type: CardType;
        topic: string;
        question: string;
        answer: string;
        hint: string;
        tags: string[];
      }> = JSON.parse(canonicalJson);

      let updatedInPlace = 0;
      let addedNew = 0;

      for (const note of canonicalNotes) {
        const modelName =
          note.type === 'cloze' ? 'Med_Cloze_Inverted_v2' : 'Med_Basic_Inverted_v2';
        const fields =
          note.type === 'cloze'
            ? {
                Texto: note.question,
                Extra: note.hint,
                Topico: note.topic,
              }
            : {
                Frente: note.question,
                Verso: note.answer,
                Extra: note.hint,
                Topico: note.topic,
              };

        const foundIds = (await invokeAnkiConnect('findNotes', {
          query: `nid:${note.id}`,
        })) as number[];

        if (Array.isArray(foundIds) && foundIds.length > 0) {
          await invokeAnkiConnect('updateNoteFields', {
            note: {
              id: foundIds[0],
              fields,
            },
          });
          updatedInPlace++;
        } else {
          await invokeAnkiConnect('addNote', {
            note: {
              deckName: deckTitle,
              modelName,
              fields,
              tags: note.tags || [cleanDeckKey],
              options: { allowDuplicate: true },
            },
          });
          addedNew++;
        }
      }

      setStatusMessage(
        `🔌 Sincronizado com Anki Desktop via AnkiConnect! (${updatedInPlace} nota(s) atualizada(s) in-place preservando FSRS e ${addedNew} nova(s) adicionada(s) em "${deckTitle}").`
      );
    } catch {
      setStatusMessage(
        `ℹ️ AnkiConnect local (http://127.0.0.1:8765) não detectado ou bloqueado por CORS. Para usar a sincronização direta: abra o Anki Desktop com o add-on AnkiConnect (código 2055492159) e adicione "*" em "webCorsOriginList". Ou clique em "🎯 Exportar .apkg (Anki)" ao lado para importar diretamente com 100% do FSRS preservado.`
      );
    } finally {
      setIsSyncingAnkiConnect(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-slate-100">
      <TopBar
        deckKey={deckKey}
        cardCount={cards.length}
        onDownloadJson={handleDownloadJson}
        onExportApkg={handleExportApkg}
        isExportingApkg={isExportingApkg}
      />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {statusMessage && (
          <div
            role="status"
            className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border text-xs ${
              statusTone === 'error'
                ? 'bg-red-950/85 border-red-700 text-red-100'
                : statusTone === 'success'
                  ? 'bg-emerald-950/75 border-emerald-700 text-emerald-100'
                  : 'bg-slate-800/90 border-slate-700 text-slate-100'
            }`}
          >
            <span>{statusMessage}</span>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="text-slate-300 hover:text-white underline shrink-0 cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}

        <InputPanel
          pdfs={pdfs}
          onAddPdfs={handleAddPdfs}
          onRemovePdf={handleRemovePdf}
          onClearPdfs={handleClearPdfs}
          rawJsonText={rawJsonText}
          onRawJsonChange={handleRawJsonChange}
          jsonError={jsonError}
          extractedMeta={extractedMeta}
          deckKey={deckKey}
          onDeckKeyChange={setDeckKey}
          selectedProfile={selectedProfile}
          onProfileChange={(val) => {
            setSelectedProfile(val);
            if (clinicalMap) {
              const effKey = deckKey.trim() || clinicalMap.deckKey || 'tema_clinico_internato';
              const nextProf = val === 'auto' ? undefined : val;
              setClinicalMap(buildGenericClinicalMap(effKey, cards, nextProf));
            }
          }}
          useGoogleSearch={useGoogleSearch}
          onToggleGoogleSearch={setUseGoogleSearch}
          onGenerateClinicalMap={handleGenerateClinicalMap}
          onRecreateCanonicalDeck={() => handleRecreateCanonicalDeck()}
          onLoadGenericSample={handleLoadGenericSample}
          isGeneratingMap={isGeneratingMap}
          isGeneratingDeck={isGeneratingDeck}
          guidCount={Object.keys(guidRegistry.entries).length}
          onImportGuidRegistry={handleImportGuidRegistry}
          onExportGuidRegistry={handleExportGuidRegistry}
        />

        <ClinicalMapSection
          clinicalMap={clinicalMap}
          onToggleMapItem={handleToggleMapItem}
          onToggleItemCardType={handleToggleItemCardType}
          onAddCustomMapItem={handleAddCustomMapItem}
          onRecreateCanonicalDeck={() => handleRecreateCanonicalDeck()}
          isGeneratingDeck={isGeneratingDeck}
        />

        <WozniakLinterDeck
          cards={cards}
          deckKey={deckKey}
          extractedMeta={extractedMeta}
          curationStats={curationStats}
          onRemoveMissingMediaFromCard={handleRemoveMissingMediaFromCard}
          onRemoveAllMissingMedia={handleRemoveAllMissingMedia}
          onAutoResolveMissingImages={() => void autoResolveDeckMissingImages(cards)}
          isAutoResolvingImages={isAutoResolvingImages}
          onOpenQuickReview={() => setIsQuickReviewOpen(true)}
          onSyncAnkiConnect={handleSyncAnkiConnect}
          isSyncingAnkiConnect={isSyncingAnkiConnect}
          onCurateAndRebalance={handleCurateAndRebalance}
          onUpdateCard={handleUpdateCard}
          onDeleteCard={handleDeleteCard}
          onAddNewCard={handleAddNewCard}
          onAutoRepairAllFlagged={handleAutoRepairAllFlagged}
          onAutoRepairSingleCard={handleAutoRepairSingleCard}
          onLoadGenericSample={handleLoadGenericSample}
          isRepairing={isRepairing}
          onDownloadJson={handleDownloadJson}
          onDownloadOfflineBundle={handleDownloadOfflineBundle}
          onExportApkg={handleExportApkg}
          isExportingBundle={isExportingBundle}
          isExportingApkg={isExportingApkg}
        />

        <QuickReviewModal
          isOpen={isQuickReviewOpen}
          onClose={() => setIsQuickReviewOpen(false)}
          cards={cards}
          deckKey={deckKey}
          onUpdateCard={handleUpdateCard}
        />

        <DoctrineReferenceSection />
      </main>
    </div>
  );
}
