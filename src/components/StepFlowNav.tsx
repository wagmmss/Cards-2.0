import React from 'react';
import { Check } from 'lucide-react';

export interface StepFlowNavProps {
  hasInput: boolean;
  hasMap: boolean;
  hasCards: boolean;
  isReadyToExport: boolean;
  activeStep: 1 | 2 | 3 | 4;
  onSelectStep: (step: 1 | 2 | 3 | 4) => void;
}

const STEPS: Array<{
  id: 1 | 2 | 3 | 4;
  anchor: string;
  title: string;
  subtitle: string;
}> = [
  { id: 1, anchor: '#painel-entrada', title: '1. Importar Deck / PDF', subtitle: 'Tema e anexos' },
  { id: 2, anchor: '#mapa-clinico', title: '2. Mapa Clínico P1–P4', subtitle: 'Diretrizes e checklist' },
  { id: 3, anchor: '#linter-wozniak', title: '3. Revisão & Mídias', subtitle: 'Linter e imagens reais' },
  { id: 4, anchor: '#exportar-apkg', title: '4. Exportar .apkg', subtitle: 'Anki + FSRS' },
];

export const StepFlowNav: React.FC<StepFlowNavProps> = ({
  hasInput,
  hasMap,
  hasCards,
  isReadyToExport,
  activeStep,
  onSelectStep,
}) => {
  const completedMap: Record<1 | 2 | 3 | 4, boolean> = {
    1: hasInput,
    2: hasMap,
    3: hasCards,
    4: isReadyToExport,
  };

  return (
    <nav
      aria-label="Etapas do Fluxo"
      className="bg-[#0F1623] border border-slate-800 rounded-xl p-1.5 grid grid-cols-2 lg:grid-cols-4 gap-1.5"
    >
      {STEPS.map((step) => {
        const isDone = completedMap[step.id];
        const isActive = activeStep === step.id;
        return (
          <a
            key={step.id}
            href={step.anchor}
            onClick={() => onSelectStep(step.id)}
            className={`group flex items-center justify-between gap-2 px-3 py-2 rounded-lg border transition-colors ${
              isActive
                ? 'bg-[#111827] border-sky-500/60 text-slate-100'
                : 'bg-transparent border-transparent hover:bg-[#111827]/70 hover:border-slate-800 text-slate-300'
            }`}
          >
            <div className="min-w-0">
              <div className="text-xs font-semibold truncate">{step.title}</div>
              <div className="text-[11px] text-slate-400 truncate">{step.subtitle}</div>
            </div>
            {isDone && (
              <span
                aria-label="Etapa preenchida"
                className="w-4 h-4 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0"
              >
                <Check className="w-3 h-3" />
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );
};
