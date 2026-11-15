import React from 'react';
import { Download, PackageCheck } from 'lucide-react';
import { sanitizeDeckKey } from '../utils/apiClient';

interface TopBarProps {
  deckKey: string;
  cardCount: number;
  onDownloadJson: () => void;
  onExportApkg: () => void;
  isExportingApkg?: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  deckKey,
  cardCount,
  onDownloadJson,
  onExportApkg,
  isExportingApkg = false,
}) => {
  const cleanKey = sanitizeDeckKey(deckKey || 'deck');

  return (
    <header className="bg-[#0F1623] border-b border-slate-800/90">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-6 px-4 sm:px-6 py-3.5">
        <a
          href="#painel-entrada"
          className="text-sm font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 font-display"
        >
          Internato-First Card Architect
        </a>

        <nav
          aria-label="Navegação Principal"
          className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-400"
        >
          <a
            href="#painel-entrada"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Importar
          </a>
          <a
            href="#mapa-clinico"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Mapa P1–P4
          </a>
          <a
            href="#linter-wozniak"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Revisão &amp; Mídias
          </a>
          <a
            href="#exportar-apkg"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Exportar
          </a>
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onDownloadJson}
            disabled={cardCount === 0}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-35 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>JSON</span>
            <span className="hidden lg:inline font-mono text-slate-400">({cleanKey})</span>
          </button>

          <button
            type="button"
            onClick={onExportApkg}
            disabled={cardCount === 0 || isExportingApkg}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 disabled:opacity-35 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <PackageCheck className="w-3.5 h-3.5" />
            <span>{isExportingApkg ? 'Gerando .apkg...' : 'Exportar .apkg'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
