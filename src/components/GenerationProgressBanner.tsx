import React from 'react';
import { Loader2, Square, Sparkles, Clock, Layers } from 'lucide-react';
import { GenerationProgress } from '../hooks/useBatchDeckGenerator';

export interface GenerationProgressBannerProps {
  progress: GenerationProgress | null;
  onCancel: () => void;
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

export const GenerationProgressBanner: React.FC<GenerationProgressBannerProps> = ({
  progress,
  onCancel,
}) => {
  if (!progress) return null;

  const pct =
    progress.totalBatches > 0
      ? Math.min(100, Math.max(8, Math.round((progress.currentBatch / progress.totalBatches) * 100)))
      : 15;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-sky-950 text-white rounded-xl p-4 shadow-md border border-sky-800/80 transition-all"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-sky-500/20 border border-sky-400/30 flex items-center justify-center shrink-0">
            <Loader2 className="w-4 h-4 text-sky-300 animate-spin" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wider text-sky-300 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                Motor Pedagógico Internato-First
              </span>
              <span className="text-[11px] font-mono bg-sky-900/90 text-sky-200 px-2 py-0.5 rounded border border-sky-700/60">
                Lote {progress.currentBatch}/{progress.totalBatches}
              </span>
            </div>
            <p className="text-sm font-medium text-white mt-0.5 truncate">
              {progress.label}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
          <div className="flex items-center gap-3 text-xs text-sky-200 font-mono bg-sky-900/60 px-3 py-1.5 rounded-lg border border-sky-800">
            {progress.cardsReady > 0 && (
              <span className="flex items-center gap-1 text-emerald-300 font-semibold">
                <Layers className="w-3.5 h-3.5" />
                {progress.cardsReady} cards prontos
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-sky-400" />
              {formatElapsed(progress.elapsedSec)}
            </span>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-400/30 transition-colors cursor-pointer"
            title="Interromper operação atual"
          >
            <Square className="w-3 h-3 fill-current" />
            Cancelar
          </button>
        </div>
      </div>

      <div className="mt-3 w-full bg-sky-900/80 h-1.5 rounded-full overflow-hidden">
        <div
          className="bg-gradient-to-r from-sky-400 to-emerald-400 h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};
