import { CanonicalCard, ClinicalMapResponse, DomainProfile } from '../types/deck';
import {
  DOMAIN_PROFILE_CONFIGS,
  inferDomainProfile,
} from '../utils/domainProfiles';

/**
 * Formats a snake_case deckKey into a clean human-readable title.
 */
export function formatThemeTitle(deckKey: string): string {
  const cleaned = (deckKey || 'Tema Clínico do Internato')
    .trim()
    .replace(/_notes\.json$/i, '')
    .replace(/[_-]+/g, ' ');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Builds a dynamic, profile-aware Clinical Map (P1 to P4) for any medical specialty
 * when offline or while waiting for the live Gemini response.
 */
export function buildGenericClinicalMap(
  deckKey: string,
  existingCards: CanonicalCard[] = [],
  profileOverride?: DomainProfile
): ClinicalMapResponse {
  const title = formatThemeTitle(deckKey);
  const safeKey = (deckKey || 'tema_clinico').trim().toLowerCase().replace(/\s+/g, '_');

  const existingHint = existingCards
    .slice(0, 12)
    .map((c) => `${c.topic} ${c.question}`)
    .join(' ');
  const activeProfile: DomainProfile =
    profileOverride || inferDomainProfile(safeKey, existingHint);
  const cfg = DOMAIN_PROFILE_CONFIGS[activeProfile];

  // Extract distinct subtopics across the existing deck
  const seenSubtopics = new Set<string>();
  const sampledExisting: CanonicalCard[] = [];
  for (const card of existingCards) {
    const rawSub =
      card.topic && card.topic.includes(' - ')
        ? card.topic.split(' - ').slice(1).join(' - ').trim()
        : (card.topic || '').trim();
    const normSub = rawSub.toLowerCase();
    if (normSub && !seenSubtopics.has(normSub)) {
      seenSubtopics.add(normSub);
      sampledExisting.push(card);
      if (sampledExisting.length >= 8) break;
    }
  }

  const priorities = ['P1', 'P2', 'P3', 'P4'] as const;
  const fromExisting = sampledExisting.map((card, idx) => {
    const subtopic = card.topic.includes(' - ')
      ? card.topic.split(' - ').slice(1).join(' - ').trim()
      : `Conceito Base #${idx + 1}`;
    return {
      id: `map-existing-${idx + 1}`,
      priority: card.priority || priorities[idx % 4],
      subtopic,
      concept: card.question.replace(/<[^>]*>/g, '').slice(0, 140),
      guidelineNote: `Auditado do deck original (${cfg.shortLabel}) segundo Matuschak & Nielsen`,
      targetCardType: (card.type || (idx % 2 === 0 ? 'basic' : 'cloze')) as 'basic' | 'cloze',
      checked: true,
    };
  });

  const defaultByProfile: Record<DomainProfile, ClinicalMapResponse['items']> = {
    emergencia: [
      {
        id: 'map-p1-1',
        priority: 'P1',
        subtopic: 'Estabilização Inicial e Droga de Minuto Zero',
        concept: `Sinais de alarme, estabilização imediata e fármaco de 1ª linha (dose/via) em ${title}.`,
        guidelineNote: `${cfg.priorityLabels.P1}`,
        targetCardType: 'basic',
        checked: true,
      },
      {
        id: 'map-p1-2',
        priority: 'P1',
        subtopic: 'Refratariedade, 2ª Linha e Contraindicações',
        concept: `Conduta escalonada após falha da 1ª escolha e contraindicações absolutas em ${title}.`,
        guidelineNote: 'P1 · Duplo Salto Cognitivo na Refratariedade',
        targetCardType: 'cloze',
        checked: true,
      },
      {
        id: 'map-p2-1',
        priority: 'P2',
        subtopic: 'Reconhecimento Visual e Exame Padrão-Ouro',
        concept: `Exame inicial à beira-leito vs. padrão-ouro e interpretação de imagem real em ${title}.`,
        guidelineNote: `${cfg.priorityLabels.P2}`,
        targetCardType: 'basic',
        checked: true,
      },
      {
        id: 'map-p3-1',
        priority: 'P3',
        subtopic: 'Pós-Estabilização e Critérios de Internação/Alta',
        concept: `Transição terapêutica, profilaxia secundária e critérios de UTI ou alta em ${title}.`,
        guidelineNote: `${cfg.priorityLabels.P3}`,
        targetCardType: 'cloze',
        checked: true,
      },
      {
        id: 'map-p4-1',
        priority: 'P4',
        subtopic: 'Mecanismo Aplicado e Diagnóstico Diferencial',
        concept: `Fisiopatologia que justifica a conduta aguda e diferencial prioritário em ${title}.`,
        guidelineNote: `${cfg.priorityLabels.P4}`,
        targetCardType: 'basic',
        checked: true,
      },
    ],
    ambulatorio: [
      {
        id: 'map-p1-1',
        priority: 'P1',
        subtopic: 'Contraindicações Absolutas e Sinais de Alarme',
        concept: `Fármacos/condutas proscritas, red flags para internação e descompensações agudas em ${title}.`,
        guidelineNote: `${cfg.priorityLabels.P1}`,
        targetCardType: 'basic',
        checked: true,
      },
      {
        id: 'map-p2-1',
        priority: 'P2',
        subtopic: 'Critérios Diagnósticos e Pontos de Corte',
        concept: `Exame inicial vs. confirmatório, rastreio e limiares diagnósticos exatos em ${title}.`,
        guidelineNote: `${cfg.priorityLabels.P2}`,
        targetCardType: 'cloze',
        checked: true,
      },
      {
        id: 'map-p3-1',
        priority: 'P3',
        subtopic: 'Terapia de 1ª Linha e Metas de Controle',
        concept: `Prescrição inicial padrão, escalonamento e metas terapêuticas de seguimento em ${title}.`,
        guidelineNote: `${cfg.priorityLabels.P3}`,
        targetCardType: 'basic',
        checked: true,
      },
      {
        id: 'map-p3-2',
        priority: 'P3',
        subtopic: 'Ajuste em Populações Especiais e Restrições',
        concept: `Conduta diferenciada em crianças, idosos, gestantes, DRC, hepatopatas ou alérgicos em ${title}.`,
        guidelineNote: 'P3 · Segurança e Individualização Terapêutica',
        targetCardType: 'cloze',
        checked: true,
      },
      {
        id: 'map-p4-1',
        priority: 'P4',
        subtopic: 'Fisiopatologia Aplicada e Diferenciais',
        concept: `Mecanismo que explica sintomas/efeitos adversos e diagnóstico diferencial gêmeo em ${title}.`,
        guidelineNote: `${cfg.priorityLabels.P4}`,
        targetCardType: 'basic',
        checked: true,
      },
    ],
    cirurgico: [
      {
        id: 'map-p1-1',
        priority: 'P1',
        subtopic: 'Critérios de Indicação Cirúrgica Imediata',
        concept: `Achados que impõem laparotomia/toracotomia/drenagem imediata vs. manejo conservador em ${title}.`,
        guidelineNote: `${cfg.priorityLabels.P1}`,
        targetCardType: 'basic',
        checked: true,
      },
      {
        id: 'map-p2-1',
        priority: 'P2',
        subtopic: 'Propedêutica Armada e Estadiamento',
        concept: `Exame de imagem de escolha (e-FAST/TC/USG/RX) e classificação operatória em ${title}.`,
        guidelineNote: `${cfg.priorityLabels.P2}`,
        targetCardType: 'cloze',
        checked: true,
      },
      {
        id: 'map-p3-1',
        priority: 'P3',
        subtopic: 'Pré-Operatório, Profilaxias e Complicações',
        concept: `Antibioticoprofilaxia, preparo, princípio técnico e manejo de complicação pós-op em ${title}.`,
        guidelineNote: `${cfg.priorityLabels.P3}`,
        targetCardType: 'basic',
        checked: true,
      },
      {
        id: 'map-p4-1',
        priority: 'P4',
        subtopic: 'Anatomia Cirúrgica Aplicada e Diferenciais',
        concept: `Reparo anatômico crítico para evitar iatrogenia e diferencial cirúrgico em ${title}.`,
        guidelineNote: `${cfg.priorityLabels.P4}`,
        targetCardType: 'basic',
        checked: true,
      },
    ],
    preventiva_normativo: [
      {
        id: 'map-p1-1',
        priority: 'P1',
        subtopic: 'Atribuições Legais, Ética e Notificação Imediata',
        concept: `Deveres ético-legais inegociáveis, responsabilidade documental e notificação urgente em ${title}.`,
        guidelineNote: `${cfg.priorityLabels.P1}`,
        targetCardType: 'basic',
        checked: true,
      },
      {
        id: 'map-p2-1',
        priority: 'P2',
        subtopic: 'Fórmulas, Critérios e Desenhos Epidemiológicos',
        concept: `Definições operacionais, métricas diagnósticas/epidemiológicas e vieses em ${title}.`,
        guidelineNote: `${cfg.priorityLabels.P2}`,
        targetCardType: 'cloze',
        checked: true,
      },
      {
        id: 'map-p3-1',
        priority: 'P3',
        subtopic: 'Fluxos do SUS, Prazos e Exceções Normativas',
        concept: `Regras práticas, calendários, prazos e exceções clássicas cobradas em prova sobre ${title}.`,
        guidelineNote: `${cfg.priorityLabels.P3}`,
        targetCardType: 'cloze',
        checked: true,
      },
      {
        id: 'map-p4-1',
        priority: 'P4',
        subtopic: 'Interpretação Crítica e Armadilhas de Banca',
        concept: `Fundamentos conceituais, interpretação de resultados e pegadinhas das bancas em ${title}.`,
        guidelineNote: `${cfg.priorityLabels.P4}`,
        targetCardType: 'basic',
        checked: true,
      },
    ],
  };

  const defaultItems = defaultByProfile[activeProfile];

  return {
    themeTitle: title,
    specialty: `Perfil: ${cfg.label} (Clínica · Cirurgia · GO · Pediatria · Preventiva)`,
    deckKey: safeKey,
    profile: activeProfile,
    guidelineUpdates: [
      `Perfil ativo (${cfg.label}): ${cfg.description}`,
      'Curadoria Matuschak & Nielsen: preservação estrita de IDs FSRS, formato fluido basic/cloze e imagens reais da web.',
    ],
    groundingSources: [],
    items: fromExisting.length > 0 ? [...fromExisting, ...defaultItems] : defaultItems,
  };
}

/**
 * Builds generic, profile-matched canonical cards when testing offline.
 * Does NOT generate synthetic SVG images.
 */
export function buildGenericCanonicalCards(
  deckKey: string,
  map: ClinicalMapResponse
): CanonicalCard[] {
  const title = formatThemeTitle(deckKey);
  const safeKey = (deckKey || 'tema_clinico').trim().toLowerCase().replace(/\s+/g, '_');
  const checked = map.items.filter((i) => i.checked);

  return checked.map((item, idx) => {
    const id = 171000101 + idx;
    if (item.targetCardType === 'cloze') {
      return {
        id,
        type: 'cloze',
        priority: item.priority,
        deck_key: safeKey,
        topic: `${title} - ${item.subtopic}`,
        question: `Em ${title.toLowerCase()}, o parâmetro decisório prioritário referente a ${item.subtopic.toLowerCase()} fundamenta-se em {{c1::critério de primeira linha}}.`,
        answer: '',
        hint: `<b>Comentário:</b> Em <b>${title.toLowerCase()}</b>, prioriza-se o critério de <b>primeira linha</b> para reduzir erro diagnóstico, diferentemente das <b>condutas de exceção</b>.`,
        tags: [safeKey, item.priority.toLowerCase()],
      };
    }

    return {
      id,
      type: 'basic',
      priority: item.priority,
      deck_key: safeKey,
      topic: `${title} - ${item.subtopic}`,
      question: `Diante de caso clínico ou normativo envolvendo ${item.subtopic.toLowerCase()} em ${title.toLowerCase()}, qual é a conduta imediata de primeira escolha?`,
      answer: 'Conduta prioritária baseada nas diretrizes vigentes.',
      hint: `<b>Comentário:</b> Em <b>${title.toLowerCase()}</b>, a <b>conduta de primeira escolha</b> previne complicações e iatrogenias, superando o <b>manejo expectante</b> inadequado.`,
      tags: [safeKey, item.priority.toLowerCase()],
    };
  });
}

/**
 * Generic sample deck used only when the user clicks "Carregar exemplo de teste".
 * Uses an unresolved local filename so real web image search fetches a real ECG automatically.
 */
export const GENERIC_SAMPLE_DECK_JSON = JSON.stringify(
  [
    {
      id: 171000101,
      type: 'basic',
      image_mode: 'recognition',
      topic: 'Emergência Clínica - Traçado Eletrocardiográfico',
      question:
        'Na Sala de Emergência, paciente de 58 anos admitido com dor torácica típica e sudorese fria realiza o exame abaixo. Qual é a conduta imediata de primeira escolha?<br><img src="ecg_anterior_stemi.jpg">',
      answer: 'Dupla antiagregação plaquetária e angioplastia primária imediata.',
      hint: '<i>ECG de 12 derivações evidenciando supradesnivelamento de ST em parede anterior.</i><br><br><b>Comentário:</b> O <b>supradesnivelamento convexo de ST</b> indica oclusão coronariana aguda e exige <b>reperfusão imediata</b>, ao contrário do IAM sem supra em que a estratificação guia o tempo invasivo.',
      tags: ['manejo_clinico_emergencia'],
    },
    {
      id: 171000102,
      type: 'cloze',
      topic: 'Decisão Diagnóstica - Propedêutica Inicial',
      question:
        'Na avaliação inicial à beira-leito do trauma abdominal fechado instável, o exame de imagem imediato de escolha é a {{c1::ultrassonografia point-of-care (e-FAST)}}.',
      answer: '',
      hint: '<b>Comentário:</b> O <b>e-FAST à beira-leito</b> identifica líquido livre rapidamente no paciente instável, ao passo que a <b>tomografia computadorizada</b> exige estabilidade hemodinâmica para transporte.',
      tags: ['manejo_clinico_emergencia'],
    },
    {
      id: 171000103,
      type: 'basic',
      topic: 'Manejo Ambulatorial - Prevenção Secundária',
      question:
        'No Ambulatório, após alta por síndrome coronariana aguda sem contraindicações, qual classe farmacológica reduz mortalidade a longo prazo e deve ser mantida continuamente?',
      answer: 'Estatina de alta potência associada a antiagregante plaquetário.',
      hint: '<b>Comentário:</b> A <b>prevenção secundária intensiva</b> estabiliza a placa aterosclerótica e reduz reinfarto, diferindo do <b>manejo exclusivamente sintomático</b> com nitratos.',
      tags: ['manejo_clinico_emergencia'],
    },
  ],
  null,
  2
);
