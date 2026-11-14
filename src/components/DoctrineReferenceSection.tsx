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
            Diretrizes Cognitivas (Matuschak &amp; Nielsen · Internato P1–P4 · FSRS)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Engenharia de prompts baseada em{' '}
            <code className="font-mono text-slate-300">andymatuschak.org/prompts</code> e{' '}
            <code className="font-mono text-slate-300">augmentingcognition.com/ltm.html</code>.
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
            <h3 className="font-semibold text-slate-100">1. Matuschak &amp; Nielsen (FSRS)</h3>
            <p>
              Todo card segue as 5 propriedades (<strong className="text-slate-100">Focused, Precise, Consistent, Tractable, Effortful</strong>):
              compreensão causal antes da decoreba, zero listas abertas ou perguntas Sim/Não, e preservação determinística dos{' '}
              <code className="font-mono text-slate-200">&quot;id&quot;</code>/GUIDs para manter 100% do FSRS.
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="font-semibold text-slate-100">2. Formato Fluido &amp; 4 Perfis P1–P4</h3>
            <p>
              Os eixos P1–P4 se adaptam ao domínio do tema (<strong className="text-slate-100">Emergência</strong>,{' '}
              <strong className="text-slate-100">Ambulatório/Híbridos</strong>, <strong className="text-slate-100">Cirúrgico</strong> ou{' '}
              <strong className="text-slate-100">Preventiva/Ética</strong>). Sem cota rígida 50/50: usa-se{' '}
              <code className="font-mono text-sky-400">basic</code> para condutas, diferenciais, imagens e perguntas{' '}
              <em>&ldquo;por que / como&rdquo;</em>; <code className="font-mono text-sky-400">cloze</code> para critérios numéricos, doses e limiares.
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="font-semibold text-slate-100">3. Imagens Reais da Web &amp; Export .apkg</h3>
            <p>
              Busca exclusivamente <strong className="text-slate-100">imagens reais disponíveis na internet</strong> (Google Grounding com extração de páginas médicas, Wikipedia, Wikimedia Commons, LITFL, Radiopaedia), sem desenhos sintéticos gerados. Galeria de troca rápida com{' '}
              <code className="font-mono text-slate-200">Ctrl+V</code> e exportação direta em{' '}
              <code className="font-mono text-slate-200">.apkg</code> offline.
            </p>
          </div>
        </div>
      )}
    </section>
  );
};
