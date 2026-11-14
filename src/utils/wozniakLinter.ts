import {
  CanonicalCard,
  CardLintMetrics,
  CardLintResult,
  ClinicalMapResponse,
  DeckCurationStats,
  ExtractedDeckMetadata,
  LinterWarning,
  MediaBundleItem,
} from '../types/deck';

export const MAX_CLOZE_WORDS = 5;
export const MAX_BASIC_ANSWER_WORDS = 15;
export const MAX_BASIC_ANSWER_CHARS = 110;
export const MAX_QUESTION_WORDS = 50;
export const MAX_COMMENT_CHARS = 320;

const DANGLING_STOPWORDS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'contra', 'da', 'das', 'de', 'do', 'dos',
  'e', 'em', 'entre', 'na', 'nas', 'no', 'nos', 'o', 'os', 'ou', 'para',
  'pela', 'pelas', 'pelo', 'pelos', 'por', 'que', 'se', 'sem', 'sob', 'sobre', 'um', 'uma',
]);

const PROHIBITED_CLOZE_HINTS = new Set([
  'fármaco', 'farmaco', 'droga', 'conduta', 'classe', 'substância', 'substancia',
  'momento', 'tempo', 'dose', 'quantidade', 'número', 'numero', 'derivações',
  'derivacoes', 'valor', 'valores', 'critério', 'criterio', 'aumento', 'diminuição', 'diminuicao',
]);

const MEDICAL_UNITS_AND_STOPWORDS = new Set([
  'para', 'com', 'sem', 'por', 'que', 'dos', 'das', 'uma', 'como', 'mais', 'menos',
  'qual', 'quais', 'onde', 'quando', 'caso', 'sobre', 'entre', 'apos', 'antes',
  'anos', 'ano', 'dias', 'dia', 'meses', 'mes', 'horas', 'hora', 'minutos', 'minuto',
  'segundos', 'segundo', 'grau', 'tipo', 'fase', 'nivel', 'risco', 'dose', 'doses',
  'sao', 'este', 'esta', 'isto', 'esses', 'essas', 'pelo', 'pela', 'pelos', 'pelas',
  'mmhg', 'bpm', 'cpm', 'mg', 'mcg', 'kg', 'ml', 'cm', 'mm', 'meq', 'meql', 'ui',
  'se', 'ou', 'nao', 'sim', 'uso', 'via', 'oral', 'intravenosa', 'intramuscular',
  'paciente', 'quadro', 'clinico', 'clinica', 'medica', 'medico', 'emergencia', 'urgencia',
  'conduta', 'tratamento', 'manejo', 'exame', 'avaliacao', 'resposta',
  'diagnostico', 'inicial', 'primeira', 'segunda', 'linha', 'escolha', 'sindrome',
  'doenca', 'agudo', 'aguda', 'cronico', 'cronica', 'grave', 'leve', 'moderado', 'moderada',
]);

const SYNONYM_SPOILERS: Record<string, string[]> = {
  adrenalina: ['epinefrina'],
  epinefrina: ['adrenalina'],
  noradrenalina: ['norepinefrina'],
  norepinefrina: ['noradrenalina'],
  vasopressina: ['adh'],
  adh: ['vasopressina'],
};

const MEDICAL_ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bdiagnóstico\b/g, 'dx'],
  [/\bDiagnóstico\b/g, 'Dx'],
  [/\btratamento\b/g, 'tto'],
  [/\bTratamento\b/g, 'Tto'],
  [/\bpaciente\b/g, 'pcte'],
  [/\bpacientes\b/g, 'pctes'],
  [/\bPaciente\b/g, 'Pcte'],
  [/\bantibioticoterapia\b/g, 'ATB'],
  [/\binsuficiência cardíaca\b/gi, 'IC'],
  [/\binsuficiência renal\b/gi, 'IR'],
  [/\bfrequência cardíaca\b/gi, 'FC'],
  [/\bpressão arterial\b/gi, 'PA'],
  [/\bultrassonografia\b/gi, 'USG'],
  [/\btomografia computadorizada\b/gi, 'TC'],
  [/\bressonância magnética\b/gi, 'RM'],
  [/\bversus\b/gi, 'vs.'],
  [/\bpor exemplo\b/gi, 'ex.'],
  [/\bmaior ou igual a\b/gi, '≥'],
  [/\bmenor ou igual a\b/gi, '≤'],
];

const LATEX_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\\ge(?:q)?\b/g, '≥'],
  [/\\le(?:q)?\b/g, '≤'],
  [/\\rightarrow\b|\\to\b/g, '→'],
  [/\\leftarrow\b/g, '←'],
  [/\\pm\b/g, '±'],
  [/\\times\b/g, '×'],
  [/\\alpha\b/g, 'α'],
  [/\\beta\b/g, 'β'],
  [/\\gamma\b/g, 'γ'],
  [/\\Delta\b/g, 'Δ'],
  [/\\mu\b/g, 'μ'],
];

/**
 * Strips Cloze syntax {{c1::texto::dica}} -> texto so visible text is measured accurately.
 */
export function stripClozeMarkup(text: string): string {
  if (!text) return '';
  return text.replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, (_m, inner: string) => {
    return (inner || '').split('::')[0] || '';
  });
}

/**
 * Strips HTML tags and normalizes whitespace to measure visible characters (matching lint.visible_text).
 */
export function stripHtml(htmlText: string): string {
  if (!htmlText) return '';
  const withoutAudio = htmlText.replace(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi, ' ');
  return withoutAudio
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts only the visible text after <b>Comentário:</b> (excluding <table>, <img>, <i> legend, and <audio>),
 * matching lint.py and refiner.py.
 */
export function extractCommentVisibleText(hint: string): string {
  if (!hint) return '';
  let cleaned = hint.replace(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi, ' ');
  cleaned = cleaned.replace(/<table[\s\S]*?<\/table>/gi, ' ');
  const parts = cleaned.split(/Coment[áa]rio:/i);
  const afterComment = parts.length > 1 ? parts.slice(1).join('Comentário:') : cleaned;
  return stripHtml(afterComment);
}

/**
 * Counts words in visible text.
 */
export function countWords(text: string): number {
  const cleaned = stripHtml(stripClozeMarkup(text));
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

/**
 * Extracts all <img src="...">, <audio ...> and [sound:...] media references from any string.
 */
export function extractMediaFromString(input: string): string[] {
  if (!input) return [];
  const results: string[] = [];
  const imgRegex = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  const audioTagRegex = /<audio\b[^>]*>[\s\S]*?<\/audio>|<audio\b[^>]*\/?>/gi;
  const soundAnkiRegex = /\[sound:[^\]]+\]/gi;

  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(input)) !== null) {
    results.push(match[0]);
  }
  while ((match = audioTagRegex.exec(input)) !== null) {
    results.push(match[0]);
  }
  while ((match = soundAnkiRegex.exec(input)) !== null) {
    results.push(match[0]);
  }
  return results;
}

/**
 * Resolves a deterministic local filename for Anki's collection.media folder from any <img> tag or URL/Data-URI.
 * Ensures that exported Anki cards never point to volatile external https:// URLs or raw inline base64 strings.
 */
export function resolveLocalMediaFilename(
  rawImgTag: string,
  rawSrc: string,
  cardId: number,
  imgIndex: number = 0,
  deckKey: string = 'deck'
): string {
  const cleanDeck = (deckKey || 'deck')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_') || 'deck';

  // 1. Check explicit data-anki-file attribute if present
  const attrMatch = rawImgTag.match(/\bdata-anki-file=["']([^"']+)["']/i);
  if (attrMatch && attrMatch[1]) {
    const cleanAttr = attrMatch[1]
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '_');
    if (cleanAttr) return cleanAttr;
  }

  const src = (rawSrc || '').trim();
  // 2. If already a local filename (not http/https/data/blob)
  if (src && !/^(?:https?:|data:|blob:|\/)/i.test(src)) {
    const base = src.split(/[\\/]/).pop() || src;
    return base.replace(/[^a-zA-Z0-9_.-]+/g, '_');
  }

  // 3. If data URI
  if (src.startsWith('data:image/svg')) {
    return `${cleanDeck}_${cardId}_img${imgIndex + 1}.svg`;
  }
  if (src.startsWith('data:image/png')) {
    return `${cleanDeck}_${cardId}_img${imgIndex + 1}.png`;
  }
  if (src.startsWith('data:image/webp')) {
    return `${cleanDeck}_${cardId}_img${imgIndex + 1}.webp`;
  }
  if (src.startsWith('data:image/')) {
    return `${cleanDeck}_${cardId}_img${imgIndex + 1}.jpg`;
  }

  // 4. If external http(s) URL, derive a clean local filename
  if (/^https?:\/\//i.test(src)) {
    try {
      const u = new URL(src);
      const rawLast = decodeURIComponent(u.pathname.split('/').pop() || '')
        .replace(/^\d+px-/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, '_')
        .replace(/^_+|_+$/g, '');
      if (rawLast && /\.(?:jpg|jpeg|png|svg|webp|gif)$/i.test(rawLast)) {
        return rawLast.slice(0, 72);
      }
    } catch {
      // Fallback below
    }
  }

  return `${cleanDeck}_${cardId}_img${imgIndex + 1}.jpg`;
}

/**
 * Rewrites all <img ...> tags in an HTML string so that src points strictly to the local
 * collection.media filename (e.g. <img src="ecg_iam_supradesnivelamento_st.svg">) with no external https:// links.
 */
export function rewriteHtmlImgsToLocalAnki(
  htmlText: string,
  cardId: number,
  deckKey: string = 'deck'
): string {
  if (!htmlText) return '';
  let idx = 0;
  return htmlText.replace(
    /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
    (fullTag, srcVal: string) => {
      const localName = resolveLocalMediaFilename(fullTag, srcVal, cardId, idx++, deckKey);
      return `<img src="${localName}">`;
    }
  );
}

/**
 * Extracts a manifest of all images across the deck with their local Anki filenames and source URLs/data-URIs
 * so they can be downloaded and embedded into collection.media / 04_Mídias on export.
 */
export function extractDeckMediaManifest(
  cards: CanonicalCard[],
  deckKey: string = 'deck'
): MediaBundleItem[] {
  const seen = new Set<string>();
  const items: MediaBundleItem[] = [];

  for (const card of cards) {
    const fields: Array<['question' | 'hint', string]> = [
      ['question', card.question || ''],
      ['hint', card.hint || ''],
    ];

    for (const [fieldName, htmlText] of fields) {
      let idx = 0;
      const regex = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(htmlText)) !== null) {
        const fullTag = match[0];
        const srcVal = match[1];
        const filename = resolveLocalMediaFilename(fullTag, srcVal, card.id, idx++, deckKey);
        if (!seen.has(filename)) {
          seen.add(filename);
          items.push({
            filename,
            sourceUrl: srcVal,
            cardId: card.id,
            field: fieldName,
          });
        }
      }
    }
  }

  return items;
}

/**
 * Parses an uploaded or pasted *_notes.json string and extracts existing FSRS numeric IDs
 * and media references (<img src="..."> / <audio>).
 */
export function extractDeckMetadata(rawJsonText: string): ExtractedDeckMetadata {
  const empty: ExtractedDeckMetadata = {
    existingIds: [],
    mediaTags: [],
    detectedDeckKey: '',
    rawCards: [],
  };

  if (!rawJsonText || !rawJsonText.trim()) {
    return empty;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJsonText);
  } catch {
    throw new Error('JSON inválido. Verifique a sintaxe do arquivo *_notes.json.');
  }

  let rawCards: Record<string, unknown>[] = [];
  let detectedDeckKey = '';
  const mediaSet = new Set<string>();
  const existingIds: number[] = [];

  if (Array.isArray(parsed)) {
    rawCards = parsed.filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === 'object')
    );
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.deck_key === 'string') {
      detectedDeckKey = obj.deck_key;
    } else if (typeof obj.deckKey === 'string') {
      detectedDeckKey = obj.deckKey;
    } else if (typeof obj.key === 'string') {
      detectedDeckKey = obj.key;
    }

    const candidateArray =
      (Array.isArray(obj.notes) && obj.notes) ||
      (Array.isArray(obj.cards) && obj.cards) ||
      (Array.isArray(obj.items) && obj.items) ||
      [];
    rawCards = candidateArray.filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === 'object')
    );
  }

  const normalizedCards: CanonicalCard[] = rawCards.map((card, idx) => {
    const rawId = card.id ?? card.note_id ?? card.guid;
    let numericId = typeof rawId === 'number' ? rawId : Number(rawId);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      numericId = 171000100 + idx + 1;
    }
    existingIds.push(numericId);

    const question =
      typeof card.question === 'string'
        ? card.question
        : typeof card.front === 'string'
        ? card.front
        : '';
    const answer =
      typeof card.answer === 'string'
        ? card.answer
        : typeof card.back === 'string'
        ? card.back
        : '';
    const hint =
      typeof card.hint === 'string'
        ? card.hint
        : typeof card.comment === 'string'
        ? card.comment
        : '';
    const topic =
      typeof card.topic === 'string' ? card.topic : 'Clínica Médica - Conduta';
    const hasCloze = /\{\{c\d+::/.test(question);
    const type = card.type === 'cloze' || hasCloze ? 'cloze' : 'basic';

    if (!detectedDeckKey && Array.isArray(card.tags) && typeof card.tags[0] === 'string') {
      detectedDeckKey = card.tags[0].trim();
    } else if (!detectedDeckKey && typeof card.deck_key === 'string' && card.deck_key.trim()) {
      detectedDeckKey = card.deck_key.trim();
    }

    [question, answer, hint].forEach((fieldVal) => {
      extractMediaFromString(fieldVal).forEach((m) => mediaSet.add(m));
    });

    const imageMode =
      card.image_mode === 'recognition' || card.image_mode === 'feedback'
        ? card.image_mode
        : undefined;

    return {
      id: numericId,
      type,
      topic,
      question,
      answer: type === 'cloze' ? (typeof card.answer === 'string' ? card.answer : '') : answer,
      hint,
      tags: Array.isArray(card.tags)
        ? (card.tags.filter((t) => typeof t === 'string') as string[])
        : undefined,
      image_mode: imageMode,
      exam_refs: Array.isArray(card.exam_refs) ? card.exam_refs : undefined,
      last_synced_hash:
        typeof card.last_synced_hash === 'string' ? card.last_synced_hash : undefined,
      priority:
        card.priority === 'P1' ||
        card.priority === 'P2' ||
        card.priority === 'P3' ||
        card.priority === 'P4'
          ? card.priority
          : undefined,
    };
  });

  return {
    existingIds,
    mediaTags: Array.from(mediaSet),
    detectedDeckKey,
    rawCards: normalizedCards,
  };
}

function normalizeForSpoiler(text: string): string {
  return stripHtml(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractCoreKeywords(text: string): string[] {
  const norm = normalizeForSpoiler(text);
  if (!norm) return [];
  return norm
    .split(/\s+/)
    .filter((w) => w.length > 3 && !MEDICAL_UNITS_AND_STOPWORDS.has(w));
}

function expandWithSynonyms(words: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const w of words) {
    out.add(w);
    const syns = SYNONYM_SPOILERS[w];
    if (syns) {
      syns.forEach((s) => out.add(s));
    }
  }
  return out;
}

/**
 * Evaluates a single card against all rules from lint.py, DIRETRIZ_CRIACAO_DE_CARDS.md, and SYSTEM_PROMPT_CRIADOR.md.
 */
export function lintCard(card: CanonicalCard): CardLintResult {
  const warnings: LinterWarning[] = [];
  const questionText = card.question || '';
  const answerText = card.answer || '';
  const hintText = card.hint || '';
  const topicText = card.topic || '';

  // 1. Measure question, answer & comment lengths
  const questionWordCount = countWords(questionText);
  const visibleAnswer = stripHtml(answerText);
  const answerWordCount = card.type === 'basic' ? countWords(answerText) : 0;
  const answerCharCount = visibleAnswer.length;
  const commentVisibleCharCount = extractCommentVisibleText(hintText).length;

  if (questionWordCount > MAX_QUESTION_WORDS) {
    warnings.push({
      code: 'QUESTION_TOO_LONG',
      field: 'question',
      severity: 'warning',
      message: `Enunciado com ${questionWordCount} palavras (Anti-Pattern-Matching Matuschak: máx. ${MAX_QUESTION_WORDS} palavras).`,
    });
  }

  // 2. Check duplicate topic bold prefix in question
  const visibleTopic = stripHtml(topicText);
  if (visibleTopic) {
    const mPrefix = questionText.match(/^\s*(?:\*\*|<b>)([\s\S]*?)(?:\*\*|<\/b>)[:.]?\s*/i);
    if (mPrefix && mPrefix[1]) {
      const pfx = stripHtml(mPrefix[1]).toLowerCase();
      const topClean = visibleTopic.toLowerCase();
      const subtop = topClean.includes(' - ')
        ? topClean.split(' - ').pop()!.trim()
        : topClean;
      if (
        pfx === topClean ||
        pfx === subtop ||
        (pfx.length > 5 &&
          (topClean.includes(pfx) || pfx.includes(topClean) || subtop.includes(pfx) || pfx.includes(subtop)))
      ) {
        warnings.push({
          code: 'TOPIC_DUPLICATED_IN_QUESTION',
          field: 'question',
          severity: 'error',
          message: `A pergunta inicia repetindo o tópico "${stripHtml(mPrefix[1])}" em negrito.`,
        });
      }
    }
  }

  // 3. Check unrendered LaTeX / MathJax syntax ($ or \command)
  const allFieldsText = `${questionText} ${answerText} ${hintText} ${topicText}`;
  if (/\$/.test(allFieldsText) || /\\[a-zA-Z([]/.test(allFieldsText)) {
    warnings.push({
      code: 'LATEX_PROHIBITED',
      field: 'question',
      severity: 'error',
      message:
        'Sintaxe LaTeX/MathJax não renderizada ("$" ou "\\"). Use caracteres Unicode diretos (≥, ≤, β, α, →).',
    });
  }

  // 4. Check obsolete FDA pregnancy category (A, B, C, D, X)
  if (/\bcategoria\s+[ABCDX]\b/i.test(allFieldsText)) {
    warnings.push({
      code: 'FDA_OBSOLETE_CATEGORY',
      field: 'hint',
      severity: 'warning',
      message: 'Evite categorias obsoletas da FDA (A/B/C/D/X); descreva o risco teratogênico específico.',
    });
  }

  // 5. Measure cloze occurrences & words
  const clozeRegex = /\{\{c(\d+)::([\s\S]*?)\}\}/g;
  const clozeMatches = Array.from(questionText.matchAll(clozeRegex));
  const clozeCount = clozeMatches.length;
  let maxClozeWords = 0;
  const clozeTargets: string[] = [];

  for (const match of clozeMatches) {
    const inner = match[2] || '';
    const parts = inner.split('::');
    const targetText = (parts[0] || '').trim();
    clozeTargets.push(targetText);
    const wordsList = stripHtml(targetText).split(/\s+/).filter(Boolean);
    const wCount = wordsList.length;
    if (wCount > maxClozeWords) {
      maxClozeWords = wCount;
    }

    if (wCount >= 3 && DANGLING_STOPWORDS.has(wordsList[wordsList.length - 1].toLowerCase())) {
      warnings.push({
        code: 'CLOZE_DANGLING_PARTICLE',
        field: 'question',
        severity: 'error',
        message: `Lacuna cloze termina com partícula truncada ("${wordsList[wordsList.length - 1]}").`,
      });
    }

    if (parts.length > 1) {
      const dica = (parts[1] || '').trim().toLowerCase();
      const hasProhibitedDica =
        Array.from(PROHIBITED_CLOZE_HINTS).some((h) => dica.includes(h)) ||
        dica.includes(' ou ') ||
        dica.length > 0;
      if (hasProhibitedDica) {
        warnings.push({
          code: 'CLOZE_HAS_HINT',
          field: 'question',
          severity: 'error',
          message: `Proibido usar ::dica dentro da lacuna {{c1::...}} (encontrado "::${parts[1]}").`,
        });
      }
    }

    if (match[1] !== '1') {
      warnings.push({
        code: 'CLOZE_COUNT_INVALID',
        field: 'question',
        severity: 'error',
        message: `Usar estritamente {{c1::...}} (encontrado {{c${match[1]}::...}}).`,
      });
    }
  }

  // Check post-cloze parenthetical crutch e.g. {{c1::...}} (critérios)
  if (/\{\{c\d+::[\s\S]*?\}\}\s*\((?:crit[eé]rios?|pontos?|dias?|anos?|itens?|sinais?)\)/i.test(questionText)) {
    warnings.push({
      code: 'CLOZE_HAS_HINT',
      field: 'question',
      severity: 'warning',
      message: 'Evite muletas pós-lacuna entre parênteses como "{{c1::...}} (critérios)".',
    });
  }

  // 6. Basic vs Cloze specific rules
  if (card.type === 'basic') {
    if (answerWordCount === 0) {
      warnings.push({
        code: 'ANSWER_TOO_LONG',
        field: 'answer',
        severity: 'error',
        message: 'Card basic exige resposta preenchida (1 a 12 palavras, máx 15).',
      });
    } else if (answerWordCount > MAX_BASIC_ANSWER_WORDS || answerCharCount > MAX_BASIC_ANSWER_CHARS) {
      warnings.push({
        code: 'ANSWER_TOO_LONG',
        field: 'answer',
        severity: 'error',
        message: `Resposta excede o teto de Wozniak (${answerWordCount}/${MAX_BASIC_ANSWER_WORDS} palavras, ${answerCharCount}/${MAX_BASIC_ANSWER_CHARS} chars).`,
      });
    }

    if (visibleAnswer.includes(';')) {
      warnings.push({
        code: 'ANSWER_HAS_SEMICOLON',
        field: 'answer',
        severity: 'error',
        message: 'Proibido conter ponto-e-vírgula (;) na resposta basic (Princípio da Informação Mínima).',
      });
    }

    if (visibleAnswer.length > 0 && !visibleAnswer.endsWith('.')) {
      warnings.push({
        code: 'ANSWER_MISSING_PERIOD',
        field: 'answer',
        severity: 'warning',
        message: 'A resposta em card basic deve terminar com ponto final (.).',
      });
    }

    const trimmedRawAnswer = answerText.trim();
    if (
      /^<(b|strong)\b[^>]*>[\s\S]*<\/\1>\.?$/i.test(trimmedRawAnswer) ||
      /^Resposta:/i.test(visibleAnswer)
    ) {
      warnings.push({
        code: 'ANSWER_OUTER_BOLD',
        field: 'answer',
        severity: 'warning',
        message: 'Proibido envolver toda a resposta basic em <b> externo ou iniciar com "Resposta:".',
      });
    }

    const visQ = stripHtml(questionText);
    if (/\bqual\s+(?:é\s+)?a\s+conduta\s*\?\s*$/i.test(visQ)) {
      warnings.push({
        code: 'VAGUE_TEMPORAL_WINDOW',
        field: 'question',
        severity: 'warning',
        message:
          'Especifique a janela temporal na pergunta ("Qual é a conduta imediata de minuto zero?" ou "Qual o tratamento definitivo?").',
      });
    }
  } else if (card.type === 'cloze') {
    if (clozeCount !== 1) {
      warnings.push({
        code: 'CLOZE_COUNT_INVALID',
        field: 'question',
        severity: 'error',
        message: `Card cloze deve conter estritamente 1 lacuna {{c1::...}} (encontradas: ${clozeCount}).`,
      });
    }
    if (maxClozeWords > MAX_CLOZE_WORDS) {
      warnings.push({
        code: 'CLOZE_TOO_LONG',
        field: 'question',
        severity: 'error',
        message: `Lacuna cloze excede ${MAX_CLOZE_WORDS} palavras (${maxClozeWords}/${MAX_CLOZE_WORDS} palavras).`,
      });
    }
    if (answerText.trim() !== '') {
      warnings.push({
        code: 'CLOZE_NON_EMPTY_ANSWER',
        field: 'answer',
        severity: 'error',
        message: 'Em cards cloze, o campo "answer" deve ser estritamente vazio ("").',
      });
    }
  }

  // 7. Compound question check
  const visibleQuestion = stripHtml(stripClozeMarkup(questionText));
  const qWithoutVf = visibleQuestion.replace(/\[?\s*verdadeiro\s+ou\s+falso\??\s*\]?/gi, '');
  const questionMarkCount = (qWithoutVf.match(/\?/g) || []).length;
  const compoundRegex1 = /\bqual\b[^?]{3,65}\be\s+(?:qual|quais|como|quando|onde)\b/i;
  const compoundRegex2 =
    /\bqual\s+(?:é\s+)?(?:o|a|os|as)?\s*(?:diagn[oó]stico|hip[oó]tese|agente|etiologia|classifica[cç][aã]o|est[aá]gio)\s+e\s+(?:qual\s+)?(?:a\s+|o\s+)?(?:conduta|tratamento|manejo|exame|droga|terapia)\b/i;
  const hasCompoundQuestion =
    questionMarkCount > 1 ||
    compoundRegex1.test(visibleQuestion) ||
    compoundRegex2.test(visibleQuestion);

  if (hasCompoundQuestion) {
    warnings.push({
      code: 'COMPOUND_QUESTION',
      field: 'question',
      severity: 'error',
      message:
        'Pergunta composta detectada. Aplique Duplo Salto Cognitivo Implícito (pergunte apenas 1 conduta atômica).',
    });
  }

  // 8. Topic format & Topic spoiler (with synonym expansion from lint.py)
  if (!visibleTopic.includes(' - ') || (visibleTopic.length > 3 && visibleTopic === visibleTopic.toUpperCase())) {
    warnings.push({
      code: 'TOPIC_FORMAT',
      field: 'topic',
      severity: 'warning',
      message: 'O campo "topic" deve seguir o formato "Tema - Subtema", sem caixa alta total.',
    });
  }

  const topicWords = expandWithSynonyms(extractCoreKeywords(topicText));
  const targetAnswerString = card.type === 'basic' ? visibleAnswer : clozeTargets.join(' ');
  const targetKeywords = extractCoreKeywords(targetAnswerString);

  let hasTopicSpoiler = false;
  if (targetKeywords.length > 0 && topicWords.size > 0) {
    const matchedKws = targetKeywords.filter((kw) => topicWords.has(kw));
    if (
      matchedKws.length === targetKeywords.length ||
      (targetKeywords.length >= 2 && matchedKws.length / targetKeywords.length >= 0.65) ||
      matchedKws.some((kw) => kw.length >= 5)
    ) {
      hasTopicSpoiler = true;
      warnings.push({
        code: 'TOPIC_SPOILER',
        field: 'topic',
        severity: 'error',
        message: `Spoiler no topic: entrega termo da resposta ("${matchedKws[0]}").`,
      });
    }
  }

  // 9. Parenthetical spoiler in question (matching lint.detect_parenthesis_spoiler)
  const questionWithoutCloze = questionText.replace(/\{\{c\d+::[\s\S]*?\}\}/g, ' __CLOZE__ ');
  const parensMatches = Array.from(questionWithoutCloze.matchAll(/\(([^)]+)\)/g));
  const targetNorm = normalizeForSpoiler(targetAnswerString);

  for (const pm of parensMatches) {
    const pText = (pm[1] || '').trim();
    const pNorm = normalizeForSpoiler(pText);
    if (!pNorm) continue;
    const pWords = expandWithSynonyms(pNorm.split(/\s+/));
    const exactLeak =
      targetNorm.length > 0 &&
      (targetNorm === pNorm || (targetNorm.length > 4 && pNorm.includes(targetNorm)));
    const keywordLeak =
      targetKeywords.length >= 1 &&
      (targetKeywords.every((kw) => pWords.has(kw)) ||
        targetKeywords.some((kw) => kw.length >= 5 && pWords.has(kw)));
    if (exactLeak || keywordLeak) {
      warnings.push({
        code: 'QUESTION_PAREN_SPOILER',
        field: 'question',
        severity: 'error',
        message: `Spoiler entre parênteses no enunciado: "(${pText})" antecipa a resposta.`,
      });
      break;
    }
  }

  // 10. Image mode recognition validation (from lint.py)
  if (card.image_mode === 'recognition') {
    if (card.type !== 'basic' || !/<img\b/i.test(questionText)) {
      warnings.push({
        code: 'RECOGNITION_MISMATCH',
        field: 'question',
        severity: 'error',
        message: 'image_mode "recognition" exige card basic com <img src="..."> na pergunta.',
      });
    }
    if (!/<i>[\s\S]*?<\/i>/i.test(hintText)) {
      warnings.push({
        code: 'RECOGNITION_MISMATCH',
        field: 'hint',
        severity: 'warning',
        message:
          'Cards recognition devem trazer <i>Descrição do achado visual...</i> no início do hint.',
      });
    }
    if (/<img\b/i.test(questionText) && /<img\b/i.test(hintText)) {
      warnings.push({
        code: 'RECOGNITION_MISMATCH',
        field: 'hint',
        severity: 'warning',
        message:
          'Não repita a mesma tag <img> no hint de cards recognition (use apenas a legenda <i>...</i>).',
      });
    }
  }

  // 11. Hint / Comentário validation
  if (!/<b>\s*Coment[áa]rio:\s*<\/b>/i.test(hintText)) {
    warnings.push({
      code: 'COMMENT_MISSING_PREFIX',
      field: 'hint',
      severity: 'warning',
      message: 'O campo "hint" deve conter "<b>Comentário:</b> ".',
    });
  }

  if (
    /Preceptoria|Armadilha|\[ALVO DE BANCA\]|\[BEIRA-LEITO\]|\[BUSCAR IMAGEM/i.test(
      `${questionText} ${hintText}`
    )
  ) {
    warnings.push({
      code: 'LEGACY_MARKERS',
      field: 'hint',
      severity: 'error',
      message:
        'Remova marcadores obsoletos (Preceptoria, Armadilha, [ALVO DE BANCA], [BEIRA-LEITO] ou [BUSCAR IMAGEM]).',
    });
  }

  if (commentVisibleCharCount > MAX_COMMENT_CHARS) {
    warnings.push({
      code: 'COMMENT_TOO_LONG',
      field: 'hint',
      severity: 'error',
      message: `Comentário excede o teto de ${MAX_COMMENT_CHARS} caracteres visíveis (${commentVisibleCharCount}/${MAX_COMMENT_CHARS} chars).`,
    });
  } else if (commentVisibleCharCount > 0 && commentVisibleCharCount < 110) {
    warnings.push({
      code: 'COMMENT_TOO_SHORT',
      field: 'hint',
      severity: 'warning',
      message: `Comentário curto (${commentVisibleCharCount} chars; meta ideal: 180 a 300 chars com contraste diferencial).`,
    });
  }

  const boldMatches = hintText
    .replace(/<b>\s*Coment[áa]rio:\s*<\/b>/i, '')
    .match(/<(b|strong)\b[^>]*>/gi);
  if (!boldMatches || boldMatches.length === 0) {
    warnings.push({
      code: 'COMMENT_MISSING_BOLD',
      field: 'hint',
      severity: 'warning',
      message: 'Destaque os termos-chave e contraste diferencial em <b>negrito</b> no comentário.',
    });
  }

  const metrics: CardLintMetrics = {
    questionWordCount,
    answerWordCount,
    answerCharCount,
    commentVisibleCharCount,
    clozeCount,
    maxClozeWords,
    hasCompoundQuestion,
    hasTopicSpoiler,
  };

  return {
    cardId: card.id,
    isValid: warnings.length === 0,
    warnings,
    metrics,
  };
}

/**
 * Reconciles a list of generated/updated cards with the original deck's numeric FSRS IDs,
 * media tags, and sources objects.
 *
 * Importantly, this matches surviving cards by their original numeric `id` (preserving FSRS history
 * even when redundant cards are pruned or reordered) and assigns new sequential IDs (`maxExistingId + 1`, ...)
 * to newly created cards.
 */
export function reconcileDeckIdsAndMedia(
  generatedCards: CanonicalCard[],
  metadata: ExtractedDeckMetadata,
  deckKey: string
): CanonicalCard[] {
  const existingIds = metadata.existingIds || [];
  const existingIdSet = new Set<number>(existingIds);
  const originalById = new Map<number, CanonicalCard>();
  for (const orig of metadata.rawCards || []) {
    if (Number.isFinite(orig.id)) {
      originalById.set(Number(orig.id), orig);
      existingIdSet.add(Number(orig.id));
    }
  }

  const candidateMaxIds = [
    ...Array.from(existingIdSet),
    ...generatedCards.map((c) => (Number.isFinite(c.id) ? Number(c.id) : 0)),
  ];
  const maxExistingId =
    candidateMaxIds.length > 0 && Math.max(...candidateMaxIds) > 0
      ? Math.max(...candidateMaxIds)
      : 171000100;
  let nextSequentialId = maxExistingId + 1;
  const usedIds = new Set<number>();

  const cleanDeckKey = (deckKey || metadata.detectedDeckKey || 'internato_deck')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_');

  return generatedCards.map((card) => {
    const incomingId = Number(card.id);
    let preservedId: number;
    if (
      Number.isFinite(incomingId) &&
      incomingId > 0 &&
      existingIdSet.has(incomingId) &&
      !usedIds.has(incomingId)
    ) {
      preservedId = incomingId;
      usedIds.add(preservedId);
    } else if (
      Number.isFinite(incomingId) &&
      incomingId > maxExistingId &&
      !usedIds.has(incomingId)
    ) {
      preservedId = incomingId;
      usedIds.add(preservedId);
      if (preservedId >= nextSequentialId) {
        nextSequentialId = preservedId + 1;
      }
    } else {
      while (usedIds.has(nextSequentialId) || existingIdSet.has(nextSequentialId)) {
        nextSequentialId++;
      }
      preservedId = nextSequentialId++;
      usedIds.add(preservedId);
    }

    const originalCard = originalById.get(preservedId);
    let question = card.question || '';
    let hint = card.hint || '';

    if (originalCard) {
      const hasNewImage = /<img\b/i.test(question) || /<img\b/i.test(hint);
      const origMedia = extractMediaFromString(
        `${originalCard.question} ${originalCard.answer} ${originalCard.hint}`
      );
      for (const mediaTag of origMedia) {
        if (!question.includes(mediaTag) && !hint.includes(mediaTag)) {
          if (mediaTag.startsWith('<audio') || mediaTag.startsWith('[sound:')) {
            hint = `${hint} ${mediaTag}`.trim();
          } else if (!hasNewImage) {
            question = `${question} ${mediaTag}`.trim();
          }
        }
      }
    }

    const cardTags = Array.from(
      new Set([
        cleanDeckKey,
        ...(Array.isArray(card.tags)
          ? card.tags.map((t) => String(t).trim()).filter((t) => t && !/\s/.test(t))
          : []),
      ])
    );

    return {
      ...card,
      id: preservedId,
      deck_key: cleanDeckKey,
      type: card.type === 'cloze' ? 'cloze' : 'basic',
      answer: card.type === 'cloze' ? '' : card.answer,
      question,
      hint,
      tags: cardTags,
    };
  });
}

/**
 * Formats the final Canonical Deck into a pure JSON Array matching card_schema.json and lint.py ALLOWED_FIELDS.
 * Ensures all `<img src="...">` tags point to local Anki collection.media filenames (never external https:// URLs).
 */
export function formatCanonicalDeckJson(
  cards: CanonicalCard[],
  metadata?: ExtractedDeckMetadata | null,
  deckKey: string = 'internato_deck'
): string {
  const cleanDeckKey = (deckKey || metadata?.detectedDeckKey || 'internato_deck')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_');

  const strictNotes = cards.map((card) => {
    const tags = Array.from(
      new Set([
        cleanDeckKey,
        ...(Array.isArray(card.tags)
          ? card.tags.map((t) => String(t).trim()).filter((t) => t && !/\s/.test(t))
          : []),
      ])
    );

    const localQuestion = rewriteHtmlImgsToLocalAnki(card.question || '', card.id, cleanDeckKey);
    const localHint = rewriteHtmlImgsToLocalAnki(card.hint || '', card.id, cleanDeckKey);

    const noteOut: Record<string, unknown> = {
      id: card.id,
      type: card.type === 'cloze' ? 'cloze' : 'basic',
      topic: card.topic,
      question: localQuestion,
      answer: card.type === 'cloze' ? '' : card.answer,
      hint: localHint,
      tags,
    };

    if (card.image_mode === 'recognition' || card.image_mode === 'feedback') {
      noteOut.image_mode = card.image_mode;
    }
    if (Array.isArray(card.exam_refs) && card.exam_refs.length > 0) {
      noteOut.exam_refs = card.exam_refs;
    }
    if (typeof card.last_synced_hash === 'string' && card.last_synced_hash) {
      noteOut.last_synced_hash = card.last_synced_hash;
    }

    return noteOut;
  });

  return JSON.stringify(strictNotes, null, 2);
}

function replaceLatexWithUnicode(input: string): string {
  let out = input;
  for (const [regex, repl] of LATEX_REPLACEMENTS) {
    out = out.replace(regex, repl);
  }
  out = out.replace(/\$([^$]+)\$/g, '$1');
  return out;
}

/**
 * Deterministically repairs a card that violates Wozniak/Matuschak or desktop lint.py rules,
 * incorporating auto_heal_note from generator.py and _enforce_card_invariants from refiner.py.
 */
export function surgicalRepairCardLocal(card: CanonicalCard): CanonicalCard {
  const mediaInQuestion = extractMediaFromString(card.question || '');
  let question = replaceLatexWithUnicode((card.question || '').trim());
  let answer = replaceLatexWithUnicode((card.answer || '').trim());
  let hint = replaceLatexWithUnicode((card.hint || '').trim());
  let topic = replaceLatexWithUnicode((card.topic || 'Clínica Médica - Conduta no Internato').trim());

  // 1. Topic format (no ALL CAPS, must contain " - ")
  if (topic === topic.toUpperCase() && topic.length > 3) {
    topic = topic.charAt(0).toUpperCase() + topic.slice(1).toLowerCase();
  }
  if (!topic.includes(' - ')) {
    topic = `${topic} - Conduta Clínica`;
  }

  // 2. Strip duplicate bold topic prefix at start of question (from generator.py / refiner.py)
  const mPfx = question.match(/^\s*(?:\*\*|<b>)([\s\S]*?)(?:\*\*|<\/b>)[:.]?\s*([\s\S]*)/i);
  if (mPfx && mPfx[1] && mPfx[2]) {
    const pClean = stripHtml(mPfx[1]).toLowerCase();
    const tClean = stripHtml(topic).toLowerCase();
    const subt = tClean.includes(' - ') ? tClean.split(' - ').pop()!.trim() : tClean;
    if (
      pClean.includes(tClean) ||
      tClean.includes(pClean) ||
      pClean.includes(subt) ||
      subt.includes(pClean) ||
      mPfx[1].includes(' - ')
    ) {
      question = mPfx[2].trim();
    }
  }

  // 3. Fix compound question ("Qual o diagnóstico e a conduta?") -> atomic question with closed temporal window
  question = question.replace(
    /qual\s+(?:é\s+)?(?:o\s+|a\s+)?(?:diagn[oó]stico|classifica[cç][aã]o|hip[oó]tese)\s+e\s+(?:qual\s+)?(?:a\s+|o\s+)?(conduta|tratamento|manejo|droga|interven[cç][aã]o)(?:\s+imediata)?/gi,
    'Qual a $1 imediata de primeira escolha'
  );

  // 4. Fix vague temporal window ("Qual a conduta?") even if followed by media tags
  question = question.replace(
    /\bqual\s+(?:é\s+)?a\s+conduta\s*\?(?=\s*(?:<[^>]+>\s*)*$)/i,
    'Qual é a conduta imediata de primeira escolha?'
  );

  // 5. Remove parenthetical spoilers in question
  question = question.replace(
    /\s*\((?:tratar com|usar|iniciar|diagn[oó]stico:?|conduta:?|hinchey\s+[i1v]+)[^)]*\)/gi,
    ''
  );

  if (card.type === 'cloze') {
    answer = '';
    // Keep only 1 {{c1::...}}, convert 2nd+ clozes to <b>...</b> (from generator.py auto_heal_note)
    let seenFirstCloze = false;
    question = question.replace(/\{\{c\d+::([\s\S]*?)\}\}/g, (_match, inner: string) => {
      const targetOnly = (inner.split('::')[0] || '').trim();
      const words = stripHtml(targetOnly).split(/\s+/).filter(Boolean);
      let cut = Math.min(words.length, MAX_CLOZE_WORDS);
      while (cut > 1 && DANGLING_STOPWORDS.has(words[cut - 1].toLowerCase().replace(/[,;:.]/g, ''))) {
        cut--;
      }
      const clamped = words.slice(0, cut).join(' ');
      const overflow = words.length > cut ? ' ' + words.slice(cut).join(' ') : '';

      if (!seenFirstCloze) {
        seenFirstCloze = true;
        return `{{c1::${clamped}}}${overflow}`;
      }
      return `<b>${clamped}</b>${overflow}`;
    });

    if (!seenFirstCloze) {
      question = `${question.replace(/\.$/, '')}: {{c1::conduta imediata de 1ª linha}}.`;
    }

    // Remove post-cloze parenthetical crutches e.g. {{c1::...}} (critérios)
    question = question.replace(
      /(\{\{c1::[\s\S]*?\}\})\s*\((?:crit[eé]rios?|pontos?|dias?|anos?|itens?|sinais?)\)/gi,
      '$1'
    );
  } else {
    // Basic card repair
    answer = answer.replace(/^(?:Resposta|R):\s*/i, '').trim();
    answer = answer.replace(/^<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>\.?$/i, '$2').trim();
    answer = answer.replace(/^<\/?(?:b|strong)>\s*|\s*<\/?(?:b|strong)>$/gi, '').trim();

    if (answer.includes(';')) {
      const clauses = answer.split(';').map((c) => c.trim()).filter(Boolean);
      answer = clauses.length > 1 ? clauses[1] : clauses[0];
    }

    const plainWords = stripHtml(answer).replace(/\.$/, '').split(/\s+/).filter(Boolean);
    if (plainWords.length > 12) {
      let cut = 11;
      while (cut > 1 && DANGLING_STOPWORDS.has(plainWords[cut - 1].toLowerCase())) {
        cut--;
      }
      answer = plainWords.slice(0, cut).join(' ');
    }
    if (!answer.endsWith('.')) {
      answer = `${answer.replace(/[;:,?!]+$/, '')}.`;
    }
    if (answer.length > 1) {
      answer = answer.charAt(0).toUpperCase() + answer.slice(1);
    }
  }

  // 6. Clean remaining parenthetical spoilers that match answer or cloze keywords
  const checkAfterAnswer = lintCard({ ...card, topic, question, answer, hint });
  if (checkAfterAnswer.warnings.some((w) => w.code === 'QUESTION_PAREN_SPOILER')) {
    question = question.replace(/\s*\([^)]+\)/g, '');
  }
  if (checkAfterAnswer.metrics.hasTopicSpoiler) {
    const prefix = topic.split(' - ')[0] || 'Tema Clínico';
    topic = `${prefix} - Tomada de Decisão e Conduta`;
  }

  // Restore media in question if needed
  for (const m of mediaInQuestion) {
    if (!question.includes(m)) {
      question = `${question} ${m}`.trim();
    }
  }

  // 7. Normalize Hint structure (matching generator.py auto_heal_note & refiner.py)
  hint = hint.replace(
    /\[sound:([^\]]+)\]/gi,
    '<audio controls preload="none" class="med-audio"><source src="$1" type="audio/mpeg"></audio>'
  );
  hint = hint
    .replace(/<b>\s*🩺\s*Preceptoria[^<]*:?<\/b>\s*/gi, '')
    .replace(/<b>\s*⚠️\s*Armadilha[^<]*:?<\/b>\s*/gi, '')
    .replace(/🎯\s*\[ALVO DE BANCA\]\s*/gi, '')
    .replace(/🚨\s*\[BEIRA-LEITO\]\s*/gi, '')
    .replace(/\[BUSCAR\s+IMAGEM[^\]]*\]\s*/gi, '');

  const audioBlocks = hint.match(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi) || [];
  let textHint = hint.replace(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi, '').trim();

  // If recognition card, ensure <i>legend</i> in hint and no duplicate <img> in hint
  let legendPrefix = '';
  if (card.image_mode === 'recognition') {
    textHint = textHint.replace(/<img\b[^>]*>/gi, '').trim();
    const existingItalic = textHint.match(/^<i>[\s\S]*?<\/i>/i);
    if (existingItalic) {
      legendPrefix = `${existingItalic[0]}<br><br>`;
      textHint = textHint.slice(existingItalic[0].length).replace(/^(?:<br\s*\/?>\s*)+/i, '').trim();
    } else {
      legendPrefix = `<i>Achado complementar demonstrando padrão característico de ${stripHtml(topic)}.</i><br><br>`;
    }
  }

  if (!/^<b>\s*Coment[áa]rio:\s*<\/b>/i.test(textHint)) {
    textHint = `<b>Comentário:</b> ${textHint.replace(/^Coment[áa]rio:\s*/i, '')}`.trim();
  }

  if (!textHint.replace(/<b>\s*Coment[áa]rio:\s*<\/b>/i, '').includes('<b>')) {
    textHint = textHint.replace(
      /<b>\s*Coment[áa]rio:\s*<\/b>\s*/i,
      '<b>Comentário:</b> A <b>conduta prioritária de 1ª escolha</b> reduz morbimortalidade; '
    );
  }

  let visLen = extractCommentVisibleText(textHint).length;
  if (visLen > MAX_COMMENT_CHARS) {
    for (const [pattern, repl] of MEDICAL_ABBREVIATIONS) {
      textHint = textHint.replace(pattern, repl);
    }
    visLen = extractCommentVisibleText(textHint).length;
  }

  if (visLen > MAX_COMMENT_CHARS) {
    const bodyOnly = stripHtml(textHint.replace(/^<b>\s*Coment[áa]rio:\s*<\/b>\s*/i, ''))
      .slice(0, 260)
      .trim();
    textHint = `<b>Comentário:</b> <b>Conduta prioritária</b>: ${bodyOnly.replace(/[.,;:\s]+$/, '')}.`;
  } else if (visLen < 140) {
    textHint = `${textHint.replace(/\.$/, '')}, diferenciando-se das <b>condutas de 2ª linha</b> reservadas aos quadros refratários ou com contraindicação formal.`;
  }

  const audioSuffix = audioBlocks[0] ? `<br>${audioBlocks[0].trim()}` : '';
  hint = `${legendPrefix}${textHint}${audioSuffix}`.trim();

  return {
    ...card,
    topic,
    question,
    answer,
    hint,
  };
}

const CLOZE_UNIT_WORDS = new Set([
  'mmhg', 'bpm', 'cpm', 'mg', 'mcg', 'kg', 'ml', 'cm', 'mm', 'meq', 'meq/l',
  'ui', 'minutos', 'minuto', 'horas', 'hora', 'dias', 'dia', 'semanas', 'semana',
  'meses', 'anos', 'g', 'l', '%', 'mg/dl', 'g/dl', 'm/s',
]);

const NEGATIVE_FILTER_PATTERNS = [
  /\b(?:gene|muta[cç][aã]o)\s+(?:kras|apc|smad4|dcc|tp53|braf)\b/i,
  /\b(?:ano\s+de\s+descoberta|hist[oó]ria\s+da\s+medicina|descrito\s+em\s+1[89]\d\d)\b/i,
];

function tokenizeForSimilarity(text: string): Set<string> {
  const plain = stripHtml(stripClozeMarkup(text))
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');
  const tokens = plain
    .split(/\s+/)
    .filter(
      (w) =>
        (w.length >= 2 || /\d/.test(w)) &&
        !DANGLING_STOPWORDS.has(w) &&
        !MEDICAL_UNITS_AND_STOPWORDS.has(w)
    );
  return new Set(tokens);
}

function computeDiceSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  return (2 * intersection) / (a.size + b.size);
}

/**
 * Converts a Cloze card into a Basic card (preserving its FSRS ID) with a closed clinical command
 * and an atomic answer <= 15 words.
 */
export function convertClozeToBasic(card: CanonicalCard): CanonicalCard {
  const mediaInQuestion = extractMediaFromString(card.question || '');
  let rawQuestion = (card.question || '').trim();
  for (const m of mediaInQuestion) {
    rawQuestion = rawQuestion.replace(m, '').trim();
  }

  let extractedTarget = '';
  const clozeMatch = rawQuestion.match(/\{\{c\d+::([\s\S]*?)\}\}/i);
  if (clozeMatch && clozeMatch[1]) {
    extractedTarget = (clozeMatch[1].split('::')[0] || '').trim();
  }

  if (!extractedTarget) {
    extractedTarget = stripHtml(card.answer || 'Conduta imediata de primeira escolha').trim();
  }

  // Replace the primary cloze with a placeholder and strip any secondary clozes
  let seenFirst = false;
  let stem = rawQuestion.replace(/\{\{c\d+::([\s\S]*?)\}\}/gi, (_m, inner: string) => {
    const cleanInner = (inner.split('::')[0] || '').trim();
    if (!seenFirst) {
      seenFirst = true;
      return '___TARGET___';
    }
    return `<b>${cleanInner}</b>`;
  });

  // Remove the clause or phrase immediately revealing ___TARGET___ and turn into a direct question
  let questionBody = stem
    .replace(/\s*(?::|é|são|consiste em|caracteriza-se por|define-se como|corresponde a)\s*___TARGET___[^.?!]*[.?!]?/i, '')
    .replace(/___TARGET___/g, 'qual parâmetro ou conduta específica')
    .replace(/\s+/g, ' ')
    .trim();

  const isConductContext =
    /\b(?:conduta|manejo|tratamento|profilaxia|droga|f[aá]rmaco|dose|administra|indica|prescrev|manobra|parto|assist[eê]ncia|emerg[eê]ncia)\b/i.test(
      `${card.topic} ${questionBody}`
    );

  const closingQuestion = isConductContext
    ? 'Qual a conduta ou parâmetro imediato de primeira escolha?'
    : 'Qual o critério diagnóstico ou achado específico que define este quadro?';

  if (!questionBody.endsWith('?')) {
    questionBody = `${questionBody.replace(/[.;:,]+$/, '')}. ${closingQuestion}`;
  } else if (/\bqual\s+(?:é\s+)?a\s+conduta\s*\?$/i.test(questionBody)) {
    questionBody = questionBody.replace(
      /\bqual\s+(?:é\s+)?a\s+conduta\s*\?$/i,
      'Qual a conduta imediata de primeira escolha?'
    );
  }

  // Trim question if > 46 words
  const qWords = stripHtml(questionBody).split(/\s+/).filter(Boolean);
  if (qWords.length > 46) {
    const contextPrefix = qWords.slice(0, 30).join(' ').replace(/[.;:,]+$/, '');
    questionBody = `Diante de ${contextPrefix}, ${closingQuestion.charAt(0).toLowerCase() + closingQuestion.slice(1)}`;
  }

  for (const m of mediaInQuestion) {
    if (!questionBody.includes(m)) {
      questionBody = `${questionBody} ${m}`.trim();
    }
  }

  let cleanAnswer = stripHtml(extractedTarget).replace(/[.;:,?!]+$/, '').trim();
  if (!cleanAnswer) {
    cleanAnswer = 'Conduta imediata de primeira escolha';
  }
  cleanAnswer = `${cleanAnswer.charAt(0).toUpperCase() + cleanAnswer.slice(1)}.`;

  return surgicalRepairCardLocal({
    ...card,
    type: 'basic',
    question: questionBody,
    answer: cleanAnswer,
  });
}

/**
 * Converts a Basic card (that is NOT an image recognition card) into a Cloze card
 * with a single 1–5 word {{c1::...}} gap, keeping measurement units outside the gap.
 */
export function convertBasicToCloze(card: CanonicalCard): CanonicalCard {
  if (card.image_mode === 'recognition' || /<img\b/i.test(card.question || '')) {
    return surgicalRepairCardLocal(card);
  }

  const rawAnswer = stripHtml(card.answer || '').replace(/^(?:Resposta|R):\s*/i, '').replace(/[.?!;]+$/, '').trim();
  const ansWords = rawAnswer.split(/\s+/).filter(Boolean);

  let cut = Math.min(ansWords.length, MAX_CLOZE_WORDS);
  // Keep trailing measurement units outside the cloze gap per DIRETRIZ_CRIACAO_DE_CARDS.md
  while (
    cut > 1 &&
    (DANGLING_STOPWORDS.has(ansWords[cut - 1].toLowerCase().replace(/[,;:.]/g, '')) ||
      CLOZE_UNIT_WORDS.has(ansWords[cut - 1].toLowerCase().replace(/[,;:.]/g, '')))
  ) {
    cut--;
  }

  const clozeTarget = ansWords.slice(0, Math.max(1, cut)).join(' ') || 'conduta de 1ª escolha';
  const trailingRest = ansWords.length > cut ? ` ${ansWords.slice(cut).join(' ')}` : '';

  let rawQuestion = stripClozeMarkup(card.question || '').trim();
  // Remove trailing interrogative sentence ("Qual ...?") to turn into declarative statement
  let contextSentence = rawQuestion
    .replace(/\s*(?:Qual|Quais|Quando|Como|Onde|Por que)\b[^?]*\?\s*$/i, '')
    .replace(/\?\s*$/, '')
    .replace(/[.;:,]+$/, '')
    .trim();

  if (!contextSentence) {
    const subtopic = (card.topic || 'Conduta Clínica').split(' - ').pop() || 'conduta clínica';
    contextSentence = `Na avaliação e manejo de <b>${stripHtml(subtopic)}</b>`;
  }

  const declarativeQuestion = `${contextSentence}, o parâmetro ou conduta de 1ª escolha é {{c1::${clozeTarget}}}${trailingRest}.`;

  return surgicalRepairCardLocal({
    ...card,
    type: 'cloze',
    question: declarativeQuestion,
    answer: '',
  });
}

/**
 * Audits, prunes redundant/overlapping cards (excluding their IDs), adds missing P1-P4 concepts
 * from the Clinical Map (creating new sequential IDs), repairs Wozniak/Matuschak violations,
 * and rebalances the deck to ~50% basic / ~50% cloze while preserving original FSRS IDs on surviving cards.
 */
export function curateAndRebalanceDeck(
  inputCards: CanonicalCard[],
  metadata: ExtractedDeckMetadata,
  deckKey: string,
  clinicalMap?: ClinicalMapResponse | null
): { cards: CanonicalCard[]; stats: DeckCurationStats } {
  const originalCount =
    metadata.rawCards && metadata.rawCards.length > 0
      ? metadata.rawCards.length
      : inputCards.length;

  const existingIdSet = new Set<number>(metadata.existingIds || []);
  for (const c of metadata.rawCards || []) {
    if (Number.isFinite(c.id)) existingIdSet.add(Number(c.id));
  }

  // Step 1: Repair and normalize input cards first
  const initialRepaired = inputCards.map((c) => surgicalRepairCardLocal(c));

  // Step 2: Prune negative-filter cards & high-overlap redundant cards (dropping their IDs)
  const survivingCards: CanonicalCard[] = [];
  const survivingTokenSets: Array<{ tokens: Set<string>; targetKey: string }> = [];
  let prunedCount = 0;

  for (const candidate of initialRepaired) {
    const combinedText = `${candidate.topic} ${candidate.question} ${candidate.answer}`;
    const hitsNegativeFilter = NEGATIVE_FILTER_PATTERNS.some((rx) => rx.test(combinedText));
    if (hitsNegativeFilter) {
      prunedCount++;
      continue;
    }

    const clozeMatch = candidate.question.match(/\{\{c\d+::([\s\S]*?)\}\}/i);
    const targetRaw =
      candidate.type === 'cloze'
        ? (clozeMatch?.[1]?.split('::')[0] || '').trim()
        : candidate.answer;
    const targetKey = stripHtml(targetRaw)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .trim();

    const tokens = tokenizeForSimilarity(`${candidate.question} ${targetRaw}`);

    let isDuplicate = false;
    for (const prev of survivingTokenSets) {
      const dice = computeDiceSimilarity(tokens, prev.tokens);
      const sameTarget = targetKey.length >= 2 && targetKey === prev.targetKey;
      if (dice >= 0.96 || (sameTarget && dice >= 0.62)) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) {
      prunedCount++;
      continue;
    }

    survivingCards.push(candidate);
    survivingTokenSets.push({ tokens, targetKey });
  }

  // Step 3: Add missing high-yield P1-P4 concepts from Clinical Map (if provided) with new IDs
  const cleanDeckKey = (deckKey || metadata.detectedDeckKey || 'internato_deck')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_');

  const maxExistingId =
    existingIdSet.size > 0
      ? Math.max(...Array.from(existingIdSet), ...survivingCards.map((c) => Number(c.id) || 0))
      : Math.max(171000100, ...survivingCards.map((c) => Number(c.id) || 0));
  let nextNewId = maxExistingId + 1;
  let addedCount = 0;

  if (clinicalMap && Array.isArray(clinicalMap.items)) {
    const checkedItems = clinicalMap.items.filter((item) => item.checked !== false);
    for (const item of checkedItems) {
      const itemTokens = tokenizeForSimilarity(`${item.subtopic} ${item.concept}`);
      const alreadyCovered = survivingTokenSets.some(
        (existing) => computeDiceSimilarity(itemTokens, existing.tokens) >= 0.42
      );

      if (!alreadyCovered) {
        const newId = nextNewId++;
        const cleanConcept = item.concept.replace(/\.$/, '').trim();
        const topicPrefix = (clinicalMap.themeTitle || cleanDeckKey.replace(/_/g, ' '))
          .split(/[—–-]/)[0]
          .trim();
        const topic = `${topicPrefix} - ${item.subtopic}`;

        // Extract concise target for answer/cloze
        const conceptWords = stripHtml(cleanConcept).split(/\s+/).filter(Boolean);
        const shortTargetWords = conceptWords.slice(0, Math.min(conceptWords.length, 4));
        while (
          shortTargetWords.length > 1 &&
          DANGLING_STOPWORDS.has(shortTargetWords[shortTargetWords.length - 1].toLowerCase().replace(/[,;:.]/g, ''))
        ) {
          shortTargetWords.pop();
        }
        const shortTarget = shortTargetWords.join(' ') || 'Conduta prioritária';

        const rawNewCard: CanonicalCard =
          item.targetCardType === 'cloze'
            ? {
                id: newId,
                type: 'cloze',
                priority: item.priority,
                deck_key: cleanDeckKey,
                topic,
                question: `Na avaliação de <b>${item.subtopic}</b> no contexto de ${topicPrefix}, a conduta ou parâmetro prioritário fundamenta-se em {{c1::${shortTarget}}}.`,
                answer: '',
                hint: `<b>Comentário:</b> Em <b>${item.subtopic}</b>, aplica-se <b>${cleanConcept}</b> (${item.guidelineNote}), diferenciando-se das <b>condutas de 2ª linha</b> reservadas aos casos refratários.`,
                tags: [cleanDeckKey, item.priority.toLowerCase()],
              }
            : {
                id: newId,
                type: 'basic',
                priority: item.priority,
                deck_key: cleanDeckKey,
                topic,
                question: `Diante de quadro compatível com <b>${item.subtopic}</b> (${topicPrefix}), qual a conduta ou definição imediata de primeira escolha?`,
                answer: `${conceptWords.slice(0, 10).join(' ').replace(/[.;:,]+$/, '')}.`,
                hint: `<b>Comentário:</b> A diretriz preconiza <b>${cleanConcept}</b> (${item.guidelineNote}), evitando atraso diagnóstico frente aos <b>diferenciais de menor gravidade</b>.`,
                tags: [cleanDeckKey, item.priority.toLowerCase()],
              };

        const repairedNew = surgicalRepairCardLocal(rawNewCard);
        survivingCards.push(repairedNew);
        survivingTokenSets.push({
          tokens: itemTokens,
          targetKey: shortTarget.toLowerCase(),
        });
        addedCount++;
      }
    }
  }

  // Step 4: Rebalance Basic vs. Cloze to ~50% / 50% (target 45%-55%)
  const total = survivingCards.length;
  const targetBasicCount = Math.round(total * 0.5);
  let currentBasicCount = survivingCards.filter((c) => c.type === 'basic').length;
  let convertedCount = 0;

  if (total >= 2 && currentBasicCount < targetBasicCount) {
    // Need to convert (targetBasicCount - currentBasicCount) cloze cards -> basic
    const needed = targetBasicCount - currentBasicCount;
    let converted = 0;
    for (let i = 0; i < survivingCards.length && converted < needed; i++) {
      // Alternate indices or convert excess cloze cards smoothly across the deck
      if (survivingCards[i].type === 'cloze') {
        survivingCards[i] = convertClozeToBasic(survivingCards[i]);
        converted++;
        convertedCount++;
      }
    }
  } else if (total >= 2 && currentBasicCount > targetBasicCount) {
    // Need to convert (currentBasicCount - targetBasicCount) non-recognition basic cards -> cloze
    const needed = currentBasicCount - targetBasicCount;
    let converted = 0;
    for (let i = 0; i < survivingCards.length && converted < needed; i++) {
      const card = survivingCards[i];
      if (
        card.type === 'basic' &&
        card.image_mode !== 'recognition' &&
        !/<img\b/i.test(card.question || '')
      ) {
        survivingCards[i] = convertBasicToCloze(card);
        converted++;
        convertedCount++;
      }
    }
  }

  // Step 5: Reconcile IDs and media by ID (never overwriting surviving IDs by index!)
  const reconciled = reconcileDeckIdsAndMedia(survivingCards, metadata, cleanDeckKey).map((c) =>
    surgicalRepairCardLocal(c)
  );

  const finalCount = reconciled.length;
  const finalBasic = reconciled.filter((c) => c.type === 'basic').length;
  const finalCloze = finalCount - finalBasic;
  const basicPct = finalCount > 0 ? Math.round((finalBasic / finalCount) * 100) : 50;
  const clozePct = finalCount > 0 ? 100 - basicPct : 50;
  const preservedIdsCount = reconciled.filter((c) => existingIdSet.has(Number(c.id))).length;

  return {
    cards: reconciled,
    stats: {
      originalCount,
      finalCount,
      prunedCount,
      addedCount,
      convertedCount,
      preservedIdsCount,
      basicPct,
      clozePct,
    },
  };
}

