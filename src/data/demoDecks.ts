import { CanonicalCard, ClinicalMapResponse } from '../types/deck';
import { HIGH_PRECISION_MEDICAL_ATLAS, matchMedicalAtlasImages } from './medicalDiagnosticAtlas';

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
 * Picks a high-fidelity diagnostic medical image matching a topic or theme.
 */
export function pickFidedignaWebMedicalImage(text: string): {
  url: string;
  legend: string;
  filename: string;
} {
  const matched = matchMedicalAtlasImages(text)[0] || HIGH_PRECISION_MEDICAL_ATLAS[0];
  return {
    url: matched.thumbUrl,
    legend: matched.defaultLegend,
    filename: matched.suggestedFilename,
  };
}

/**
 * Builds a dynamic, theme-agnostic Clinical Map (P1 to P4) for any medical topic
 * when offline or when testing without a live API response.
 */
export function buildGenericClinicalMap(
  deckKey: string,
  existingCards: CanonicalCard[] = []
): ClinicalMapResponse {
  const title = formatThemeTitle(deckKey);
  const safeKey = (deckKey || 'tema_clinico').trim().toLowerCase().replace(/\s+/g, '_');

  // Extract distinct subtopics across the entire existing deck (not just the first 4 cards)
  const seenSubtopics = new Set<string>();
  const sampledExisting: CanonicalCard[] = [];
  for (const card of existingCards) {
    const rawSub = card.topic && card.topic.includes(' - ')
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
      guidelineNote: 'Auditado do deck original para lapidação Wozniak/Matuschak e rebalanceamento 50/50',
      targetCardType: (idx % 2 === 0 ? 'basic' : 'cloze') as 'basic' | 'cloze',
      checked: true,
    };
  });

  const isPartoOrObstetricia = /parto|obstetr|gesta|puerp|cardiotoco|distocia|bishop/i.test(
    `${safeKey} ${existingCards.slice(0, 10).map((c) => c.topic).join(' ')}`
  );

  const defaultItems: ClinicalMapResponse['items'] = isPartoOrObstetricia
    ? [
        {
          id: 'map-p1-1',
          priority: 'P1',
          subtopic: 'Manejo Ativo do 3º Período (Secundamento)',
          concept: 'Ocitocina 10 UI IM imediata após o desprendimento do ombro anterior e tração controlada do cordão.',
          guidelineNote: 'P1 · Prevenção de Hemorragia Pós-Parto (Diretriz OMS / FEBRASGO)',
          targetCardType: 'basic',
          checked: true,
        },
        {
          id: 'map-p1-2',
          priority: 'P1',
          subtopic: 'Distocia de Ombro e Manobra de 1ª Linha',
          concept: 'Manobra de McRoberts associada à pressão suprapúbica (Rubin I), sendo proscrita a manobra de Kristeller.',
          guidelineNote: 'P1 · Emergência Obstétrica no Período Expulsivo',
          targetCardType: 'cloze',
          checked: true,
        },
        {
          id: 'map-p2-1',
          priority: 'P2',
          subtopic: 'Critério de Fase Ativa do Trabalho de Parto (OMS)',
          concept: 'Dilatação cervical a partir de 5 cm associada a contrações uterinas regulares na abertura do partograma.',
          guidelineNote: 'P2 · Labor Care Guide OMS / Ministério da Saúde',
          targetCardType: 'cloze',
          checked: true,
        },
        {
          id: 'map-p3-1',
          priority: 'P3',
          subtopic: 'Ausculta Cardiofetal Intermitente no Período Expulsivo',
          concept: 'Ausculta de BCF a cada 15 minutos no risco habitual e a cada 5 minutos no alto risco durante o 2º período.',
          guidelineNote: 'P3 · Vigilância Fetal Intraparto (MS / FEBRASGO)',
          targetCardType: 'basic',
          checked: true,
        },
        {
          id: 'map-p4-1',
          priority: 'P4',
          subtopic: 'Estática Fetal, Planos de DeLee e Mecanismo de Parto',
          concept: 'Insinuação definida pela passagem do diâmetro biparietal pelo estreito superior (Plano 0 de DeLee nas espinhas isquiáticas).',
          guidelineNote: 'P4 · Obstetrícia Paulista (USP / Unicamp)',
          targetCardType: 'cloze',
          checked: true,
        },
      ]
    : [
        {
          id: 'map-p1-1',
          priority: 'P1',
          subtopic: 'Sinais de Alarme e Estabilização Imediata',
          concept: `Estabilização hemodinâmica e conduta salvadora de 1ª linha no minuto zero em ${title}.`,
          guidelineNote: 'P1 · Urgência / Emergência / Minuto Zero (Tripla Ancoragem)',
          targetCardType: 'basic',
          checked: true,
        },
        {
          id: 'map-p1-2',
          priority: 'P1',
          subtopic: 'Refratariedade, 2ª Linha e Contraindicações',
          concept: `Intervenção dirigida de segunda linha diante de refratariedade em ${title}.`,
          guidelineNote: 'P1 · Duplo Salto Cognitivo na Refratariedade',
          targetCardType: 'cloze',
          checked: true,
        },
        {
          id: 'map-p2-1',
          priority: 'P2',
          subtopic: 'Reconhecimento Visual e Exame Padrão-Ouro',
          concept: `Interpretação de imagem diagnóstica fidedigna e conduta imediata em ${title}.`,
          guidelineNote: 'P2 · Imagem Médica Fidedigna (Offline em collection.media)',
          targetCardType: 'basic',
          checked: true,
        },
        {
          id: 'map-p3-1',
          priority: 'P3',
          subtopic: 'Manejo Ambulatorial, Profilaxia e Populações Especiais',
          concept: `Terapia de manutenção, profilaxia específica e ajuste em populações especiais em ${title}.`,
          guidelineNote: 'P3 · Enfermaria / UBS / Prevenção',
          targetCardType: 'cloze',
          checked: true,
        },
        {
          id: 'map-p4-1',
          priority: 'P4',
          subtopic: 'Mecanismo Clínico Aplicado e Diagnóstico Diferencial',
          concept: `Correlação fisiopatológica e diagnóstico diferencial prioritário em ${title}.`,
          guidelineNote: 'P4 · Fisiopatologia Aplicada e Radar Paulista',
          targetCardType: 'basic',
          checked: true,
        },
      ];

  return {
    themeTitle: title,
    specialty: isPartoOrObstetricia
      ? 'Ginecologia e Obstetrícia (Internato · Diretrizes OMS / FEBRASGO / MS)'
      : 'Qualquer Especialidade (Clínica · Cirurgia · GO · Pediatria · Preventiva)',
    deckKey: safeKey,
    guidelineUpdates: [
      `Diretrizes atualizadas aplicadas a ${title}: priorizar pontos de corte diagnósticos exatos, estratificação de gravidade e fármacos de 1ª escolha.`,
      'Liberdade total de curadoria: poda de cards redundantes (excluindo IDs fracos), adição de novos IDs para lacunas P1–P4 e rebalanceamento rigoroso 50% basic / 50% cloze.',
    ],
    groundingSources: [],
    items: fromExisting.length > 0 ? [...fromExisting, ...defaultItems] : defaultItems,
  };
}

/**
 * Builds generic, theme-matched canonical cards following Tripla Ancoragem
 * and desktop lint.py rules when testing offline or without an API key.
 */
export function buildGenericCanonicalCards(
  deckKey: string,
  map: ClinicalMapResponse
): CanonicalCard[] {
  const title = formatThemeTitle(deckKey);
  const safeKey = (deckKey || 'tema_clinico').trim().toLowerCase().replace(/\s+/g, '_');
  const checked = map.items.filter((i) => i.checked);
  const webImg = pickFidedignaWebMedicalImage(deckKey);

  return checked.map((item, idx) => {
    const id = 171000101 + idx;
    if (item.targetCardType === 'cloze') {
      return {
        id,
        type: 'cloze',
        priority: item.priority,
        deck_key: safeKey,
        topic: `${title} - ${item.subtopic}`,
        question: `No manejo de ${title.toLowerCase()} em casos refratários à terapia inicial, a conduta escalonada de escolha é {{c1::intervenção dirigida de segunda linha}}.`,
        answer: '',
        hint: `<b>Comentário:</b> Em <b>${title.toLowerCase()}</b>, a <b>intervenção de 2ª linha</b> é reservada à refratariedade documentada, diferentemente da <b>estabilização inicial</b> indicada no minuto zero.`,
        tags: [safeKey, item.priority.toLowerCase()],
      };
    }

    // Make P2 cards use image_mode: "recognition" with an embedded offline medical image
    if (item.priority === 'P2') {
      return {
        id,
        type: 'basic',
        priority: 'P2',
        deck_key: safeKey,
        image_mode: 'recognition',
        topic: `${title} - ${item.subtopic}`,
        question: `No Pronto-Socorro, paciente adulto com suspeita de ${title.toLowerCase()} realiza o exame complementar abaixo. Diante deste achado visual, qual a conduta imediata de primeira escolha?<br><img src="${webImg.url}" data-anki-file="${webImg.filename}">`,
        answer: 'Intervenção específica imediata guiada pelo achado de imagem.',
        hint: `<i>${webImg.legend}</i><br><br><b>Comentário:</b> O <b>reconhecimento imediato do padrão de imagem</b> em <b>${title.toLowerCase()}</b> autoriza conduta definitiva precoce, superando a <b>conduta expectante</b>.`,
        tags: [safeKey, 'p2', 'recognition'],
      };
    }

    return {
      id,
      type: 'basic',
      priority: item.priority,
      deck_key: safeKey,
      topic: `${title} - ${item.subtopic}`,
      question: `Na Sala de Emergência, paciente adulto apresenta quadro agudo de ${title.toLowerCase()} associado a sinais vitais de instabilidade clínica. Qual a conduta imediata de estabilização (minuto zero)?`,
      answer: 'Estabilização hemodinâmica imediata e terapia específica de primeira linha.',
      hint: `<b>Comentário:</b> No manejo agudo de <b>${title.toLowerCase()}</b>, a <b>intervenção no minuto zero</b> reduz mortalidade precoce, superando a <b>conduta expectante</b> restrita aos pacientes estáveis.`,
      tags: [safeKey, item.priority.toLowerCase()],
    };
  });
}

/**
 * Generic multi-specialty sample deck used only when the user clicks "Carregar exemplo de teste".
 * Includes a clean diagnostic plate (zero text spoilers) with local Anki filename binding.
 */
export const GENERIC_SAMPLE_DECK_JSON = JSON.stringify(
  [
    {
      id: 171000101,
      type: 'basic',
      image_mode: 'recognition',
      topic: 'Emergência Clínica - Estabilização Inicial e Droga',
      question: `Na Sala de Emergência, paciente de 58 anos admitido com dor torácica típica e sudorese fria realiza o exame abaixo (iniciar droga de primeira linha). Qual a hipótese e a conduta? <img src="${HIGH_PRECISION_MEDICAL_ATLAS[0].thumbUrl}" data-anki-file="${HIGH_PRECISION_MEDICAL_ATLAS[0].suggestedFilename}">`,
      answer:
        'Instabilidade aguda; realizar dupla antiagregação plaquetária e reperfusão coronariana imediata por angioplastia primária.',
      hint: '<i>ECG de 12 derivações evidenciando supradesnivelamento de ST em parede anterior.</i><br><br>Iniciar reperfusão rápida no minuto zero.',
      tags: ['manejo_clinico_emergencia'],
    },
    {
      id: 171000102,
      type: 'cloze',
      topic: 'Decisão Diagnóstica - Critério Confirmatório',
      question:
        'Na investigação diagnóstica inicial à beira-leito no trauma abdominal fechado instável, o exame de escolha na urgência é {{c1::avaliação ultrassonográfica point-of-care realizada imediatamente::exame rápido}} associada a {{c2::gasometria arterial}}.',
      answer: 'Ultrassonografia point-of-care.',
      hint: '<b>Comentário:</b> O <b>exame FAST à beira-leito</b> permite decisão cirúrgica rápida em pacientes instáveis, ao passo que a <b>tomografia computadorizada</b> exige estabilidade hemodinâmica para transporte.',
      tags: ['manejo_clinico_emergencia'],
    },
    {
      id: 171000103,
      type: 'basic',
      topic: 'Manejo Ambulatorial - Prevenção Secundária',
      question:
        'No Ambulatório, após compensação clínica e alta hospitalar, qual o tratamento medicamentoso de primeira escolha para prevenção de recorrência?',
      answer: 'Terapia de manutenção contínua e controle estrito de fatores de risco.',
      hint: '<b>Comentário:</b> O <b>seguimento ambulatorial estruturado</b> reduz taxas de readmissão precoce, diferenciando-se do <b>manejo exclusivamente sintomático</b> que não altera a história natural da condição.',
      tags: ['manejo_clinico_emergencia'],
    },
  ],
  null,
  2
);
