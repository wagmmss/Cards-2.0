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
import {
  computeDeterministicDeckId,
  extractDeckMediaManifest,
  formatCanonicalDeckJson,
  lintDeck,
  resolveOrCreateNoteGuid,
} from '../utils/wozniakLinter';
import type {
  ExportFormatType,
  PendingExportConfirmation,
} from '../components/ExportConfirmationModal';
import {
  AnkiConnectCanonicalNote,
  syncDeckToAnkiConnect,
  uint8ArrayToBase64,
} from '../utils/ankiConnectHelpers';

const ANKI_CONNECT_CLINICAL_CSS = `.card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 18.5px; line-height: 1.58; text-align: left;
  color: #1e293b; background-color: #f8fafc; padding: 24px;
}
.med-card { max-width: 740px; margin: 0 auto; }
.topic-box {
  display: inline-block; background-color: #f1f5f9; color: #0369a1;
  padding: 4px 10px; border-radius: 4px; font-size: 13.5px;
  font-weight: 700; margin-bottom: 12px; border: 1px solid #cbd5e1;
  text-transform: uppercase; letter-spacing: 0.5px;
}
b, strong { color: #0284c7; font-weight: 700; }
i, em { font-style: italic; color: #334155; }
.cloze { font-weight: 700; color: #0284c7; border-bottom: 2px solid #38bdf8; padding: 0 2px; }
.front-content, .cloze-text { font-size: 19.5px; color: #0f172a; line-height: 1.58; }
.back-content { font-size: 18.5px; color: #0f172a; line-height: 1.58; margin-top: 10px; }
.main-answer { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
.extra-box {
  margin-top: 16px; padding: 14px 18px; background: #f1f5f9;
  border-radius: 8px; border-left: 4px solid #0284c7;
  font-size: 16px; color: #334155; line-height: 1.52;
}
hr, hr#answer, hr.med-divider { border: 0; height: 1px; background: #cbd5e1; margin: 20px 0; }
img {
  max-width: 100%; max-height: 62vh; height: auto; border-radius: 8px;
  border: 1px solid #cbd5e1; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.10);
  margin: 14px auto 6px; background: #ffffff; padding: 4px; display: block; object-fit: contain;
}
img:first-child { margin-top: 0; }
audio.med-audio { width: 100%; height: 36px; margin: 8px 0; display: block; }
img + br + i, img + i, .extra-box > i:first-child {
  display: block; margin: 4px auto 12px; max-width: 94%; font-size: 13.5px;
  line-height: 1.45; color: #475569; text-align: center; font-style: italic;
}
table.med-table {
  width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 14.5px;
  line-height: 1.45; background-color: #ffffff; color: #0f172a; border: 1px solid #cbd5e1;
}
table.med-table th, table.med-table td {
  border: 1px solid #cbd5e1; padding: 9px 12px; text-align: left; vertical-align: top; overflow-wrap: anywhere;
}
table.med-table th { background-color: #e0f2fe; color: #0c4a6e; font-weight: 700; }
table.med-table tbody tr:nth-child(even) td { background-color: #f8fafc; }
.nightMode.card, .night_mode.card, body.nightMode, body.night_mode { background-color: #18181b !important; color: #f4f4f5 !important; }
.nightMode .topic-box, .night_mode .topic-box { background-color: #27272a !important; color: #7dd3fc !important; border-color: #3f3f46 !important; }
.nightMode .front-content, .nightMode .back-content, .night_mode .front-content, .night_mode .back-content, .nightMode .cloze-text, .night_mode .cloze-text { color: #f4f4f5 !important; }
.nightMode .main-answer, .night_mode .main-answer { color: #f4f4f5 !important; }
.nightMode b, .nightMode strong, .night_mode b, .night_mode strong { color: #38bdf8 !important; }
.nightMode i, .nightMode em, .night_mode i, .night_mode em { color: #cbd5e1 !important; }
.nightMode .cloze, .night_mode .cloze { color: #38bdf8 !important; border-bottom: 2px solid #0ea5e9 !important; }
.nightMode .extra-box, .night_mode .extra-box { background: #27272a !important; border-left: 4px solid #38bdf8 !important; color: #e4e4e7 !important; }
.nightMode hr, .night_mode hr, .nightMode hr#answer, .night_mode hr#answer, .nightMode hr.med-divider, .night_mode hr.med-divider { background: #3f3f46 !important; }
.nightMode img, .night_mode img { background: #ffffff !important; border: 1px solid #3f3f46 !important; }
.nightMode img + br + i, .night_mode img + br + i, .nightMode img + i, .night_mode img + i, .nightMode .extra-box > i:first-child, .night_mode .extra-box > i:first-child { color: #cbd5e1 !important; }
.nightMode table.med-table, .night_mode table.med-table { background-color: #18181b !important; color: #f4f4f5 !important; border-color: #475569 !important; }
.nightMode table.med-table th, .night_mode table.med-table th { background-color: #0c4a6e !important; color: #e0f2fe !important; border-color: #475569 !important; }
.nightMode table.med-table td, .night_mode table.med-table td { background-color: #1f2430 !important; border-color: #475569 !important; color: #f4f4f5 !important; }
.nightMode table.med-table tbody tr:nth-child(even) td, .night_mode table.med-table tbody tr:nth-child(even) td { background-color: #27272a !important; }
@media (max-width: 600px) {
  .card { padding: 14px; font-size: 16.5px; }
  .med-card { max-width: 100%; }
  .front-content, .cloze-text { font-size: 17.5px; }
  .back-content { font-size: 16.5px; }
  .main-answer { font-size: 18px; }
  .extra-box { padding: 10px 14px; font-size: 15px; }
  img { max-height: 55vh; margin-top: 10px; }
  img:first-child { margin-top: 0; }
  table.med-table { font-size: 13.5px; display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table.med-table th, table.med-table td { padding: 7px 9px; }
}`;

function extractSanitizedGuidEntries(guidRegistry: GuidRegistryData): Record<string, string> {
  const raw =
    guidRegistry?.entries && typeof guidRegistry.entries === 'object'
      ? guidRegistry.entries
      : {};
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k === 'string' && typeof v === 'string' && v.trim()) {
      clean[k] = v.trim();
    }
  }
  return clean;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useDeckExporter(params: {
  cards: CanonicalCard[];
  deckKey: string;
  extractedMeta: ExtractedDeckMetadata;
  clinicalMap: ClinicalMapResponse | null;
  guidRegistry: GuidRegistryData;
  localMediaAssets?: Record<string, string>;
  mergeGuidEntries: (entries: Record<string, string>) => void;
  showStatus: (message: string, tone?: 'info' | 'success' | 'error') => void;
}) {
  const {
    cards,
    deckKey,
    extractedMeta,
    clinicalMap,
    guidRegistry,
    localMediaAssets = {},
    mergeGuidEntries,
    showStatus,
  } = params;

  const [isExportingBundle, setIsExportingBundle] = useState(false);
  const [isExportingApkg, setIsExportingApkg] = useState(false);
  const [isSyncingAnkiConnect, setIsSyncingAnkiConnect] = useState(false);
  const [pendingExportConfirm, setPendingExportConfirm] =
    useState<PendingExportConfirmation | null>(null);

  const checkExportAuditOrPrompt = useCallback(
    (
      cleanDeckKey: string,
      format: ExportFormatType,
      exportLabel: string,
      bypassAudit?: boolean
    ): boolean => {
      if (bypassAudit) return true;
      const deckAudit = lintDeck(cards, Object.keys(localMediaAssets), cleanDeckKey);
      if (deckAudit.canExport) return true;
      setPendingExportConfirm({
        format,
        label: exportLabel,
        deckAudit,
      });
      return false;
    },
    [cards, localMediaAssets]
  );

  const handleDownloadJson = useCallback(
    (bypassAudit = false) => {
      if (cards.length === 0) return;
      const cleanDeckKey = sanitizeDeckKey(deckKey);
      if (!checkExportAuditOrPrompt(cleanDeckKey, 'json', 'JSON', bypassAudit)) return;
      const jsonString = formatCanonicalDeckJson(cards, extractedMeta, cleanDeckKey);
      const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
      triggerBlobDownload(blob, `${cleanDeckKey}_notes.json`);
    },
    [cards, checkExportAuditOrPrompt, deckKey, extractedMeta]
  );

  const handleDownloadOfflineBundle = useCallback(
    async (bypassAudit = false) => {
      if (cards.length === 0) return;
      const cleanDeckKey = sanitizeDeckKey(deckKey);
      if (!checkExportAuditOrPrompt(cleanDeckKey, 'zip', 'ZIP Offline', bypassAudit)) return;
      const notesJson = formatCanonicalDeckJson(cards, extractedMeta, cleanDeckKey);
      const mediaManifest = extractDeckMediaManifest(cards, cleanDeckKey);
      const flatGuidEntries = extractSanitizedGuidEntries(guidRegistry);

      setIsExportingBundle(true);
      try {
        const { blob, headers } = await fetchBlobWithTimeout('/api/media/export-bundle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deckKey: cleanDeckKey,
            notesJson,
            mediaManifest,
            mediaAssets: localMediaAssets,
            guidRegistry: flatGuidEntries,
          }),
          timeoutMs: 90_000,
        });

        const resolvedCount = Number(headers.get('X-Resolved-Media-Count') || 0);
        const missingCount = Number(headers.get('X-Missing-Media-Count') || 0);
        const missingHeader = headers.get('X-Missing-Media') || '';
        const missingList = missingHeader ? decodeURIComponent(missingHeader) : '';

        triggerBlobDownload(blob, `${cleanDeckKey}_anki_offline_bundle.zip`);

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
        handleDownloadJson(true);
        showStatus('Falha ao empacotar ZIP offline; JSON canônico baixado como fallback.', 'error');
      } finally {
        setIsExportingBundle(false);
      }
    },
    [cards, checkExportAuditOrPrompt, deckKey, extractedMeta, guidRegistry, handleDownloadJson, localMediaAssets, showStatus]
  );

  const handleExportApkg = useCallback(
    async (bypassAudit = false) => {
      if (cards.length === 0) return;
      const cleanDeckKey = sanitizeDeckKey(deckKey);
      if (!checkExportAuditOrPrompt(cleanDeckKey, 'apkg', '.apkg', bypassAudit)) return;
    const deterministicDeckId = computeDeterministicDeckId(cleanDeckKey);
    const canonicalJson = formatCanonicalDeckJson(cards, extractedMeta, cleanDeckKey);
    const canonicalNotes: Array<{ id: number }> = JSON.parse(canonicalJson);
    const mediaManifest = extractDeckMediaManifest(cards, cleanDeckKey);
    const deckTitle = clinicalMap?.themeTitle
      ? `Internato::${clinicalMap.themeTitle}`
      : `Internato::${cleanDeckKey}`;

    const deckAudit = lintDeck(cards, Object.keys(localMediaAssets), cleanDeckKey);
    const auditNotes: string[] = [];
    if (deckAudit.duplicateImages.length > 0) {
      auditNotes.push(`${deckAudit.duplicateImages.length} imagem(ns) repetida(s)`);
    }
    const missingLegendErrs = deckAudit.errors.filter((e) => e.code === 'IMAGE_MISSING_LEGEND').length;
    if (missingLegendErrs > 0) {
      auditNotes.push(`${missingLegendErrs} legenda(s) <i> curta(s)/ausente(s)`);
    }
    const modalityErrs = deckAudit.errors.filter((e) => e.code === 'MODALITY_CONFLICT').length;
    if (modalityErrs > 0) {
      auditNotes.push(`${modalityErrs} conflito(s) de modalidade`);
    }
    const auditSuffix = auditNotes.length > 0 ? ` | Auditoria visual: ${auditNotes.join(', ')}.` : '';

    // Ensure every exported note has a deterministic persisted GUID before packaging
    const flatGuidEntries = extractSanitizedGuidEntries(guidRegistry);
    const newlyEnsuredEntries: Record<string, string> = {};
    for (const note of canonicalNotes) {
      const regKey = `${cleanDeckKey}:id:${note.id}`;
      if (!flatGuidEntries[regKey]) {
        const { guid } = resolveOrCreateNoteGuid(
          cleanDeckKey,
          deterministicDeckId,
          note.id,
          flatGuidEntries
        );
        newlyEnsuredEntries[regKey] = guid;
      }
    }

    setIsExportingApkg(true);
    try {
      const { blob, headers } = await fetchBlobWithTimeout('/api/export/apkg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckName: deckTitle,
          deckKey: cleanDeckKey,
          deckId: deterministicDeckId,
          notes: canonicalNotes,
          mediaManifest,
          mediaAssets: localMediaAssets,
          guidRegistry: flatGuidEntries,
        }),
        timeoutMs: 90_000,
      });

      const resolvedCount = Number(headers.get('X-Resolved-Media-Count') || 0);
      const missingCount = Number(headers.get('X-Missing-Media-Count') || 0);
      const missingHeader = headers.get('X-Missing-Media') || '';
      const missingList = missingHeader ? decodeURIComponent(missingHeader) : '';
      const updatedRegHeader = headers.get('X-Updated-Guid-Registry');
      const entriesToPersist: Record<string, string> = { ...newlyEnsuredEntries };

      if (updatedRegHeader) {
        try {
          const parsedReg = JSON.parse(decodeURIComponent(updatedRegHeader)) as Record<
            string,
            unknown
          >;
          if (parsedReg && typeof parsedReg === 'object') {
            for (const [k, v] of Object.entries(parsedReg)) {
              if (typeof v === 'string' && v.trim()) {
                entriesToPersist[k] = v.trim();
              }
            }
          }
        } catch {
          // ignore malformed header
        }
      }

      if (Object.keys(entriesToPersist).length > 0) {
        mergeGuidEntries(entriesToPersist);
      }

      triggerBlobDownload(blob, `${cleanDeckKey}.apkg`);

      if (missingCount > 0 || auditNotes.length > 0) {
        showStatus(
          `Pacote ${cleanDeckKey}.apkg exportado (${cards.length} notes com FSRS + ${resolvedCount}/${mediaManifest.length} mídia(s))${
            missingCount > 0 ? `, porém ${missingCount} mídia(s) não foram baixadas (${missingList})` : ''
          }.${auditSuffix}`,
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
  }, [cards, checkExportAuditOrPrompt, clinicalMap, deckKey, extractedMeta, guidRegistry, localMediaAssets, mergeGuidEntries, showStatus]);

  // Ponte Opcional para AnkiConnect Local com tags FSRS escopadas por deck, conversão <audio>→[sound:...], mídias /api/media/local-file + SVG base64 e relato real de falhas
  const handleSyncAnkiConnect = useCallback(async (bypassAudit = false) => {
    if (cards.length === 0) return;
    const cleanDeckKey = sanitizeDeckKey(deckKey);
    if (!checkExportAuditOrPrompt(cleanDeckKey, 'anki_connect', 'AnkiConnect', bypassAudit)) return;
    setIsSyncingAnkiConnect(true);
    const deckTitle = clinicalMap?.themeTitle
      ? `Internato::${clinicalMap.themeTitle}`
      : `Internato::${cleanDeckKey}`;

    const invokeAnkiConnect = async <R = unknown>(
      action: string,
      reqParams: Record<string, unknown> = {}
    ): Promise<R> => {
      const data = await fetchJsonWithTimeout<{ result: R; error?: string | null }>(
        'http://127.0.0.1:8765',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, version: 6, params: reqParams }),
          timeoutMs: 12_000,
        }
      );
      if (data.error) throw new Error(String(data.error));
      return data.result;
    };

    const fetchUrlAsBase64 = async (url: string): Promise<string> => {
      const { blob } = await fetchBlobWithTimeout(url, { timeoutMs: 15_000 });
      const buf = await blob.arrayBuffer();
      return uint8ArrayToBase64(new Uint8Array(buf));
    };

    try {
      // Quick connectivity probe first so unreachable AnkiConnect gives a clear guidance message
      try {
        await invokeAnkiConnect('version');
      } catch {
        showStatus(
          'AnkiConnect local (127.0.0.1:8765) não detectado. Use "Exportar .apkg" para importar no Anki Desktop preservando FSRS.',
          'info'
        );
        return;
      }

      const mediaManifest = extractDeckMediaManifest(cards, cleanDeckKey);
      const canonicalJson = formatCanonicalDeckJson(cards, extractedMeta, cleanDeckKey);
      const canonicalNotes: AnkiConnectCanonicalNote[] = JSON.parse(canonicalJson);

      const syncResult = await syncDeckToAnkiConnect({
        deckKey: cleanDeckKey,
        deckTitle,
        canonicalNotes,
        mediaManifest,
        localMediaAssets,
        clinicalCss: ANKI_CONNECT_CLINICAL_CSS,
        invoke: invokeAnkiConnect,
        fetchUrlAsBase64,
      });

      const resolvedMediaTotal = syncResult.storedMediaCount + syncResult.existingMediaCount;
      const summaryParts = [
        `${syncResult.updatedInPlace} atualizada(s) in-place`,
        `${syncResult.addedNew} adicionada(s)`,
      ];
      if (syncResult.totalMediaCount > 0) {
        summaryParts.push(`${resolvedMediaTotal}/${syncResult.totalMediaCount} mídia(s)`);
      }

      const issues: string[] = [];
      if (syncResult.failedMedia.length > 0) {
        const preview = syncResult.failedMedia
          .slice(0, 3)
          .map((f) => `${f.filename} (${f.reason})`)
          .join('; ');
        const extra =
          syncResult.failedMedia.length > 3 ? ` +${syncResult.failedMedia.length - 3}` : '';
        issues.push(`${syncResult.failedMedia.length} falha(s) de mídia: ${preview}${extra}`);
      }
      if (syncResult.failedNotes.length > 0) {
        const preview = syncResult.failedNotes
          .slice(0, 3)
          .map((n) => `ID ${n.cardId} (${n.reason})`)
          .join('; ');
        const extra =
          syncResult.failedNotes.length > 3 ? ` +${syncResult.failedNotes.length - 3}` : '';
        issues.push(`${syncResult.failedNotes.length} nota(s) com erro: ${preview}${extra}`);
      }

      if (issues.length > 0) {
        showStatus(
          `AnkiConnect concluído com ressalvas em "${deckTitle}" (${summaryParts.join(', ')}). ${issues.join(' | ')}`,
          'error'
        );
      } else {
        showStatus(
          `Sincronizado com AnkiConnect em "${deckTitle}" (${summaryParts.join(', ')}) com tags FSRS escopadas por deck.`,
          'success'
        );
      }
    } catch (err: unknown) {
      showStatus(
        err instanceof Error
          ? `Erro durante sincronização com AnkiConnect: ${err.message}`
          : 'Erro inesperado durante sincronização com AnkiConnect.',
        'error'
      );
    } finally {
      setIsSyncingAnkiConnect(false);
    }
  }, [cards, checkExportAuditOrPrompt, clinicalMap, deckKey, extractedMeta, localMediaAssets, showStatus]);

  const cancelPendingExport = useCallback(() => {
    if (pendingExportConfirm) {
      showStatus(
        `Exportação ${pendingExportConfirm.label} cancelada para revisão da auditoria.`,
        'info'
      );
      setPendingExportConfirm(null);
    }
  }, [pendingExportConfirm, showStatus]);

  const confirmPendingExport = useCallback(() => {
    if (!pendingExportConfirm) return;
    const fmt = pendingExportConfirm.format;
    setPendingExportConfirm(null);
    if (fmt === 'json') {
      handleDownloadJson(true);
    } else if (fmt === 'zip') {
      void handleDownloadOfflineBundle(true);
    } else if (fmt === 'apkg') {
      void handleExportApkg(true);
    } else if (fmt === 'anki_connect') {
      void handleSyncAnkiConnect(true);
    }
  }, [
    handleDownloadJson,
    handleDownloadOfflineBundle,
    handleExportApkg,
    handleSyncAnkiConnect,
    pendingExportConfirm,
  ]);

  return {
    isExportingBundle,
    isExportingApkg,
    isSyncingAnkiConnect,
    pendingExportConfirm,
    confirmPendingExport,
    cancelPendingExport,
    handleDownloadJson,
    handleDownloadOfflineBundle,
    handleExportApkg,
    handleSyncAnkiConnect,
  };
}
