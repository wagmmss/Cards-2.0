import React, { useState } from 'react';
import { CheckSquare, Square, ExternalLink, Plus, Sparkles } from 'lucide-react';
import {
  CardType,
  ClinicalMapItem,
  ClinicalMapResponse,
  DomainProfile,
  PriorityLevel,
} from '../types/deck';
import { DOMAIN_PROFILE_CONFIGS, inferDomainProfile } from '../utils/domainProfiles';

interface ClinicalMapSectionProps {
  clinicalMap: ClinicalMapResponse | null;
  onToggleMapItem: (id: string) => void;
  onToggleItemCardType: (id: string) => void;
  onAddCustomMapItem: (
    priority: PriorityLevel,
    subtopic: string,
    concept: string,
    targetCardType: CardType
  ) => void;
  onDeepenGuidelines?: (focusQuery?: string) => void;
  isDeepeningGuidelines?: boolean;
  onRecreateCanonicalDeck: () => void;
  isGeneratingDeck: boolean;
}

export const ClinicalMapSection: React.FC<ClinicalMapSectionProps> = ({
  clinicalMap,
  onToggleMapItem,
  onToggleItemCardType,
  onAddCustomMapItem,
  onDeepenGuidelines,
  isDeepeningGuidelines = false,
  onRecreateCanonicalDeck,
  isGeneratingDeck,
}) => {
  const [activePriorityFilter, setActivePriorityFilter] = useState<'ALL' | PriorityLevel>('ALL');
  const [newPriority, setNewPriority] = useState<PriorityLevel>('P1');
  const [newSubtopic, setNewSubtopic] = useState('');
  const [newConcept, setNewConcept] = useState('');
  const [newCardType, setNewCardType] = useState<CardType>('basic');
  const [showAddForm, setShowAddForm] = useState(false);
  const [deepenFocusQuery, setDeepenFocusQuery] = useState('');

  if (!clinicalMap || clinicalMap.items.length === 0) {
    return (
      <section
        id="mapa-clinico"
        className="bg-[#111827] border border-slate-800 rounded-xl px-6 py-5 flex items-center justify-between gap-4"
      >
        <div>
          <h2 className="text-sm font-bold text-slate-100 font-display">
            2. Mapa Clínico (P1 a P4) & Diretrizes
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Informe o tema ou envie PDFs acima e clique no Passo 1 para gerar o checklist clínico P1–P4.
          </p>
        </div>
        <span className="text-xs text-slate-500 whitespace-nowrap">Aguardando Passo 1</span>
      </section>
    );
  }

  const activeProfile: DomainProfile =
    clinicalMap.profile || inferDomainProfile(clinicalMap.deckKey, clinicalMap.themeTitle);
  const profileConfig = DOMAIN_PROFILE_CONFIGS[activeProfile];
  const priorityLabels = profileConfig.priorityLabels;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtopic.trim() || !newConcept.trim()) return;
    onAddCustomMapItem(newPriority, newSubtopic.trim(), newConcept.trim(), newCardType);
    setNewSubtopic('');
    setNewConcept('');
    setShowAddForm(false);
  };

  const checkedCount = clinicalMap.items.filter((i) => i.checked).length;
  const visibleItems =
    activePriorityFilter === 'ALL'
      ? clinicalMap.items
      : clinicalMap.items.filter((i) => i.priority === activePriorityFilter);

  return (
    <section
      id="mapa-clinico"
      className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-5"
    >
      {/* Clean Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-slate-100 font-display">
              2. Mapa Clínico: {clinicalMap.themeTitle}
            </h2>
            <span className="px-2 py-0.5 text-[11px] font-medium rounded-md bg-sky-950/70 border border-sky-700/60 text-sky-300">
              {profileConfig.label}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
            {checkedCount} de {clinicalMap.items.length} conceitos selecionados para o baralho
          </p>
        </div>

        <button
          type="button"
          onClick={onRecreateCanonicalDeck}
          disabled={isGeneratingDeck}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-sky-400 rounded-lg hover:bg-sky-300 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>
            {isGeneratingDeck ? 'Gerando Deck...' : 'Confirmar Checklist P1–P4 e Gerar Deck'}
          </span>
        </button>
      </div>

      {/* Guideline Updates & Interactive Deepening */}
      {(clinicalMap.guidelineUpdates.length > 0 ||
        clinicalMap.groundingSources.length > 0 ||
        Boolean(onDeepenGuidelines)) && (
        <div className="p-3.5 rounded-lg bg-[#0B0F17] border border-slate-800 space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-semibold text-sky-400">
                Síntese de Diretrizes
              </div>
              {clinicalMap.googleSearchUsed ? (
                <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-emerald-950/70 border border-emerald-700/60 text-emerald-300">
                  Web Grounding Ativo
                </span>
              ) : (
                <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-slate-800/90 border border-slate-700 text-slate-300">
                  Base Local / PDFs (Sem Web Grounding)
                </span>
              )}
            </div>
            {onDeepenGuidelines && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onDeepenGuidelines(deepenFocusQuery);
                }}
                className="flex items-center gap-1.5"
              >
                <input
                  type="text"
                  value={deepenFocusQuery}
                  onChange={(e) => setDeepenFocusQuery(e.target.value)}
                  placeholder="Foco opcional (ex.: FEBRASGO 2024, dose...)"
                  className="px-2.5 py-1 text-[11px] bg-slate-900 border border-slate-700 rounded text-slate-100 placeholder:text-slate-500 w-56"
                />
                <button
                  type="submit"
                  disabled={isDeepeningGuidelines}
                  className="px-2.5 py-1 text-[11px] font-semibold text-sky-300 bg-sky-950/70 hover:bg-sky-900/80 border border-sky-700/60 disabled:opacity-50 rounded whitespace-nowrap cursor-pointer"
                >
                  {isDeepeningGuidelines ? 'Buscando diretrizes...' : '+ Aprofundar Web'}
                </button>
              </form>
            )}
          </div>
          {clinicalMap.guidelineUpdates.length > 0 && (
            <ul className="space-y-1 text-slate-300">
              {clinicalMap.guidelineUpdates.map((upd, idx) => (
                <li key={idx} className="leading-relaxed">
                  • {upd}
                </li>
              ))}
            </ul>
          )}
          {clinicalMap.groundingSources.length > 0 && (
            <div className="pt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
              {clinicalMap.groundingSources.map((src, i) => (
                <a
                  key={`${src.uri}-${i}`}
                  href={src.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 underline"
                >
                  <span className="truncate max-w-xs">{src.title}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filter Bar + Add Concept Trigger */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Filtrar por Prioridade"
          className="flex flex-wrap items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-lg"
        >
          {(['ALL', 'P1', 'P2', 'P3', 'P4'] as const).map((prio) => (
            <button
              key={prio}
              type="button"
              onClick={() => setActivePriorityFilter(prio)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activePriorityFilter === prio
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {prio === 'ALL' ? 'Todos (P1–P4)' : prio}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowAddForm((prev) => !prev)}
          className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Adicionar conceito</span>
        </button>
      </div>

      {showAddForm && (
        <form
          onSubmit={handleAdd}
          className="p-3.5 rounded-lg bg-[#0B0F17] border border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-end gap-2.5"
        >
          <select
            aria-label="Prioridade"
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value as PriorityLevel)}
            className="px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-100"
          >
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="P3">P3</option>
            <option value="P4">P4</option>
          </select>
          <input
            type="text"
            value={newSubtopic}
            onChange={(e) => setNewSubtopic(e.target.value)}
            placeholder="Subtema (sem spoiler)"
            className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-100 sm:w-48"
          />
          <input
            type="text"
            value={newConcept}
            onChange={(e) => setNewConcept(e.target.value)}
            placeholder="Conceito clínico atômico (conduta, dose, corte)"
            className="flex-1 px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-100"
          />
          <select
            aria-label="Tipo"
            value={newCardType}
            onChange={(e) => setNewCardType(e.target.value as CardType)}
            className="px-2.5 py-1.5 text-xs font-mono bg-slate-900 border border-slate-700 rounded-md text-slate-100"
          >
            <option value="basic">basic</option>
            <option value="cloze">cloze</option>
          </select>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 rounded-md hover:bg-sky-300 whitespace-nowrap cursor-pointer"
          >
            Salvar
          </button>
        </form>
      )}

      {/* Flat, Uncluttered Checklist */}
      <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg overflow-hidden">
        {visibleItems.map((item: ClinicalMapItem) => (
          <div
            key={item.id}
            className={`px-4 py-3 flex items-start justify-between gap-4 transition-colors ${
              item.checked ? 'bg-[#0F1623]' : 'bg-[#0B0F17]/60 opacity-55'
            }`}
          >
            <div className="flex items-start gap-3 min-w-0">
              <button
                type="button"
                onClick={() => onToggleMapItem(item.id)}
                aria-label={`Marcar conceito ${item.subtopic}`}
                className="mt-0.5 text-sky-400 hover:text-sky-300 shrink-0 cursor-pointer"
              >
                {item.checked ? (
                  <CheckSquare className="w-4 h-4" />
                ) : (
                  <Square className="w-4 h-4 text-slate-600" />
                )}
              </button>
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                  <span className="font-mono font-semibold text-sky-400">
                    {priorityLabels[item.priority]}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-slate-100">{item.subtopic}</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{item.concept}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onToggleItemCardType(item.id)}
              className="px-2 py-1 text-[11px] font-mono text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {item.targetCardType}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
};
