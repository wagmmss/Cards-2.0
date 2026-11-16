import React from 'react';
import { FileText, Map, ShieldCheck, Download, CheckCircle2 } from 'lucide-react';

export interface StepFlowNavProps {
  hasInput: boolean;
  hasMap: boolean;
  hasCards: boolean;
  isReadyToExport: boolean;
  activeStep: 1 | 2 | 3 | 4;
  onSelectStep: (step: 1 | 2 | 3 | 4) => void;
}

interface StepConfig {
  step: 1 | 2 | 3 | 4;
  title: string;
  subtitle: string;
  anchor: string;
  done: boolean;
  icon: React.ComponentType<{ className?: string }>;
}

export const StepFlowNav: React.FC<StepFlowNavProps> = ({
  hasInput,
  hasMap,
  hasCards,
  isReadyToExport,
  activeStep,
  onSelectStep,
}) => {
  const steps: StepConfig[] = [
    {
      step: 1,
      title: '1. Fonte & Diretrizes',
      subtitle: hasInput ? 'Material carregado' : 'PDFs, notas ou tema',
      anchor: 'fonte-dados',
      done: hasInput,
      icon: FileText,
    },
    {
      step: 2,
      title: '2. Mapa Clínico P1–P4',
      subtitle: hasMap ? 'Tópicos mapeados' : 'Diagnóstico → Conduta',
      anchor: 'mapa-clinico',
      done: hasMap,
      icon: Map,
    },
    {
      step: 3,
      title: '3. Curadoria & Linter',
      subtitle: hasCards ? 'Auditoria Wozniak ativa' : 'Revisão rápida & mídia',
      anchor: 'linter-wozniak',
      done: hasCards,
      icon: ShieldCheck,
    },
    {
      step: 4,
      title: '4. Exportar Anki FSRS',
      subtitle: isReadyToExport ? 'Pronto para exportar' : 'Pacote .apkg / .zip',
      anchor: 'exportar-apkg',
      done: isReadyToExport,
      icon: Download,
    },
  ];

  const handleClick = (item: StepConfig) => {
    onSelectStep(item.step);
    const el = document.getElementById(item.anchor);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <nav
      aria-label="Fluxo de Arquitetura de Cards"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 bg-white border border-slate-200/90 rounded-xl p-2.5 shadow-xs"
    >
      {steps.map((item) => {
        const Icon = item.icon;
        const isActive = activeStep === item.step;
        return (
          <button
            key={item.step}
            type="button"
            onClick={() => handleClick(item)}
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-left transition-all cursor-pointer border ${
              isActive
                ? 'bg-sky-50/90 border-sky-300 text-sky-950 shadow-2xs'
                : item.done
                  ? 'bg-slate-50/70 border-slate-200/80 text-slate-800 hover:bg-slate-100/70'
                  : 'bg-white border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                isActive
                  ? 'bg-sky-600 text-white'
                  : item.done
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-500'
              }`}
            >
              {item.done && !isActive ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Icon className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold tracking-tight truncate">
                {item.title}
              </div>
              <div
                className={`text-[11px] truncate ${
                  isActive
                    ? 'text-sky-700 font-medium'
                    : item.done
                      ? 'text-emerald-700'
                      : 'text-slate-400'
                }`}
              >
                {item.subtitle}
              </div>
            </div>
          </button>
        );
      })}
    </nav>
  );
};
