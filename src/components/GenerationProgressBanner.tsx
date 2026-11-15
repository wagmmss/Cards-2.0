import React from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { GenerationProgress } from '../hooks/useBatchDeckGenerator';

interface GenerationProgressBannerProps {
  progress: GenerationProgress | null;
  onCancel: () => void;
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const GenerationProgressBanner: React.FC<GenerationProgressBannerProps> = ({
  progress,
  onCancel,
}) => {
  if (!progress) return null;

  const pct =
    progress.phase === 'gaps'
      ? 92
      : progress.phase === 'repair' || progress.phase === 'map'
      ? 60
      : progress.totalBatches > 0
      ? Math.max(8, Math.round((progress.currentBatch / progress.totalBatches) * 90))
      : 20;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-[#0F1623] border border-sky-500/50 rounded-xl p-4 space-y-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-100 truncate">
              {progress.label}
            </div>
            <div className="text-[11px] text-slate-400 tabular-nums flex flex-wrap items-center gap-2 mt-0.5">
              {progress.totalBatches > 1 && (
                <span>
                  Lote {progress.currentBatch}/{progress.totalBatches}
                </span>
              )}
              {progress.cardsReady > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-400 font-medium">
                    {progress.cardsReady} cards prontos
                  </span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>Tempo: {formatElapsed(progress.elapsedSec)}</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-200 bg-red-950/80 hover:bg-red-900/90 border border-red-700/80 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <XCircle className="w-3.5 h-3.5 text-red-400" />
          <span>Cancelar</span>
        </button>
      </div>

      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-sky-400 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};
