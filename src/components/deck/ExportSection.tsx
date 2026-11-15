import React from 'react';
import { Archive, Download, MonitorUp, PackageCheck } from 'lucide-react';
import { sanitizeDeckKey } from '../../utils/apiClient';

interface ExportSectionProps {
  deckKey: string;
  cardCount: number;
  mediaCount: number;
  missingMediaCount: number;
  isExportingApkg: boolean;
  isExportingBundle: boolean;
  isSyncingAnkiConnect: boolean;
  onExportApkg: () => void;
  onDownloadOfflineBundle: () => void;
  onDownloadJson: () => void;
  onSyncAnkiConnect: () => void;
}

export const ExportSection: React.FC<ExportSectionProps> = ({
  deckKey,
  cardCount,
  mediaCount,
  missingMediaCount,
  isExportingApkg,
  isExportingBundle,
  isSyncingAnkiConnect,
  onExportApkg,
  onDownloadOfflineBundle,
  onDownloadJson,
  onSyncAnkiConnect,
}) => {
  const cleanKey = sanitizeDeckKey(deckKey || 'internato_deck');

  return (
    <section
      id="exportar-apkg"
      className="bg-[#111827] border border-slate-800 rounded-xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
    >
      <div className="space-y-1">
        <h2 className="text-base font-bold text-slate-100 font-display">
          4. Exportar Baralho para Anki (FSRS Preservado)
        </h2>
        <p className="text-xs text-slate-400 tabular-nums">
          {cardCount === 0
            ? 'Gere ou importe um baralho acima para habilitar a exportação.'
            : `${cardCount} card(s) prontos com IDs/GUIDs determinísticos · ${mediaCount} mídia(s)${
                missingMediaCount > 0 ? ` (${missingMediaCount} pendente(s))` : ''
              }`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onDownloadJson}
          disabled={cardCount === 0}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>{cleanKey}_notes.json</span>
        </button>

        <button
          type="button"
          onClick={onDownloadOfflineBundle}
          disabled={cardCount === 0 || isExportingBundle}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-950 bg-sky-400 rounded-lg hover:bg-sky-300 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Archive className="w-3.5 h-3.5" />
          <span>{isExportingBundle ? 'Empacotando...' : 'Pacote .zip Offline'}</span>
        </button>

        <button
          type="button"
          onClick={onSyncAnkiConnect}
          disabled={cardCount === 0 || isSyncingAnkiConnect}
          title="Sincroniza diretamente com o Anki Desktop aberto via AnkiConnect (http://127.0.0.1:8765)"
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <MonitorUp className="w-3.5 h-3.5 text-emerald-400" />
          <span>{isSyncingAnkiConnect ? 'Sincronizando...' : 'AnkiConnect Local'}</span>
        </button>

        <button
          type="button"
          onClick={onExportApkg}
          disabled={cardCount === 0 || isExportingApkg}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <PackageCheck className="w-3.5 h-3.5" />
          <span>{isExportingApkg ? 'Gerando .apkg...' : 'Exportar .apkg (Anki)'}</span>
        </button>
      </div>
    </section>
  );
};
