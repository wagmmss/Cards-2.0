import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export const DoctrineReferenceSection: React.FC = () => {
  const [expanded, setExpanded] = useState(false);

  return (
    <section
      id="doutrina-regras"
      className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-800/50 transition-colors cursor-pointer"
      >
        <div>
          <h2 className="text-sm font-bold text-slate-100 font-display">
            Regras do Sistema (Tripla Ancoragem · Hierarquia P1–P4 · Linter criador_cards)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Diretrizes sincronizadas com o motor desktop (<code className="font-mono text-slate-300">lint.py</code> e{' '}
            <code className="font-mono text-slate-300">SYSTEM_PROMPT_CRIADOR.md</code>).
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-6 pb-6 pt-2 border-t border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-slate-300 leading-relaxed">
          <div className="space-y-1.5">
            <h3 className="font-semibold text-slate-100">1. Tripla Ancoragem & FSRS</h3>
            <p>
              Cards <code className="font-mono text-sky-400">basic</code> seguem{' '}
              <strong className="text-slate-100">[Cenário + Idade/IG] + [Clínica/Sinais Vitais] + [Comando Temporal Fechado]</strong>{' '}
              (máx. 50 palavras), preservando o <code className="font-mono text-slate-200">&quot;id&quot;</code> numérico FSRS nos conceitos sobreviventes.
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="font-semibold text-slate-100">2. Doutrina P1 → P4 & Filtro Negativo</h3>
            <p>
              <strong className="text-slate-100">P1:</strong> Minuto zero, red flags, 1ª droga (dose/via), 2ª linha e antídotos.{' '}
              <strong className="text-slate-100">P2:</strong> 1ª linha vs. padrão-ouro e <code className="font-mono text-sky-400">recognition</code> sem spoilers.{' '}
              <strong className="text-slate-100">P3:</strong> Ambulatório, gestantes e profilaxias.{' '}
              <strong className="text-slate-100">P4:</strong> Fisiopatologia aplicada (zero genética de bancada ou história).
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="font-semibold text-slate-100">3. Mídias Offline & Anti-Spoiler Anki</h3>
            <p>
              50% <code className="font-mono text-sky-400">basic</code> e 50% <code className="font-mono text-sky-400">cloze</code>.
              Imagens são embutidas localmente (<code className="font-mono text-slate-200">&lt;img src=&quot;arquivo.ext&quot;&gt;</code>)
              e exportadas junto com <code className="font-mono text-slate-200">collection.media</code> no pacote <code className="font-mono text-slate-200">.zip</code> offline, com ferramenta de tarja anti-spoiler no preview.
            </p>
          </div>
        </div>
      )}
    </section>
  );
};
