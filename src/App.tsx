import React, { useCallback, useMemo, useState } from 'react';
import { TopBar } from './components/TopBar';
import { StepFlowNav } from './components/StepFlowNav';
import { GenerationProgressBanner } from './components/GenerationProgressBanner';
import { InputPanel } from './components/InputPanel';
import { ClinicalMapSection } from './components/ClinicalMapSection';
import { WozniakLinterDeck } from './components/WozniakLinterDeck';
import { ExportSection } from './components/deck/ExportSection';
import { QuickReviewModal } from './components/QuickReviewModal';
import { DoctrineReferenceSection } from './components/DoctrineReferenceSection';
import {
  CanonicalCard,
  CardType,
  ClinicalMapResponse,
  DeckCurationStats,
  DomainProfile,
  ExtractedDeckMetadata,
  PriorityLevel,
  UploadedPdfFile,
} from './types/deck';
import {
  curateAndRebalanceDeck,
  extractDeckMediaManifest,
  extractDeckMetadata,
  lintCard,
  removeMissingMediaFromCard,
  surgicalRepairCardLocal,
} from './utils/wozniakLinter';
import { sanitizeDeckKey } from './utils/apiClient';
import { collectAllMaterialImages } from './utils/materialImageMatcher';
import { buildGenericClinicalMap, GENERIC_SAMPLE_DECK_JSON } from './data/demoDecks';
import {
  loadSavedDeckSnapshot,
  useDeckPersistence,
} from './hooks/useDeckPersistence';
import { useImageAutoResolver } from './hooks/useImageAutoResolver';
import { useBatchDeckGenerator } from './hooks/useBatchDeckGenerator';
import { useDeckExporter } from './hooks/useDeckExporter';

const EMPTY_META: ExtractedDeckMetadata = {
  existingIds: [],
  mediaTags: [],
  detectedDeckKey: '',
  rawCards: [],
  removedOrphanAudioCount: 0,
};

export default function App() {
  const initialSaved = useMemo(() => loadSavedDeckSnapshot(), []);

  const [pdfs, setPdfs] = useState<UploadedPdfFile[]>([]);
  const [rawJsonText, setRawJsonText] = useState<string>(
    () => initialSaved?.rawJsonText || ''
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [extractedMeta, setExtractedMeta] = useState<ExtractedDeckMetadata>(
    () => initialSaved?.extractedMeta || EMPTY_META
  );
  const [deckKey, setDeckKey] = useState<string>(() => initialSaved?.deckKey || '');
  const [selectedProfile, setSelectedProfile] = useState<'auto' | DomainProfile>('auto');
  const [useGoogleSearch, setUseGoogleSearch] = useState<boolean>(true);

  const [clinicalMap, setClinicalMap] = useState<ClinicalMapResponse | null>(
    () => initialSaved?.clinicalMap || null
  );
  const [cards, setCards] = useState<CanonicalCard[]>(() => initialSaved?.cards || []);
  const [curationStats, setCurationStats] = useState<DeckCurationStats | null>(
    () => initialSaved?.curationStats || null
  );

  const [selectedStep, setSelectedStep] = useState<1 | 2 | 3 | 4 | null>(null);
  const [isQuickReviewOpen, setIsQuickReviewOpen] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'info' | 'success' | 'error'>('info');

  const showStatus = useCallback(
    (message: string, tone: 'info' | 'success' | 'error' = 'info') => {
      setStatusTone(tone);
      setStatusMessage(message);
    },
    []
  );

  const {
    guidRegistry,
    mergeGuidEntries,
    importGuidRegistryJson,
    exportGuidRegistryFile,
  } = useDeckPersistence({
    deckKey,
    rawJsonText,
    extractedMeta,
    clinicalMap,
    cards,
    curationStats,
  });

  const materialImages = useMemo(() => collectAllMaterialImages(pdfs), [pdfs]);

  const {
    isAutoResolvingImages,
    isSuggestingVisuals,
    autoResolveDeckMissingImages,
    suggestAndAttachVisualCards,
    cancelAutoResolve,
    cancelSuggestVisuals,
  } = useImageAutoResolver({
    materialImages,
    setCards,
    showStatus,
  });

  const {
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
  } = useBatchDeckGenerator({
    pdfs,
    setPdfs,
    deckKey,
    setDeckKey,
    selectedProfile,
    useGoogleSearch,
    extractedMeta,
    clinicalMap,
    setClinicalMap,
    cards,
    setCards,
    setCurationStats,
    autoResolveDeckMissingImages,
    showStatus,
  });

  const {
    isExportingBundle,
    isExportingApkg,
    isSyncingAnkiConnect,
    handleDownloadJson,
    handleDownloadOfflineBundle,
    handleExportApkg,
    handleSyncAnkiConnect,
  } = useDeckExporter({
    cards,
    deckKey,
    extractedMeta,
    clinicalMap,
    guidRegistry,
    mergeGuidEntries,
    showStatus,
  });

  const hasInput = Boolean(deckKey.trim() || pdfs.length > 0 || rawJsonText.trim());
  const hasMap = Boolean(clinicalMap && clinicalMap.items.length > 0);
  const hasCards = cards.length > 0;

  const { mediaCount, missingMediaCount } = useMemo(() => {
    const cleanKey = sanitizeDeckKey(deckKey || 'internato_deck');
    const manifest = extractDeckMediaManifest(cards, cleanKey);
    let missing = 0;
    for (const card of cards) {
      if (lintCard(card).metrics.missingMediaFiles.length > 0) {
        missing++;
      }
    }
    return { mediaCount: manifest.length, missingMediaCount: missing };
  }, [cards, deckKey]);

  const isReadyToExport = hasCards && missingMediaCount === 0;

  const computedActiveStep: 1 | 2 | 3 | 4 = useMemo(() => {
    if (selectedStep) return selectedStep;
    if (hasCards) return 3;
    if (hasMap) return 2;
    return 1;
  }, [selectedStep, hasCards, hasMap]);

  const handleImportGuidRegistry = useCallback(
    (jsonText: string) => {
      try {
        const count = importGuidRegistryJson(jsonText);
        showStatus(
          `Registro note_guid_registry.json importado (${count} GUIDs FSRS ativos).`,
          'success'
        );
      } catch (err: unknown) {
        showStatus(
          err instanceof Error ? err.message : 'Erro ao importar note_guid_registry.json.',
          'error'
        );
      }
    },
    [importGuidRegistryJson, showStatus]
  );

  const handleRawJsonChange = useCallback(
    (text: string) => {
      cancelAutoResolve();
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
        const effectiveKey = sanitizeDeckKey(
          meta.detectedDeckKey || deckKey.trim() || 'tema_clinico_internato'
        );
        if (meta.detectedDeckKey && !deckKey.trim()) {
          setDeckKey(meta.detectedDeckKey);
        }
        if (meta.rawCards.length > 0) {
          setCards(meta.rawCards);
          const profileOverride =
            selectedProfile === 'auto' ? undefined : selectedProfile;
          setClinicalMap(buildGenericClinicalMap(effectiveKey, meta.rawCards, profileOverride));
          setSelectedStep(3);
          const rawBasic = meta.rawCards.filter((c) => c.type === 'basic').length;
          const rawBasicPct = Math.round((rawBasic / meta.rawCards.length) * 100);
          const rawClozePct = 100 - rawBasicPct;
          const audioMsg =
            meta.removedOrphanAudioCount && meta.removedOrphanAudioCount > 0
              ? ` (${meta.removedOrphanAudioCount} tag(s) de áudio órfãs removidas)`
              : '';
          showStatus(
            `Deck carregado (${meta.rawCards.length} cards · ${rawBasicPct}% basic / ${rawClozePct}% cloze)${audioMsg}. Imagens ausentes serão buscadas automaticamente.`,
            'info'
          );
          void autoResolveDeckMissingImages(meta.rawCards);
        }
      } catch (err: unknown) {
        setJsonError(err instanceof Error ? err.message : 'Erro ao analisar JSON.');
      }
    },
    [autoResolveDeckMissingImages, cancelAutoResolve, deckKey, selectedProfile, showStatus]
  );

  const handleLoadGenericSample = useCallback(() => {
    cancelAutoResolve();
    const meta = extractDeckMetadata(GENERIC_SAMPLE_DECK_JSON);
    const key = meta.detectedDeckKey || 'manejo_clinico_emergencia';
    setRawJsonText(GENERIC_SAMPLE_DECK_JSON);
    setJsonError(null);
    setExtractedMeta(meta);
    setDeckKey(key);
    setCurationStats(null);
    setClinicalMap(buildGenericClinicalMap(key, meta.rawCards));
    setCards(meta.rawCards);
    setSelectedStep(3);
    showStatus(
      `Exemplo clínico carregado (${meta.existingIds.length} IDs FSRS). Teste a Revisão Rápida, a Galeria de Mídias ou a exportação direta para .apkg.`,
      'success'
    );
    void autoResolveDeckMissingImages(meta.rawCards);
  }, [autoResolveDeckMissingImages, cancelAutoResolve, showStatus]);

  const handleAddPdfs = useCallback(
    (newFiles: UploadedPdfFile[]) => {
      if (newFiles.length === 0) return;
      let skippedCount = 0;
      let addedCount = 0;

      setPdfs((prev) => {
        const seen = new Set(prev.map((f) => `${f.name.toLowerCase()}::${f.size}`));
        const uniqueToAdd: UploadedPdfFile[] = [];
        for (const file of newFiles) {
          const sig = `${file.name.toLowerCase()}::${file.size}`;
          if (seen.has(sig)) {
            skippedCount++;
            continue;
          }
          seen.add(sig);
          uniqueToAdd.push(file);
        }
        addedCount = uniqueToAdd.length;
        return uniqueToAdd.length > 0 ? [...prev, ...uniqueToAdd] : prev;
      });

      if (skippedCount > 0 && addedCount === 0) {
        showStatus(
          `${skippedCount} arquivo(s) duplicado(s) ignorado(s) (já anexado(s)).`,
          'info'
        );
      } else if (skippedCount > 0) {
        showStatus(
          `${addedCount} arquivo(s) adicionado(s) (${skippedCount} duplicado(s) filtrado(s)).`,
          'info'
        );
      }
    },
    [showStatus]
  );

  const handleRemovePdf = useCallback((index: number) => {
    setPdfs((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  const handleClearPdfs = useCallback(() => {
    setPdfs([]);
  }, []);

  const handleCurateAndRebalance = useCallback(() => {
    const effectiveKey = sanitizeDeckKey(
      deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato'
    );
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
    showStatus(
      `Curadoria concluída: ${stats.originalCount} → ${stats.finalCount} cards (${stats.prunedCount} podados, +${stats.addedCount} novos P1–P4, ${stats.basicPct}% basic / ${stats.clozePct}% cloze).`,
      'success'
    );
    void autoResolveDeckMissingImages(curated);
  }, [
    autoResolveDeckMissingImages,
    cards,
    clinicalMap,
    deckKey,
    extractedMeta,
    selectedProfile,
    showStatus,
  ]);

  const handleRemoveMissingMediaFromCard = useCallback(
    (cardId: number) => {
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? removeMissingMediaFromCard(c) : c))
      );
      showStatus(`Referência de mídia ausente removida do Card ID ${cardId}.`, 'info');
    },
    [showStatus]
  );

  const handleRemoveAllMissingMedia = useCallback(() => {
    setCards((prev) => prev.map((c) => removeMissingMediaFromCard(c)));
    showStatus('Todas as referências de mídias órfãs foram limpas do baralho.', 'info');
  }, [showStatus]);

  const handleAutoRepairSingleCard = useCallback((cardId: number) => {
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? surgicalRepairCardLocal(c) : c))
    );
  }, []);

  const handleUpdateCard = useCallback((updated: CanonicalCard) => {
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }, []);

  const handleDeleteCard = useCallback((id: number) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const handleAddNewCard = useCallback(() => {
    const maxId =
      cards.length > 0 ? Math.max(...cards.map((c) => c.id)) : 171000100;
    const effectiveKey = sanitizeDeckKey(deckKey.trim() || 'tema_clinico');
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
    setSelectedStep(3);
  }, [cards, deckKey]);

  const handleToggleMapItem = useCallback((id: string) => {
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
  }, []);

  const handleToggleItemCardType = useCallback((id: string) => {
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
  }, []);

  const handleAddCustomMapItem = useCallback(
    (
      priority: PriorityLevel,
      subtopic: string,
      concept: string,
      targetCardType: CardType
    ) => {
      setClinicalMap((prev) => {
        const base =
          prev || buildGenericClinicalMap(sanitizeDeckKey(deckKey || 'tema_clinico'));
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
    },
    [deckKey]
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-slate-100">
      <TopBar
        deckKey={deckKey}
        cardCount={cards.length}
        onDownloadJson={handleDownloadJson}
        onExportApkg={() => void handleExportApkg()}
        isExportingApkg={isExportingApkg}
      />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        <StepFlowNav
          hasInput={hasInput}
          hasMap={hasMap}
          hasCards={hasCards}
          isReadyToExport={isReadyToExport}
          activeStep={computedActiveStep}
          onSelectStep={(step) => setSelectedStep(step)}
        />

        <GenerationProgressBanner progress={progress} onCancel={cancelGeneration} />

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
              const effKey = sanitizeDeckKey(
                deckKey.trim() || clinicalMap.deckKey || 'tema_clinico_internato'
              );
              const nextProf = val === 'auto' ? undefined : val;
              setClinicalMap(buildGenericClinicalMap(effKey, cards, nextProf));
            }
          }}
          useGoogleSearch={useGoogleSearch}
          onToggleGoogleSearch={setUseGoogleSearch}
          onGenerateClinicalMap={() => {
            setSelectedStep(2);
            void handleGenerateClinicalMap();
          }}
          onRecreateCanonicalDeck={() => {
            setSelectedStep(3);
            void handleRecreateCanonicalDeck();
          }}
          onCancelGeneration={cancelGeneration}
          onLoadGenericSample={handleLoadGenericSample}
          isGeneratingMap={isGeneratingMap}
          isGeneratingDeck={isGeneratingDeck}
          guidCount={Object.keys(guidRegistry.entries).length}
          onImportGuidRegistry={handleImportGuidRegistry}
          onExportGuidRegistry={exportGuidRegistryFile}
        />

        <ClinicalMapSection
          clinicalMap={clinicalMap}
          onToggleMapItem={handleToggleMapItem}
          onToggleItemCardType={handleToggleItemCardType}
          onAddCustomMapItem={handleAddCustomMapItem}
          onDeepenGuidelines={(q) => void handleDeepenGuidelines(q)}
          isDeepeningGuidelines={isDeepeningGuidelines}
          onRecreateCanonicalDeck={() => {
            setSelectedStep(3);
            void handleRecreateCanonicalDeck();
          }}
          onCancelGeneration={cancelGeneration}
          isGeneratingDeck={isGeneratingDeck}
        />

        <WozniakLinterDeck
          cards={cards}
          deckKey={deckKey}
          extractedMeta={extractedMeta}
          curationStats={curationStats}
          materialImages={materialImages}
          onRemoveMissingMediaFromCard={handleRemoveMissingMediaFromCard}
          onRemoveAllMissingMedia={handleRemoveAllMissingMedia}
          onAutoResolveMissingImages={() => void autoResolveDeckMissingImages(cards)}
          onSuggestVisualCards={() => void suggestAndAttachVisualCards(cards, deckKey)}
          onCancelVisualActions={() => {
            cancelAutoResolve();
            cancelSuggestVisuals();
            showStatus('Busca/sugestão visual cancelada.', 'info');
          }}
          isAutoResolvingImages={isAutoResolvingImages}
          isSuggestingVisuals={isSuggestingVisuals}
          onOpenQuickReview={() => setIsQuickReviewOpen(true)}
          onCurateAndRebalance={handleCurateAndRebalance}
          onUpdateCard={handleUpdateCard}
          onDeleteCard={handleDeleteCard}
          onAddNewCard={handleAddNewCard}
          onAutoRepairAllFlagged={() => void handleAutoRepairAllFlagged()}
          onAutoRepairSingleCard={handleAutoRepairSingleCard}
          onLoadGenericSample={handleLoadGenericSample}
          isRepairing={isRepairing}
        />

        <ExportSection
          deckKey={deckKey}
          cardCount={cards.length}
          mediaCount={mediaCount}
          missingMediaCount={missingMediaCount}
          isExportingApkg={isExportingApkg}
          isExportingBundle={isExportingBundle}
          isSyncingAnkiConnect={isSyncingAnkiConnect}
          onExportApkg={() => void handleExportApkg()}
          onDownloadOfflineBundle={() => void handleDownloadOfflineBundle()}
          onDownloadJson={handleDownloadJson}
          onSyncAnkiConnect={() => void handleSyncAnkiConnect()}
        />

        <DoctrineReferenceSection />
      </main>

      <QuickReviewModal
        isOpen={isQuickReviewOpen}
        onClose={() => setIsQuickReviewOpen(false)}
        cards={cards}
        deckKey={deckKey}
        materialImages={materialImages}
        onUpdateCard={handleUpdateCard}
      />
    </div>
  );
}
