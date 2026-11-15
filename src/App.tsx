import React, { useCallback, useMemo, useState } from 'react';
import { TopBar } from './components/TopBar';
import { StepFlowNav } from './components/StepFlowNav';
import { GenerationProgressBanner } from './components/GenerationProgressBanner';
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
  GeminiModelOption,
  MedicalImageResult,
  PdfExtractedImage,
  PriorityLevel,
  UploadedPdfFile,
} from './types/deck';
import {
  curateAndRebalanceDeck,
  extractDeckMetadata,
  removeMissingMediaFromCard,
  surgicalRepairCardLocal,
} from './utils/wozniakLinter';
import { sanitizeDeckKey } from './utils/apiClient';
import { collectAllMaterialImages } from './utils/materialImageMatcher';
import {
  buildGenericClinicalMap,
  GENERIC_SAMPLE_DECK_JSON,
} from './data/demoDecks';
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
  const [initialSnapshot] = useState(() => loadSavedDeckSnapshot());

  const [pdfs, setPdfs] = useState<UploadedPdfFile[]>([]);
  const [localMediaAssets, setLocalMediaAssets] = useState<Record<string, string>>({});
  const [rawJsonText, setRawJsonText] = useState<string>(
    () => initialSnapshot?.rawJsonText ?? ''
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [extractedMeta, setExtractedMeta] = useState<ExtractedDeckMetadata>(
    () => initialSnapshot?.extractedMeta ?? EMPTY_META
  );
  const [deckKey, setDeckKey] = useState<string>(
    () => initialSnapshot?.deckKey ?? ''
  );
  const [selectedProfile, setSelectedProfile] = useState<'auto' | DomainProfile>('auto');
  const [selectedModel] = useState<GeminiModelOption>('gemini-4-hydrogen');
  const [useGoogleSearch, setUseGoogleSearch] = useState<boolean>(true);

  const [clinicalMap, setClinicalMap] = useState<ClinicalMapResponse | null>(
    () => initialSnapshot?.clinicalMap ?? null
  );
  const [cards, setCards] = useState<CanonicalCard[]>(
    () => initialSnapshot?.cards ?? []
  );
  const [curationStats, setCurationStats] = useState<DeckCurationStats | null>(
    () => initialSnapshot?.curationStats ?? null
  );

  const [manualStep, setManualStep] = useState<1 | 2 | 3 | 4 | null>(null);
  const [isQuickReviewOpen, setIsQuickReviewOpen] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'info' | 'success' | 'error'>('info');

  const availableMediaNames = useMemo(
    () => Object.keys(localMediaAssets),
    [localMediaAssets]
  );

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

  const materialImages = useMemo<PdfExtractedImage[]>(
    () => collectAllMaterialImages(pdfs),
    [pdfs]
  );

  const pdfExtractedImages = useMemo<MedicalImageResult[]>(() => {
    return materialImages.map((img) => {
      const cleanCaption = (img.captionHint || img.pageTextSnippet || '').trim();
      return {
        id: `mat-${img.id}`,
        title: cleanCaption.slice(0, 70) || `${img.pdfName} (Pág. ${img.pageNumber})`,
        thumbUrl: img.dataUrl,
        fullUrl: img.dataUrl,
        description: `Extraída de ${img.pdfName} · Pág. ${img.pageNumber}${
          cleanCaption ? ` — ${cleanCaption.slice(0, 120)}` : ''
        }`,
        suggestedFilename: img.suggestedFilename,
        defaultLegend: cleanCaption
          ? `Legenda visual: ${cleanCaption.slice(0, 130)}.`
          : `Legenda visual: figura clínica extraída de ${img.pdfName}, página ${img.pageNumber}.`,
        source: img.id.startsWith('mdimg_')
          ? 'Material (Markdown)'
          : `Material PDF (Pág. ${img.pageNumber})`,
        fromMaterial: true,
        pdfName: img.pdfName,
        pageNumber: img.pageNumber,
      };
    });
  }, [materialImages]);

  const {
    isAutoResolvingImages,
    isSuggestingVisuals,
    autoResolveDeckMissingImages,
    suggestAndAttachVisualCards,
    cancelAutoResolve,
    cancelSuggestVisuals,
  } = useImageAutoResolver({
    materialImages,
    selectedModel,
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
    selectedModel,
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
    localMediaAssets,
    mergeGuidEntries,
    showStatus,
  });

  const handleRemoveMissingMediaFromCard = (cardId: number) => {
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId ? removeMissingMediaFromCard(c, availableMediaNames) : c
      )
    );
    showStatus(`Referência de mídia ausente removida do Card ID ${cardId}.`, 'info');
  };

  const handleRemoveAllMissingMedia = () => {
    setCards((prev) =>
      prev.map((c) => removeMissingMediaFromCard(c, availableMediaNames))
    );
    showStatus('Todas as referências de mídias órfãs foram limpas do baralho.', 'info');
  };

  const handleAddLocalMedia = (newAssets: Record<string, string>) => {
    const mergedAssets = { ...localMediaAssets, ...newAssets };
    setLocalMediaAssets(mergedAssets);
    const addedCount = Object.keys(newAssets).length;
    showStatus(
      `${addedCount} arquivo(s) de mídia local carregado(s) (${Object.keys(mergedAssets).length} no total) para preview e empacotamento .apkg.`,
      'success'
    );
  };

  const handleClearLocalMedia = () => {
    setLocalMediaAssets({});
    showStatus('Mídias locais removidas da sessão.', 'info');
  };

  const handleImportGuidRegistry = (jsonText: string) => {
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
        showStatus(
          `Deck carregado (${meta.rawCards.length} cards · ${rawBasicPct}% basic / ${rawClozePct}% cloze)${audioMsg}. Imagens locais sem arquivo estão sendo resolvidas automaticamente.`,
          'success'
        );
        void autoResolveDeckMissingImages(meta.rawCards, availableMediaNames);
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
    showStatus(
      `Exemplo carregado (${meta.existingIds.length} IDs FSRS). Teste a Galeria de Troca Rápida (4–6 miniaturas), a "👁️ Revisão Rápida (Anki)" ou a exportação direta para .apkg.`,
      'info'
    );
    void autoResolveDeckMissingImages(meta.rawCards, availableMediaNames);
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

  const handleCurateAndRebalance = () => {
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
      activeMap,
      { skipTemplateGapAdditions: true }
    );
    setCards(curated);
    setCurationStats(stats);
    showStatus(
      `Curadoria concluída: ${stats.originalCount} cards originais → ${stats.finalCount} cards finais (${stats.prunedCount} podados, +${stats.addedCount} novos P1–P4, ${stats.basicPct}% basic / ${stats.clozePct}% cloze).`,
      'success'
    );
    void autoResolveDeckMissingImages(curated, availableMediaNames);
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

  const hasInput = pdfs.length > 0 || rawJsonText.trim().length > 0 || deckKey.trim().length > 0;
  const hasMap = Boolean(clinicalMap && clinicalMap.items.length > 0);
  const hasCards = cards.length > 0;
  const isReadyToExport = hasCards;

  const activeStep: 1 | 2 | 3 | 4 =
    manualStep ?? (hasCards ? 3 : hasMap ? 2 : 1);

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-slate-100">
      <TopBar
        deckKey={deckKey}
        cardCount={cards.length}
        onDownloadJson={handleDownloadJson}
        onExportApkg={() => void handleExportApkg()}
        isExportingApkg={isExportingApkg}
      />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        <StepFlowNav
          hasInput={hasInput}
          hasMap={hasMap}
          hasCards={hasCards}
          isReadyToExport={isReadyToExport}
          activeStep={activeStep}
          onSelectStep={(step) => setManualStep(step)}
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
          localMediaAssets={localMediaAssets}
          onAddLocalMedia={handleAddLocalMedia}
          onClearLocalMedia={handleClearLocalMedia}
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
          onGenerateClinicalMap={() => void handleGenerateClinicalMap()}
          onRecreateCanonicalDeck={() => void handleRecreateCanonicalDeck()}
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
          onDeepenGuidelines={(focusQuery) => void handleDeepenGuidelines(focusQuery)}
          isDeepeningGuidelines={isDeepeningGuidelines}
          onRecreateCanonicalDeck={() => void handleRecreateCanonicalDeck()}
          isGeneratingDeck={isGeneratingDeck}
        />

        <WozniakLinterDeck
          cards={cards}
          deckKey={deckKey}
          extractedMeta={extractedMeta}
          curationStats={curationStats}
          localMediaAssets={localMediaAssets}
          availableMediaNames={availableMediaNames}
          onRemoveMissingMediaFromCard={handleRemoveMissingMediaFromCard}
          onRemoveAllMissingMedia={handleRemoveAllMissingMedia}
          onAutoResolveMissingImages={() =>
            void autoResolveDeckMissingImages(cards, availableMediaNames)
          }
          onCancelAutoResolve={cancelAutoResolve}
          isAutoResolvingImages={isAutoResolvingImages}
          pdfExtractedImages={pdfExtractedImages}
          onSuggestVisualCards={() =>
            void suggestAndAttachVisualCards(
              cards,
              deckKey || extractedMeta.detectedDeckKey || 'internato_deck'
            )
          }
          onCancelSuggestVisuals={cancelSuggestVisuals}
          isSuggestingVisuals={isSuggestingVisuals}
          onOpenQuickReview={() => setIsQuickReviewOpen(true)}
          onSyncAnkiConnect={() => void handleSyncAnkiConnect()}
          isSyncingAnkiConnect={isSyncingAnkiConnect}
          onCurateAndRebalance={handleCurateAndRebalance}
          onUpdateCard={handleUpdateCard}
          onDeleteCard={handleDeleteCard}
          onAddNewCard={handleAddNewCard}
          onAutoRepairAllFlagged={() => void handleAutoRepairAllFlagged()}
          onAutoRepairSingleCard={handleAutoRepairSingleCard}
          onLoadGenericSample={handleLoadGenericSample}
          isRepairing={isRepairing}
          onDownloadJson={handleDownloadJson}
          onDownloadOfflineBundle={() => void handleDownloadOfflineBundle()}
          onExportApkg={() => void handleExportApkg()}
          isExportingBundle={isExportingBundle}
          isExportingApkg={isExportingApkg}
        />

        <QuickReviewModal
          isOpen={isQuickReviewOpen}
          onClose={() => setIsQuickReviewOpen(false)}
          cards={cards}
          deckKey={deckKey}
          localMediaAssets={localMediaAssets}
          onUpdateCard={handleUpdateCard}
        />

        <DoctrineReferenceSection />
      </main>
    </div>
  );
}
