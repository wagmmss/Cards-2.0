import React, { useState } from 'react';
import { TopBar } from './components/TopBar';
import { InputPanel } from './components/InputPanel';
import { ClinicalMapSection } from './components/ClinicalMapSection';
import { WozniakLinterDeck } from './components/WozniakLinterDeck';
import { DoctrineReferenceSection } from './components/DoctrineReferenceSection';
import {
  CanonicalCard,
  CardType,
  ClinicalMapResponse,
  DeckCurationStats,
  ExtractedDeckMetadata,
  PriorityLevel,
  UploadedPdfFile,
} from './types/deck';
import {
  curateAndRebalanceDeck,
  extractDeckMediaManifest,
  extractDeckMetadata,
  formatCanonicalDeckJson,
  lintCard,
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
};

export default function App() {
  const [pdfs, setPdfs] = useState<UploadedPdfFile[]>([]);
  const [rawJsonText, setRawJsonText] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [extractedMeta, setExtractedMeta] = useState<ExtractedDeckMetadata>(EMPTY_META);
  const [deckKey, setDeckKey] = useState<string>('');
  const [useGoogleSearch, setUseGoogleSearch] = useState<boolean>(true);

  const [clinicalMap, setClinicalMap] = useState<ClinicalMapResponse | null>(null);
  const [cards, setCards] = useState<CanonicalCard[]>([]);
  const [curationStats, setCurationStats] = useState<DeckCurationStats | null>(null);

  const [isGeneratingMap, setIsGeneratingMap] = useState<boolean>(false);
  const [isGeneratingDeck, setIsGeneratingDeck] = useState<boolean>(false);
  const [isRepairing, setIsRepairing] = useState<boolean>(false);
  const [isExportingBundle, setIsExportingBundle] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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
        setStatusMessage(
          `Deck bruto carregado (${meta.rawCards.length} cards · ${rawBasicPct}% basic / ${rawClozePct}% cloze). Clique em "Passo 2: Recriar Deck JSON Canônico" ou "⚖️ Revisar, Podar & Rebalancear 50/50" para revisar, podar redundâncias e equilibrar basic/cloze.`
        );
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
      `Exemplo genérico carregado (${meta.existingIds.length} IDs FSRS extraídos). Teste a inspeção anti-spoiler da imagem abaixo ou clique em "⚖️ Revisar, Podar & Rebalancear 50/50".`
    );
  };

  const handleAddPdfs = (newFiles: UploadedPdfFile[]) => {
    setPdfs((prev) => [...prev, ...newFiles]);
  };

  const handleRemovePdf = (index: number) => {
    setPdfs((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Passo 1: Gerar Mapa Clínico (P1 a P4) + Atualizações de Diretrizes
  const handleGenerateClinicalMap = async (): Promise<ClinicalMapResponse> => {
    const effectiveKey = deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato';
    if (!deckKey.trim()) {
      setDeckKey(effectiveKey);
    }

    setIsGeneratingMap(true);
    const optimisticMap = buildGenericClinicalMap(effectiveKey, extractedMeta.rawCards);
    setClinicalMap(optimisticMap);
    setStatusMessage('Mapeando prioridades clínicas P1→P4 e consultando diretrizes...');

    try {
      const existingSummary = extractedMeta.rawCards
        .slice(0, 30)
        .map((c) => `ID ${c.id} [${c.type}]: ${c.topic} -> ${c.question.slice(0, 140)}`)
        .join('\n');

      const response = await fetch('/api/gemini/clinical-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckKey: effectiveKey,
          pdfs,
          existingJsonSummary: existingSummary,
          useGoogleSearch,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: ClinicalMapResponse = await response.json();
      if (data && Array.isArray(data.items) && data.items.length > 0) {
        setClinicalMap(data);
        setStatusMessage(
          `Mapa Clínico P1–P4 gerado para "${data.themeTitle}" (${data.items.length} conceitos).`
        );
        return data;
      }
      return optimisticMap;
    } catch {
      setStatusMessage(
        `Mapa Clínico P1–P4 estruturado para "${optimisticMap.themeTitle}". Revise os itens abaixo.`
      );
      return optimisticMap;
    } finally {
      setIsGeneratingMap(false);
    }
  };

  // Curadoria local determinística: Poda de redundâncias + Adição P1-P4 + Rebalanceamento 50% basic / 50% cloze
  const handleCurateAndRebalance = () => {
    const effectiveKey = deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato';
    const activeMap =
      clinicalMap || buildGenericClinicalMap(effectiveKey, extractedMeta.rawCards.length > 0 ? extractedMeta.rawCards : cards);
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
      `Curadoria concluída: ${stats.originalCount} cards originais → ${stats.finalCount} cards finais (${stats.prunedCount} podados, +${stats.addedCount} novos P1–P4, ${stats.convertedCount} convertidos para ${stats.basicPct}% basic / ${stats.clozePct}% cloze).`
    );
  };

  // Passo 2: Recriar Deck JSON Canônico
  const handleRecreateCanonicalDeck = async (mapOverride?: ClinicalMapResponse) => {
    const effectiveKey = deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato';
    if (!deckKey.trim()) {
      setDeckKey(effectiveKey);
    }

    const activeMap =
      mapOverride || clinicalMap || buildGenericClinicalMap(effectiveKey, extractedMeta.rawCards);
    if (!clinicalMap) {
      setClinicalMap(activeMap);
    }

    setIsGeneratingDeck(true);

    const baseCards =
      extractedMeta.rawCards.length > 0
        ? extractedMeta.rawCards
        : buildGenericCanonicalCards(effectiveKey, activeMap);

    const { cards: optimisticCurated, stats: optimisticStats } = curateAndRebalanceDeck(
      baseCards,
      extractedMeta,
      effectiveKey,
      activeMap
    );

    setCards(optimisticCurated);
    setCurationStats(optimisticStats);
    setStatusMessage(
      `Deck Canônico "${effectiveKey}" revisado e rebalanceado: ${optimisticStats.originalCount} → ${optimisticStats.finalCount} cards (${optimisticStats.prunedCount} redundantes excluídos, +${optimisticStats.addedCount} novos P1–P4, proporção ${optimisticStats.basicPct}% basic / ${optimisticStats.clozePct}% cloze).`
    );

    try {
      const response = await fetch('/api/gemini/generate-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckKey: effectiveKey,
          pdfs,
          clinicalMap: activeMap,
          existingMetadata: extractedMeta,
          useGoogleSearch,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const rawNotes: CanonicalCard[] = Array.isArray(data.notes) ? data.notes : [];
      if (rawNotes.length > 0) {
        const { cards: finalCurated, stats: finalStats } = curateAndRebalanceDeck(
          rawNotes,
          extractedMeta,
          effectiveKey,
          activeMap
        );
        setCards(finalCurated);
        setCurationStats(finalStats);
        setStatusMessage(
          `Deck Canônico "${effectiveKey}" recriado com ${finalStats.finalCount} cards (${finalStats.preservedIdsCount} IDs FSRS preservados, ${finalStats.prunedCount} excluídos, +${finalStats.addedCount} novos IDs, ${finalStats.basicPct}% basic / ${finalStats.clozePct}% cloze).`
        );
      }
    } catch {
      // Optimistic curated and rebalanced deck is already active
    } finally {
      setIsGeneratingDeck(false);
    }
  };

  // ⚡ Auto-Reparar Avisos com IA
  const handleAutoRepairAllFlagged = async () => {
    const effectiveKey = deckKey.trim() || extractedMeta.detectedDeckKey || 'tema_clinico_internato';
    const activeMap =
      clinicalMap || buildGenericClinicalMap(effectiveKey, extractedMeta.rawCards.length > 0 ? extractedMeta.rawCards : cards);

    const { cards: curatedAndRepaired, stats } = curateAndRebalanceDeck(
      cards,
      extractedMeta,
      effectiveKey,
      activeMap
    );
    setCards(curatedAndRepaired);
    setCurationStats(stats);
    setStatusMessage(
      `Deck reparado e rebalanceado (${stats.finalCount} cards · ${stats.basicPct}% basic / ${stats.clozePct}% cloze · ${stats.preservedIdsCount} IDs FSRS mantidos).`
    );

    const flaggedWithWarnings = cards
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
      // Already repaired and rebalanced deterministically
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

    setIsExportingBundle(true);
    try {
      const response = await fetch('/api/media/export-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckKey: cleanDeckKey,
          notesJson,
          mediaManifest,
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const zipBlob = await response.blob();
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cleanDeckKey}_anki_offline_bundle.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatusMessage(
        `Pacote Anki Offline (${cleanDeckKey}_anki_offline_bundle.zip) baixado com ${cleanDeckKey}_notes.json + ${mediaManifest.length} arquivo(s) em collection.media/ e 04_Mídias/${cleanDeckKey}/.`
      );
    } catch {
      handleDownloadJson();
    } finally {
      setIsExportingBundle(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-slate-100">
      <TopBar
        deckKey={deckKey}
        cardCount={cards.length}
        onDownloadJson={handleDownloadJson}
      />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {statusMessage && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-slate-800/90 border border-slate-700 text-slate-100 text-xs"
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
          rawJsonText={rawJsonText}
          onRawJsonChange={handleRawJsonChange}
          jsonError={jsonError}
          extractedMeta={extractedMeta}
          deckKey={deckKey}
          onDeckKeyChange={setDeckKey}
          useGoogleSearch={useGoogleSearch}
          onToggleGoogleSearch={setUseGoogleSearch}
          onGenerateClinicalMap={handleGenerateClinicalMap}
          onRecreateCanonicalDeck={() => handleRecreateCanonicalDeck()}
          onLoadGenericSample={handleLoadGenericSample}
          isGeneratingMap={isGeneratingMap}
          isGeneratingDeck={isGeneratingDeck}
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
          isExportingBundle={isExportingBundle}
        />

        <DoctrineReferenceSection />
      </main>
    </div>
  );
}
