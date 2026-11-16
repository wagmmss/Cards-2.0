import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { DeckAuditResult } from '../utils/wozniakLinter';

export type ExportFormatType = 'json' | 'zip' | 'apkg' | 'anki_connect';

export interface PendingExportConfirmation {
  format: ExportFormatType;
  label: string;
  deckAudit: DeckAuditResult;
}

interface ExportConfirmationModalProps {
  pending: PendingExportConfirmation | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ExportConfirmationModal: React.FC<ExportConfirmationModalProps> = ({
  pending,
  onConfirm,
  onCancel,
}) => {
  if (!pending) return null;

  const { label, deckAudit } = pending;
  const missingLegendErrs = deckAudit.errors.filter((e) => e.code === 'IMAGE_MISSING_LEGEND');
  const modalityErrs = deckAudit.errors.filter((e) => e.code === 'MODALITY_CONFLICT');
  const orphanVisualErrs = deckAudit.errors.filter((e) => e.code === 'ORPHAN_VISUAL_REFERENCE');
  const tableErrs = deckAudit.errors.filter((e) => e.code === 'TABLE_MALFORMED');
  const otherErrs = deckAudit.errors.filter(
    (e) =>
      e.code !== 'IMAGE_MISSING_LEGEND' &&
      e.code !== 'MODALITY_CONFLICT' &&
      e.code !== 'ORPHAN_VISUAL_REFERENCE' &&
      e.code !== 'TABLE_MALFORMED'
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-xl bg-[#111827] border border-amber-700/70 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 bg-amber-950/40 border-b border-amber-800/60">
          <div className="flex items-center gap-2 text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <h3 id="export-confirm-title" className="text-sm font-bold font-display">
              Auditoria antes de exportar ({label})
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fechar alerta de exportação"
            className="text-slate-400 hover:text-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-xs text-slate-200">
          <p className="text-slate-300 leading-relaxed">
            Foram detectadas pendências estruturais ou visuais no baralho. Você pode revisar os
            cards sinalizados antes ou prosseguir com a exportação mesmo assim.
          </p>

          <ul className="space-y-1.5 rounded-lg bg-[#0B0F17] border border-slate-800 p-3.5 text-amber-200">
            {deckAudit.duplicateImages.length > 0 && (
              <li>
                • <strong>{deckAudit.duplicateImages.length}</strong> imagem(ns) repetida(s) entre
                cards diferentes.
              </li>
            )}
            {missingLegendErrs.length > 0 && (
              <li>
                • <strong>{missingLegendErrs.length}</strong> imagem(ns) sem legenda descritiva{' '}
                <code className="font-mono text-amber-300">&lt;i&gt;</code> (mín. 6 palavras) [
                {missingLegendErrs
                  .slice(0, 6)
                  .map((e) => `#${e.cardId}`)
                  .join(', ')}
                {missingLegendErrs.length > 6 ? ', ...' : ''}]
              </li>
            )}
            {modalityErrs.length > 0 && (
              <li>
                • <strong>{modalityErrs.length}</strong> conflito(s) de modalidade exame×legenda [
                {modalityErrs
                  .slice(0, 6)
                  .map((e) => `#${e.cardId}`)
                  .join(', ')}
                ]
              </li>
            )}
            {orphanVisualErrs.length > 0 && (
              <li>
                • <strong>{orphanVisualErrs.length}</strong> card(s) com referência visual órfã sem{' '}
                <code className="font-mono text-amber-300">&lt;img&gt;</code> [
                {orphanVisualErrs
                  .slice(0, 6)
                  .map((e) => `#${e.cardId}`)
                  .join(', ')}
                ]
              </li>
            )}
            {tableErrs.length > 0 && (
              <li>
                • <strong>{tableErrs.length}</strong> tabela(s) HTML malformada(s) [
                {tableErrs
                  .slice(0, 6)
                  .map((e) => `#${e.cardId}`)
                  .join(', ')}
                ]
              </li>
            )}
            {otherErrs.length > 0 && (
              <li>
                • <strong>{otherErrs.length}</strong> erro(s) estrutural(is) adicional(is) [
                {otherErrs
                  .slice(0, 6)
                  .map((e) => `#${e.cardId}`)
                  .join(', ')}
                ]
              </li>
            )}
          </ul>
        </div>

        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 bg-[#0B0F17] border-t border-slate-800">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg cursor-pointer transition-colors"
          >
            Voltar e Revisar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg cursor-pointer transition-colors"
          >
            Exportar Mesmo Assim
          </button>
        </div>
      </div>
    </div>
  );
};
