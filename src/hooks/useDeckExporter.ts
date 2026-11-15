import { useCallback, useState } from 'react';
import {
  CanonicalCard,
  CardType,
  ClinicalMapResponse,
  ExtractedDeckMetadata,
  GuidRegistryData,
} from '../types/deck';
import {
  fetchBlobWithTimeout,
  fetchJsonWithTimeout,
  sanitizeDeckKey,
} from '../utils/apiClient';
import { extractDeckMediaManifest, formatCanonicalDeckJson } from '../utils/wozniakLinter';

export function useDeckExporter(params: {
  cards: CanonicalCard[];
  deckKey: string;
  extractedMeta: ExtractedDeckMetadata;
  clinicalMap: ClinicalMapResponse | null;
  guidRegistry: GuidRegistryData;
  mergeGuidEntries: (entries: Record<string, string>) => void;
  showStatus: (message: string, tone?: 'info' | 'success' | 'error') => void;
}) {
  const {
    cards,
    deckKey,
    extractedMeta,
    clinicalMap,
    guidRegistry,
    mergeGuidEntries,
    showStatus,
  } = params;

  const [isExportingBundle, setIsExportingBundle] = useState(false);
  const [isExportingApkg, setIsExportingApkg] = useState(false);
  const [isSyncingAnkiConnect, setIsSyncingAnkiConnect] = useState(false);

  const handleDownloadJson = useCallback(() => {
    const cleanDeckKey = sanitizeDeckKey(deckKey);
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
  }, [cards, deckKey, extractedMeta]);

  const handleDownloadOfflineBundle = useCallback(async () => {
    const cleanDeckKey = sanitizeDeckKey(deckKey);
    const notesJson = formatCanonicalDeckJson(cards, extractedMeta, cleanDeckKey);
    const mediaManifest = extractDeckMediaManifest(cards, cleanDeckKey);

    setIsExportingBundle(true);
    try {
      const { blob, headers } = await fetchBlobWithTimeout('/api/media/export-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckKey: cleanDeckKey,
          notesJson,
          mediaManifest,
          mediaAssets: {},
          guidRegistry,
        }),
        timeoutMs: 90_000,
      });

      const resolvedCount = Number(headers.get('X-Resolved-Media-Count') || 0);
      const missingCount = Number(headers.get('X-Missing-Media-Count') || 0);
      const missingHeader = headers.get('X-Missing-Media') || '';
      const missingList = missingHeader ? decodeURIComponent(missingHeader) : '';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cleanDeckKey}_anki_offline_bundle.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (missingCount > 0) {
        showStatus(
          `Pacote .zip baixado (${resolvedCount}/${mediaManifest.length} mídias embutidas), porém ${missingCount} mídia(s) não puderam ser baixadas (${missingList}).`,
          'error'
        );
      } else {
        showStatus(
          `Pacote Anki Offline (${cleanDeckKey}_anki_offline_bundle.zip) baixado com ${resolvedCount}/${mediaManifest.length} mídia(s) e GUIDs FSRS.`,
          'success'
        );
      }
    } catch {
      handleDownloadJson();
      showStatus('Falha ao empacotar ZIP offline; JSON canônico baixado como fallback.', 'error');
    } finally {
      setIsExportingBundle(false);
    }
  }, [cards, deckKey, extractedMeta, guidRegistry, handleDownloadJson, showStatus]);

  const handleExportApkg = useCallback(async () => {
    if (cards.length === 0) return;
    const cleanDeckKey = sanitizeDeckKey(deckKey);
    const canonicalJson = formatCanonicalDeckJson(cards, extractedMeta, cleanDeckKey);
    const canonicalNotes = JSON.parse(canonicalJson);
    const mediaManifest = extractDeckMediaManifest(cards, cleanDeckKey);
    const deckTitle = clinicalMap?.themeTitle
      ? `Internato::${clinicalMap.themeTitle}`
      : `Internato::${cleanDeckKey}`;

    setIsExportingApkg(true);
    try {
      const { blob, headers } = await fetchBlobWithTimeout('/api/export/apkg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckName: deckTitle,
          deckKey: cleanDeckKey,
          notes: canonicalNotes,
          mediaManifest,
          mediaAssets: {},
          guidRegistry,
        }),
        timeoutMs: 90_000,
      });

      const resolvedCount = Number(headers.get('X-Resolved-Media-Count') || 0);
      const missingCount = Number(headers.get('X-Missing-Media-Count') || 0);
      const missingHeader = headers.get('X-Missing-Media') || '';
      const missingList = missingHeader ? decodeURIComponent(missingHeader) : '';
      const updatedRegHeader = headers.get('X-Updated-Guid-Registry');
      if (updatedRegHeader) {
        try {
          const parsedReg = JSON.parse(decodeURIComponent(updatedRegHeader));
          if (parsedReg && typeof parsedReg === 'object') {
            mergeGuidEntries(parsedReg);
          }
        } catch {
          // ignore malformed header
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cleanDeckKey}.apkg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (missingCount > 0) {
        showStatus(
          `Pacote ${cleanDeckKey}.apkg exportado (${cards.length} notes com FSRS + ${resolvedCount} mídia(s)), porém ${missingCount} mídia(s) não foram resolvidas (${missingList}).`,
          'error'
        );
      } else {
        showStatus(
          `Pacote ${cleanDeckKey}.apkg exportado com sucesso (${cards.length} notes com FSRS determinístico e ${resolvedCount} mídia(s)).`,
          'success'
        );
      }
    } catch (err: unknown) {
      showStatus(
        err instanceof Error ? `Erro ao gerar .apkg: ${err.message}` : 'Erro ao exportar .apkg.',
        'error'
      );
    } finally {
      setIsExportingApkg(false);
    }
  }, [cards, clinicalMap, deckKey, extractedMeta, guidRegistry, mergeGuidEntries, showStatus]);

  // Ponte Opcional para AnkiConnect Local com detecção correta dos campos (['Question', 'Topic', 'Answer', 'Hint'])
  const handleSyncAnkiConnect = useCallback(async () => {
    if (cards.length === 0) return;
    setIsSyncingAnkiConnect(true);
    const cleanDeckKey = sanitizeDeckKey(deckKey);
    const deckTitle = clinicalMap?.themeTitle
      ? `Internato::${clinicalMap.themeTitle}`
      : `Internato::${cleanDeckKey}`;

    const invokeAnkiConnect = async <R,>(
      action: string,
      reqParams: Record<string, unknown> = {}
    ): Promise<R> => {
      const data = await fetchJsonWithTimeout<{ result: R; error?: string | null }>(
        'http://127.0.0.1:8765',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, version: 6, params: reqParams }),
          timeoutMs: 5000,
        }
      );
      if (data.error) throw new Error(String(data.error));
      return data.result;
    };

    try {
      await invokeAnkiConnect('version');
      await invokeAnkiConnect('createDeck', { deck: deckTitle });

      const existingModels = await invokeAnkiConnect<string[]>('modelNames').catch(
        (): string[] => []
      );
      const ensureModel = async (modelName: string, isCloze: boolean) => {
        if (existingModels.includes(modelName)) return;
        await invokeAnkiConnect('createModel', {
          modelName,
          inOrderFields: ['Question', 'Topic', 'Answer', 'Hint'],
          isCloze,
          cardTemplates: [
            {
              Name: isCloze ? 'Cloze' : 'Basic',
              Front: isCloze
                ? '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="cloze-text">{{cloze:Question}}</div></div>'
                : '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="front-content">{{Question}}</div></div>',
              Back: isCloze
                ? '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="cloze-text">{{cloze:Question}}</div>{{#Hint}}<hr id="answer" class="med-divider"><div class="extra-box">{{Hint}}</div>{{/Hint}}</div>'
                : '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="front-content">{{Question}}</div><hr id="answer" class="med-divider"><div class="back-content"><div class="main-answer"><b>{{Answer}}</b></div>{{#Hint}}<div class="extra-box">{{Hint}}</div>{{/Hint}}</div></div>',
            },
          ],
        }).catch(() => undefined);
      };

      await ensureModel('Med_Cloze_Inverted_v2', true);
      await ensureModel('Med_Basic_Inverted_v2', false);

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
        const fields = {
          Question: note.question,
          Topic: note.topic,
          Answer: note.type === 'cloze' ? '' : note.answer,
          Hint: note.hint,
        };

        const foundIds = await invokeAnkiConnect<number[]>('findNotes', {
          query: `nid:${note.id}`,
        });

        if (Array.isArray(foundIds) && foundIds.length > 0) {
          await invokeAnkiConnect('updateNoteFields', {
            note: { id: foundIds[0], fields },
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

      showStatus(
        `Sincronizado com AnkiConnect (${updatedInPlace} atualizada(s) in-place, ${addedNew} adicionada(s) em "${deckTitle}").`,
        'success'
      );
    } catch {
      showStatus(
        'AnkiConnect local (127.0.0.1:8765) não detectado. Use "Exportar .apkg" para importar no Anki Desktop preservando FSRS.',
        'info'
      );
    } finally {
      setIsSyncingAnkiConnect(false);
    }
  }, [cards, clinicalMap, deckKey, extractedMeta, showStatus]);

  return {
    isExportingBundle,
    isExportingApkg,
    isSyncingAnkiConnect,
    handleDownloadJson,
    handleDownloadOfflineBundle,
    handleExportApkg,
    handleSyncAnkiConnect,
  };
}
