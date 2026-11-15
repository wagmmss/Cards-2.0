import React from 'react';
import {
  ArrowLeftRight,
  Check,
  Copy,
  Eye,
  Plus,
  Search,
  Trash2,
  Zap,
} from 'lucide-react';
import { DeckCurationStats } from '../../types/deck';

export type DeckFilterMode = 'ALL' | 'WARNINGS' | 'MISSING_MEDIA' | 'BASIC' | 'CLOZE';

interface DeckToolbarProps {
  cardCount: number;
  basicCount: number;
  clozeCount: number;
  basicPct: number;
  clozePct: number;
  mediaCount: number;
  totalFlaggedCards: number;
  totalCardsWithMissingMedia: number;
  isAutoResolvingImages: boolean;
  isRepairing: boolean;
  curationStats?: DeckCurationStats | null;
  filterMode: DeckFilterMode;
  viewTab: 'CARDS' | 'RAW_JSON';
  searchQuery: string;
  copiedJson: boolean;
  onSelectFilter: (mode: DeckFilterMode) => void;
  onSelectViewTab: (tab: 'CARDS' | 'RAW_JSON') => void;
  onSearchQueryChange: (val: string) => void;
  onOpenQuickReview: () => void;
  onCurateAndRebalance: () => void;
  onAutoRepairAllFlagged: () => void;
  onAutoResolveMissingImages: () => void;
  onRemoveAllMissingMedia: () => void;
  onCopyJson: () => void;
  onAddNewCard: () => void;
}

export const DeckToolbar: React.FC<DeckToolbarProps> = ({
  cardCount,
  basicCount,
  clozeCount,
  basicPct,
  clozePct,
  mediaCount,
  totalFlaggedCards,
  totalCardsWithMissingMedia,
  isAutoResolvingImages,
  isRepairing,
  curationStats,
  filterMode,
  viewTab,
  searchQuery,
  copiedJson,
  onSelectFilter,
  onSelectViewTab,
  onSearchQueryChange,
  onOpenQuickReview,
  onCurateAndRebalance,
  onAutoRepairAllFlagged,
  onAutoResolveMissingImages,
  onRemoveAllMissingMedia,
  onCopyJson,
  onAddNewCard,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3.5 pb-4 border-b border-slate-800">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold text-slate-100 font-display">
            3. Revisão Clínica &amp; Mídias
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 tabular-nums">
            <span>
              <strong className="text-slate-100">{cardCount}</strong> cards
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <strong className="text-slate-100">{basicPct}%</strong> basic /{' '}
              <strong className="text-slate-100">{clozePct}%</strong> cloze
            </span>
            <span aria-hidden="true">·</span>
            <span
              className={
                totalCardsWithMissingMedia > 0 ? 'text-amber-400 font-semibold' : 'text-sky-300'
              }
            >
              <strong>{mediaCount}</strong> mídia(s)
              {isAutoResolvingImages
                ? ' (buscando...)'
                : totalCardsWithMissingMedia > 0
                ? ` (${totalCardsWithMissingMedia} pendente(s))`
                : ' (resolvidas)'}
            </span>
            <span aria-hidden="true">·</span>
            <span
              className={
                totalFlaggedCards === 0
                  ? 'text-emerald-400 font-medium'
                  : 'text-amber-400 font-medium'
              }
            >
              {cardCount - totalFlaggedCards}/{cardCount} conformes
            </span>
          </div>
        </div>

        {curationStats && (
          <div className="px-3.5 py-2 rounded-lg bg-[#0B0F17] border border-slate-800 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300 tabular-nums">
            <span className="font-semibold text-sky-400">Curadoria:</span>
            <span>
              Originais: <strong className="text-slate-100">{curationStats.originalCount}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>
              Podados: <strong className="text-amber-400">-{curationStats.prunedCount}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>
              Novos P1–P4: <strong className="text-emerald-400">+{curationStats.addedCount}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>
              IDs FSRS mantidos:{' '}
              <strong className="text-slate-100">{curationStats.preservedIdsCount}</strong>
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenQuickReview}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-indigo-400 hover:bg-indigo-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Revisão Rápida (Anki)</span>
          </button>

          <button
            type="button"
            onClick={onCurateAndRebalance}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              !curationStats
                ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                : 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>Revisar, Podar &amp; Auditar</span>
          </button>

          <button
            type="button"
            onClick={onAutoRepairAllFlagged}
            disabled={isRepairing || totalFlaggedCards === 0}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              totalFlaggedCards > 0
                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                : 'bg-slate-800 text-slate-500 border border-slate-700/70 cursor-not-allowed'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>
              {isRepairing ? 'Reparando...' : `Auto-Reparar (${totalFlaggedCards})`}
            </span>
          </button>

          {totalCardsWithMissingMedia > 0 && (
            <>
              <button
                type="button"
                onClick={onAutoResolveMissingImages}
                disabled={isAutoResolvingImages}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Search className="w-3.5 h-3.5" />
                <span>
                  {isAutoResolvingImages
                    ? 'Buscando imagens...'
                    : `Resolver Imagens (${totalCardsWithMissingMedia})`}
                </span>
              </button>

              <button
                type="button"
                onClick={onRemoveAllMissingMedia}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-200 bg-red-950/70 border border-red-700/70 rounded-lg hover:bg-red-900/70 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                <span>Limpar Órfãs</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onCopyJson}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copiedJson ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>JSON Copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar JSON</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Filter & View Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-lg">
          {(
            [
              { id: 'ALL', label: `Todos (${cardCount})` },
              { id: 'WARNINGS', label: `Avisos (${totalFlaggedCards})` },
              ...(totalCardsWithMissingMedia > 0
                ? [
                    {
                      id: 'MISSING_MEDIA' as const,
                      label: `Sem Imagem (${totalCardsWithMissingMedia})`,
                    },
                  ]
                : []),
              { id: 'BASIC', label: `Basic (${basicCount})` },
              { id: 'CLOZE', label: `Cloze (${clozeCount})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                onSelectViewTab('CARDS');
                onSelectFilter(tab.id);
              }}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                viewTab === 'CARDS' && filterMode === tab.id
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onSelectViewTab(viewTab === 'RAW_JSON' ? 'CARDS' : 'RAW_JSON')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewTab === 'RAW_JSON'
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            JSON Canônico (Técnico)
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Filtrar cards..."
            aria-label="Filtrar cards por texto"
            className="px-3 py-1 text-xs bg-[#0B0F17] border border-slate-700 rounded-lg text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none w-44"
          />
          <button
            type="button"
            onClick={onAddNewCard}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Novo Card</span>
          </button>
        </div>
      </div>
    </div>
  );
};
