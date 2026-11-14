import React from 'react';
import { Download } from 'lucide-react';

interface TopBarProps {
  deckKey: string;
  cardCount: number;
  onDownloadJson: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  deckKey,
  cardCount,
  onDownloadJson,
}) => {
  const cleanKey = (deckKey || 'deck').trim().toLowerCase().replace(/\s+/g, '_');

  return (
    <header className="bg-[#0F1623] border-b border-slate-800/90">
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-8 px-6 py-3.5">
        {/* Zone 1: Brand title, one line */}
        <a
          href="#painel-entrada"
          className="text-sm font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 font-display"
        >
          Internato-First Card Architect
        </a>

        {/* Zone 2: 4 concise single-line nav links */}
        <nav
          aria-label="Navegação Principal"
          className="hidden sm:flex items-center gap-6 text-xs font-medium text-slate-400"
        >
          <a
            href="#painel-entrada"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Entrada
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
            Linter & Deck
          </a>
          <a
            href="#doutrina-regras"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Regras
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onDownloadJson}
            disabled={cardCount === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-950 bg-sky-400 rounded-lg hover:bg-sky-300 disabled:opacity-35 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Baixar {cleanKey}_notes.json</span>
          </button>
        </div>
      </div>
    </header>
  );
};
