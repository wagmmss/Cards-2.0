import {
  CanonicalCard,
  CardLintMetrics,
  CardLintResult,
  ClinicalMapResponse,
  DeckCurationStats,
  ExtractedDeckMetadata,
  LinterWarning,
  MediaBundleItem,
  MedicalImageResult,
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
  pelvimetria: ['plano', 'zero', 'planos', 'delee', 'lee', 'hodges', 'bacia', 'espinhas', 'isquiaticas', 'conjugata'],
  pelvimetr: ['plano', 'zero', 'planos', 'delee', 'lee', 'hodges', 'bacia', 'espinhas'],
  plano: ['pelvimetria', 'delee', 'hodges'],
  planos: ['pelvimetria', 'plano', 'zero', 'delee', 'hodges'],
  manobra: ['manobras', 'mcroberts', 'rubin', 'woods', 'jacquemier', 'zavanelli', 'kristeller', 'leopold', 'ritgen', 'brandt'],
  manobras: ['manobra', 'mcroberts', 'rubin', 'woods', 'jacquemier', 'zavanelli', 'kristeller', 'leopold', 'ritgen', 'brandt'],
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
    .replace(/<\/?[a-zA-Z!][^>]*>/g, ' ')
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

export function resolveLocalAudioFilename(
  rawTag: string,
  rawSrc: string,
  cardId: number,
  audioIndex: number = 0,
  deckKey: string = 'deck'
): string {
  const cleanDeck =
    (deckKey || 'deck')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_') || 'deck';

  const attrMatch = rawTag.match(/\bdata-anki-file=["']([^"']+)["']/i);
  if (attrMatch && attrMatch[1]) {
    const cleanAttr = attrMatch[1]
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '_');
    if (cleanAttr) return cleanAttr;
  }

  const src = (rawSrc || '').trim();
  if (src && !/^(?:https?:|data:|blob:|\/)/i.test(src)) {
    const base = src.split(/[\\/]/).pop() || src;
    return base.replace(/[^a-zA-Z0-9_.-]+/g, '_');
  }

  if (src.startsWith('data:audio/wav')) {
    return `${cleanDeck}_${cardId}_audio${audioIndex + 1}.wav`;
  }
  if (src.startsWith('data:audio/ogg')) {
    return `${cleanDeck}_${cardId}_audio${audioIndex + 1}.ogg`;
  }
  return `${cleanDeck}_${cardId}_audio${audioIndex + 1}.mp3`;
}

/**
 * Rewrites all <img ...> and <audio ...> tags in an HTML string so that src points strictly to the local
 * collection.media filename (e.g. <img src="ecg_iam_supradesnivelamento_st.svg">) with no external https:// links.
 */
export function rewriteHtmlImgsToLocalAnki(
  htmlText: string,
  cardId: number,
  deckKey: string = 'deck'
): string {
  if (!htmlText) return '';
  let imgIdx = 0;
  let audioIdx = 0;
  let out = htmlText.replace(
    /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
    (fullTag, srcVal: string) => {
      const localName = resolveLocalMediaFilename(fullTag, srcVal, cardId, imgIdx++, deckKey);
      return `<img src="${localName}">`;
    }
  );

  out = out.replace(
    /<audio\b[^>]*>[\s\S]*?<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/audio>/gi,
    (fullTag, srcVal: string) => {
      const localName = resolveLocalAudioFilename(fullTag, srcVal, cardId, audioIdx++, deckKey);
      return `<audio controls preload="none" class="med-audio"><source src="${localName}" type="audio/mpeg"></audio>`;
    }
  );

  out = out.replace(
    /<audio\b[^>]*\bsrc=["']([^"']+)["'][^>]*>(?:[\s\S]*?<\/audio>)?/gi,
    (fullTag, srcVal: string) => {
      const localName = resolveLocalAudioFilename(fullTag, srcVal, cardId, audioIdx++, deckKey);
      return `<audio controls preload="none" class="med-audio"><source src="${localName}" type="audio/mpeg"></audio>`;
    }
  );

  return out;
}

export interface CardMediaReference {
  filename: string;
  sourceUrl: string;
  field: 'question' | 'hint';
  kind: 'image' | 'audio';
  rawTag: string;
}

/**
 * Extracts all image and audio references from a single card.
 */
export function extractCardMediaReferences(
  card: CanonicalCard,
  deckKey: string = 'deck'
): CardMediaReference[] {
  const refs: CardMediaReference[] = [];
  const fields: Array<['question' | 'hint', string]> = [
    ['question', card.question || ''],
    ['hint', card.hint || ''],
  ];

  for (const [fieldName, htmlText] of fields) {
    let imgIdx = 0;
    const imgRegex = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = imgRegex.exec(htmlText)) !== null) {
      const fullTag = m[0];
      const srcVal = m[1];
      const filename = resolveLocalMediaFilename(fullTag, srcVal, card.id, imgIdx++, deckKey);
      refs.push({
        filename,
        sourceUrl: srcVal,
        field: fieldName,
        kind: 'image',
        rawTag: fullTag,
      });
    }

    let audioIdx = 0;
    const audioSourceRegex =
      /<audio\b[^>]*>[\s\S]*?<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/audio>/gi;
    while ((m = audioSourceRegex.exec(htmlText)) !== null) {
      const fullTag = m[0];
      const srcVal = m[1];
      const filename = resolveLocalAudioFilename(fullTag, srcVal, card.id, audioIdx++, deckKey);
      refs.push({
        filename,
        sourceUrl: srcVal,
        field: fieldName,
        kind: 'audio',
        rawTag: fullTag,
      });
    }

    const directAudioRegex = /<audio\b(?![^>]*>[\s\S]*?<source\b)[^>]*\bsrc=["']([^"']+)["'][^>]*>(?:[\s\S]*?<\/audio>)?/gi;
    while ((m = directAudioRegex.exec(htmlText)) !== null) {
      const fullTag = m[0];
      const srcVal = m[1];
      const filename = resolveLocalAudioFilename(fullTag, srcVal, card.id, audioIdx++, deckKey);
      refs.push({
        filename,
        sourceUrl: srcVal,
        field: fieldName,
        kind: 'audio',
        rawTag: fullTag,
      });
    }

    const soundBracketRegex = /\[sound:([^\]]+)\]/gi;
    while ((m = soundBracketRegex.exec(htmlText)) !== null) {
      const fullTag = m[0];
      const srcVal = m[1].trim();
      const filename = resolveLocalAudioFilename(fullTag, srcVal, card.id, audioIdx++, deckKey);
      refs.push({
        filename,
        sourceUrl: srcVal,
        field: fieldName,
        kind: 'audio',
        rawTag: fullTag,
      });
    }
  }

  return refs;
}

/**
 * Extracts a manifest of all images and audio files across the deck with their local Anki filenames
 * and source URLs/data-URIs so they can be bundled into collection.media / 04_Mídias / .apkg on export.
 */
export function extractDeckMediaManifest(
  cards: CanonicalCard[],
  deckKey: string = 'deck'
): MediaBundleItem[] {
  const seen = new Set<string>();
  const items: MediaBundleItem[] = [];

  for (const card of cards) {
    const refs = extractCardMediaReferences(card, deckKey);
    for (const ref of refs) {
      if (!seen.has(ref.filename)) {
        seen.add(ref.filename);
        items.push({
          filename: ref.filename,
          sourceUrl: ref.sourceUrl,
          cardId: card.id,
          field: ref.field,
          kind: ref.kind,
        });
      }
    }
  }

  return items;
}

/**
 * Automatically strips orphan `<audio>...</audio>` and `[sound:...]` tags whose source is not
 * `https://`, `http://`, or `data:` (and not in availableMediaSet).
 */
export function stripOrphanAudioFromHtml(
  html: string,
  availableMediaSet?: Set<string>
): { cleanedHtml: string; removedCount: number } {
  if (!html) return { cleanedHtml: '', removedCount: 0 };
  let removedCount = 0;

  const isAudioSrcAvailable = (src: string): boolean => {
    const clean = (src || '').trim();
    if (/^(?:https?:\/\/|data:)/i.test(clean)) return true;
    if (availableMediaSet && availableMediaSet.size > 0) {
      const lower = clean.toLowerCase();
      const base = lower.split(/[\\/]/).pop() || lower;
      if (availableMediaSet.has(lower) || availableMediaSet.has(base)) return true;
    }
    return false;
  };

  let out = html.replace(
    /(?:<br\s*\/?>\s*)*<audio\b[^>]*>[\s\S]*?<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/audio>/gi,
    (fullMatch, srcVal: string) => {
      if (isAudioSrcAvailable(srcVal)) return fullMatch;
      removedCount++;
      return '';
    }
  );

  out = out.replace(
    /(?:<br\s*\/?>\s*)*<audio\b(?![^>]*>[\s\S]*?<source\b)[^>]*\bsrc=["']([^"']+)["'][^>]*>(?:[\s\S]*?<\/audio>)?/gi,
    (fullMatch, srcVal: string) => {
      if (isAudioSrcAvailable(srcVal)) return fullMatch;
      removedCount++;
      return '';
    }
  );

  out = out.replace(/(?:<br\s*\/?>\s*)*\[sound:([^\]]+)\]/gi, (fullMatch, srcVal: string) => {
    if (isAudioSrcAvailable(srcVal)) return fullMatch;
    removedCount++;
    return '';
  });

  return {
    cleanedHtml: out.replace(/(?:<br\s*\/?>\s*)+$/i, '').trim(),
    removedCount,
  };
}

/**
 * Extracts unresolved local `<img src="arquivo_local.png">` references from a card along with
 * a rich search query built from the visual legend `<i>...</i>` + `topic` + `question` so they can
 * be automatically resolved via Google/Web medical image search without manual upload.
 */
export function extractUnresolvedLocalImages(
  card: CanonicalCard,
  availableMediaNames?: Iterable<string>
): Array<{
  filename: string;
  field: 'question' | 'hint';
  legendText: string;
  searchQuery: string;
}> {
  const availableSet = new Set<string>();
  if (availableMediaNames) {
    for (const n of availableMediaNames) {
      if (n) {
        const clean = String(n).trim().toLowerCase();
        availableSet.add(clean);
        const base = clean.split(/[\\/]/).pop();
        if (base) availableSet.add(base);
      }
    }
  }

  const italicMatch = (card.hint || '').match(/<i>([\s\S]*?)<\/i>/i);
  const legendText = italicMatch?.[1] ? stripHtml(italicMatch[1]).trim() : '';
  const cleanFileWords = (fname: string) =>
    fname
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b(?:img|image|card|fig|figura|\d+)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const refs = extractCardMediaReferences(card, card.deck_key || 'deck');
  const unresolved: Array<{
    filename: string;
    field: 'question' | 'hint';
    legendText: string;
    searchQuery: string;
  }> = [];

  for (const ref of refs) {
    if (ref.kind !== 'image') continue;
    const raw = (ref.sourceUrl || '').trim();
    const isSelfContainedOrWeb = /^(?:https?:\/\/|data:)/i.test(raw);
    const isLoadedLocally =
      availableSet.has(ref.filename.toLowerCase()) || availableSet.has(raw.toLowerCase());

    if (!isSelfContainedOrWeb && !isLoadedLocally) {
      const fileHint = cleanFileWords(ref.filename);
      const searchQuery = [legendText, card.topic, fileHint]
        .filter(Boolean)
        .join(' ')
        .slice(0, 140)
        .trim();
      unresolved.push({
        filename: ref.filename,
        field: ref.field,
        legendText,
        searchQuery: searchQuery || card.topic || 'medical exam',
      });
    }
  }

  return unresolved;
}

/**
 * Replaces a card's local `<img src="...">` (or current image) with a resolved web image URL
 * while preserving `data-anki-file` and storing 4–6 alternative thumbnails on `card.imageAlternatives`.
 */
export function applyResolvedWebImageToCard(
  card: CanonicalCard,
  targetFilename: string,
  chosenImage: MedicalImageResult,
  alternatives: MedicalImageResult[]
): CanonicalCard {
  const safeFile =
    targetFilename.trim() ||
    chosenImage.suggestedFilename ||
    resolveLocalMediaFilename('', chosenImage.thumbUrl, card.id, 0, card.deck_key || 'deck');
  const newImgTag = `<img src="${chosenImage.thumbUrl}" data-anki-file="${safeFile}">`;

  let question = card.question || '';
  let hint = card.hint || '';

  const replaceTargetImg = (html: string): { updated: string; replaced: boolean } => {
    let replaced = false;
    const updated = html.replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (fullTag, srcVal: string) => {
      if (replaced) return fullTag;
      const localName = resolveLocalMediaFilename(fullTag, srcVal, card.id, 0, card.deck_key || 'deck');
      if (
        !targetFilename ||
        localName.toLowerCase() === targetFilename.toLowerCase() ||
        srcVal.toLowerCase().includes(targetFilename.toLowerCase())
      ) {
        replaced = true;
        return newImgTag;
      }
      return fullTag;
    });
    return { updated, replaced };
  };

  const qRes = replaceTargetImg(question);
  if (qRes.replaced) {
    question = qRes.updated;
  } else {
    const hRes = replaceTargetImg(hint);
    if (hRes.replaced) {
      hint = hRes.updated;
    } else if (/<img\b/i.test(question)) {
      question = question.replace(/<img\b[^>]*>/i, newImgTag);
    } else if (/<img\b/i.test(hint)) {
      hint = hint.replace(/<img\b[^>]*>/i, newImgTag);
    } else {
      question = `${question}<br>${newImgTag}`;
    }
  }

  return {
    ...card,
    question,
    hint,
    imageAlternatives: alternatives.slice(0, 6),
    isResolvingImage: false,
  };
}

/**
 * Parses an uploaded or pasted *_notes.json string and extracts existing FSRS numeric IDs
 * and media references (<img src="..."> / <audio>), automatically removing orphan <audio> tags
 * whose .mp3 files do not exist on rawCards.
 */
export function extractDeckMetadata(rawJsonText: string): ExtractedDeckMetadata {
  const empty: ExtractedDeckMetadata = {
    existingIds: [],
    mediaTags: [],
    detectedDeckKey: '',
    rawCards: [],
    removedOrphanAudioCount: 0,
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
  let removedOrphanAudioCount = 0;

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

    const rawQuestion =
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
    const rawHint =
      typeof card.hint === 'string'
        ? card.hint
        : typeof card.comment === 'string'
        ? card.comment
        : '';
    const topic =
      typeof card.topic === 'string' ? card.topic : 'Clínica Médica - Conduta';
    const hasCloze = /\{\{c\d+::/.test(rawQuestion);
    const type = card.type === 'cloze' || hasCloze ? 'cloze' : 'basic';

    if (!detectedDeckKey && Array.isArray(card.tags) && typeof card.tags[0] === 'string') {
      detectedDeckKey = card.tags[0].trim();
    } else if (!detectedDeckKey && typeof card.deck_key === 'string' && card.deck_key.trim()) {
      detectedDeckKey = card.deck_key.trim();
    }

    [rawQuestion, answer, rawHint].forEach((fieldVal) => {
      extractMediaFromString(fieldVal).forEach((m) => mediaSet.add(m));
    });

    // Auto-remove orphan <audio> tags on imported deck cards so user never has to upload .mp3 files
    const qAudioClean = stripOrphanAudioFromHtml(rawQuestion);
    const hAudioClean = stripOrphanAudioFromHtml(rawHint);
    removedOrphanAudioCount += qAudioClean.removedCount + hAudioClean.removedCount;

    const imageMode =
      card.image_mode === 'recognition' || card.image_mode === 'feedback'
        ? card.image_mode
        : undefined;

    return {
      id: numericId,
      type,
      topic,
      question: qAudioClean.cleanedHtml,
      answer: type === 'cloze' ? (typeof card.answer === 'string' ? card.answer : '') : answer,
      hint: hAudioClean.cleanedHtml,
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
    removedOrphanAudioCount,
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

const PORTUGUESE_STEM_SUFFIXES = [
  'amentos', 'amento', 'acoes', 'acao', 'icoes', 'icao', 'mente',
  'idades', 'idade', 'ismos', 'ismo', 'istas', 'ista', 'ulares', 'ular',
  'icos', 'icas', 'ico', 'ica', 'ores', 'oras', 'ador', 'adora',
  'antes', 'ante', 'entes', 'ente', 'oes', 'aes', 'ais', 'eis', 'ois',
  'es', 'is', 'os', 'as', 's', 'a', 'o',
];

/**
 * Computes a Portuguese morphological stem (radical) of at least 4 characters
 * so plural/singular or derivational variants (e.g. "Manobras" vs "Manobra de McRoberts")
 * are accurately caught by the Topic Spoiler detector.
 */
export function stemPortugueseWord(word: string): string {
  const w = normalizeForSpoiler(word).replace(/\s+/g, '');
  if (w.length <= 4) return w;
  for (const suffix of PORTUGUESE_STEM_SUFFIXES) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 4) {
      return w.slice(0, w.length - suffix.length);
    }
  }
  return w;
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
 * Evaluates a single card against all rules from lint.py, DIRETRIZ_CRIACAO_DE_CARDS.md, and SYSTEM_PROMPT_CRIADOR.md,
 * including MISSING_MEDIA validation for orphan <img src="..."> and <audio> tags.
 */
export function lintCard(
  card: CanonicalCard,
  availableMediaNames?: Iterable<string>
): CardLintResult {
  const warnings: LinterWarning[] = [];
  const questionText = card.question || '';
  const answerText = card.answer || '';
  const hintText = card.hint || '';
  const topicText = card.topic || '';

  const availableMediaSet = new Set<string>();
  if (availableMediaNames) {
    for (const name of availableMediaNames) {
      if (name) {
        const clean = String(name).trim().toLowerCase();
        availableMediaSet.add(clean);
        const base = clean.split(/[\\/]/).pop();
        if (base) availableMediaSet.add(base);
      }
    }
  }

  // 0. Validate all <img src="..."> and <audio> media references for MISSING_MEDIA
  // (Only flag MISSING_MEDIA if automatic web search is not currently running and could not resolve the media)
  const mediaRefs = extractCardMediaReferences(card, card.deck_key || 'deck');
  const missingMediaFiles: string[] = [];
  if (!card.isResolvingImage) {
    for (const ref of mediaRefs) {
      const raw = (ref.sourceUrl || '').trim();
      const isSelfContainedOrWeb = /^(?:https?:\/\/|data:)/i.test(raw);
      const isLoadedLocally =
        availableMediaSet.has(ref.filename.toLowerCase()) ||
        availableMediaSet.has(raw.toLowerCase());

      if (!isSelfContainedOrWeb && !isLoadedLocally) {
        if (!missingMediaFiles.includes(ref.filename)) {
          missingMediaFiles.push(ref.filename);
        }
        warnings.push({
          code: 'MISSING_MEDIA',
          field: ref.field,
          severity: 'error',
          message: `Mídia local não encontrada ("${ref.filename}"): clique em "Buscar no Google/Web" ou remova a referência.`,
        });
      }
    }
  }

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
      message: `Enunciado com ${questionWordCount} palavras (Matuschak & Nielsen Anti-Pattern-Matching: máx. ${MAX_QUESTION_WORDS} palavras para evitar memorização superficial da forma da frase).`,
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
        message: 'Card basic exige resposta preenchida (Matuschak Tractable & Focused: 1 a 12 palavras, máx 15).',
      });
    } else if (answerWordCount > MAX_BASIC_ANSWER_WORDS || answerCharCount > MAX_BASIC_ANSWER_CHARS) {
      warnings.push({
        code: 'ANSWER_TOO_LONG',
        field: 'answer',
        severity: 'error',
        message: `Resposta viola Tractable & Focused de Matuschak/Nielsen (${answerWordCount}/${MAX_BASIC_ANSWER_WORDS} palavras, ${answerCharCount}/${MAX_BASIC_ANSWER_CHARS} chars).`,
      });
    }

    if (visibleAnswer.includes(';')) {
      warnings.push({
        code: 'ANSWER_HAS_SEMICOLON',
        field: 'answer',
        severity: 'error',
        message: 'Proibido conter ponto-e-vírgula (;) na resposta basic (Matuschak Focused: teste apenas 1 detalhe atômico por prompt).',
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
        'Pergunta composta detectada (viola Focused & Consistent de Matuschak). Pergunte apenas 1 decisão/alavanca atômica.',
    });
  }

  // 7B. Matuschak Focused & Tractable: Prohibit unfocused plural list/set enumerations ("Quais são as causas/critérios...?", "Cite...", or numbered lists)
  const unfocusedSetRegex =
    /\b(?:quais\s+(?:s[aã]o\s+)?(?:os|as)\s+(?:principais\s+)?(?:causas|crit[eé]rios|sintomas|sinais|fatores|manifesta[cç][oõ]es|complica[cç][oõ]es|indica[cç][oõ]es|etapas|tipos)|cite\s+(?:os|as|\d+)|liste\s+(?:os|as))\b/i;
  const answerNumberedListRegex = /(?:^|\s)(?:1[.)]\s+.+2[.)]\s+|[-•]\s+.+[-•]\s+)/;
  if (
    unfocusedSetRegex.test(visibleQuestion) ||
    (card.type === 'basic' && answerNumberedListRegex.test(visibleAnswer))
  ) {
    warnings.push({
      code: 'MATUSCHAK_UNFOCUSED_SET',
      field: 'question',
      severity: 'error',
      message:
        'Lista aberta não-focada (viola Matuschak Focused & Consistent): converta conjuntos/enumerações em 1 atributo específico ancorado ou 1 lacuna cloze.',
    });
  }

  // 7C. Nielsen (Augmenting LTM) & Matuschak (Salience / No Binary Prompts): Prohibit passive dictionary definitions ("O que é X?") or binary Yes/No answers
  const passiveDefinitionRegex =
    /^\s*(?:o\s+que\s+[eé]\s+(?:o|a|um|uma)?\s*[a-zà-ú0-9\s-]{2,40}\??|defina\s+[a-zà-ú0-9\s-]{2,40}\.?|fale\s+sobre\s+.+)$/i;
  const binaryAnswerRegex = /^(?:sim|n[aã]o|verdadeiro|falso)(?:[.,!]|$)/i;
  if (
    passiveDefinitionRegex.test(visibleQuestion.trim()) ||
    (card.type === 'basic' && binaryAnswerRegex.test(visibleAnswer.trim()))
  ) {
    warnings.push({
      code: 'NIELSEN_PASSIVE_OR_BINARY',
      field: card.type === 'basic' && binaryAnswerRegex.test(visibleAnswer.trim()) ? 'answer' : 'question',
      severity: 'error',
      message:
        'Prompt passivo/binário (viola Salience de Matuschak & LTM de Nielsen): evite definições de dicionário ("O que é...?") ou respostas Sim/Não; ancore em decisão clínica ou mecanismo causal.',
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
  const topicStems = new Set<string>();
  for (const tw of topicWords) {
    const st = stemPortugueseWord(tw);
    if (st.length >= 4) topicStems.add(st);
  }

  const subtopicPart = topicText.includes(' - ')
    ? topicText.split(' - ').slice(1).join(' - ')
    : topicText;
  const subtopicWords = expandWithSynonyms(extractCoreKeywords(subtopicPart));
  const subtopicStems = new Set<string>();
  for (const sw of subtopicWords) {
    const st = stemPortugueseWord(sw);
    if (st.length >= 4) subtopicStems.add(st);
  }

  const targetAnswerString = card.type === 'basic' ? visibleAnswer : clozeTargets.join(' ');
  const targetKeywords = extractCoreKeywords(targetAnswerString);

  let hasTopicSpoiler = false;
  if (targetKeywords.length > 0 && topicWords.size > 0) {
    const matchedKws = targetKeywords.filter((kw) => {
      if (topicWords.has(kw)) return true;
      const kwStem = stemPortugueseWord(kw);
      if (kwStem.length >= 4 && topicStems.has(kwStem)) return true;
      if (kwStem.length >= 5) {
        const prefix5 = kwStem.slice(0, 5);
        for (const ts of topicStems) {
          if (ts.length >= 5 && ts.slice(0, 5) === prefix5) return true;
        }
      }
      return false;
    });

    const firstTargetKw = targetKeywords[0];
    const firstTargetStem = firstTargetKw ? stemPortugueseWord(firstTargetKw) : '';
    const firstWordStemMatchesTopic =
      firstTargetStem.length >= 4 &&
      (subtopicStems.has(firstTargetStem) || topicStems.has(firstTargetStem));

    if (
      matchedKws.length === targetKeywords.length ||
      (targetKeywords.length >= 2 && matchedKws.length / targetKeywords.length >= 0.5) ||
      firstWordStemMatchesTopic ||
      matchedKws.some((kw) => kw.length >= 5)
    ) {
      hasTopicSpoiler = true;
      warnings.push({
        code: 'TOPIC_SPOILER',
        field: 'topic',
        severity: 'error',
        message: `Spoiler no topic (radical/termo): entrega "${matchedKws[0] || firstTargetKw}" da resposta.`,
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
    missingMediaFiles,
  };

  return {
    cardId: card.id,
    isValid: warnings.length === 0,
    warnings,
    metrics,
  };
}

/**
 * Removes orphan/missing local <img src="..."> and <audio> tags from a card when the user
 * clicks "Remover mídia ausente" or when cleaning legacy missing audio/image tags.
 */
export function removeMissingMediaFromCard(
  card: CanonicalCard,
  availableMediaNames?: Iterable<string>
): CanonicalCard {
  const availableSet = new Set<string>();
  if (availableMediaNames) {
    for (const n of availableMediaNames) {
      if (n) {
        const clean = String(n).trim().toLowerCase();
        availableSet.add(clean);
        const base = clean.split(/[\\/]/).pop();
        if (base) availableSet.add(base);
      }
    }
  }

  const refs = extractCardMediaReferences(card, card.deck_key || 'deck');
  let question = card.question || '';
  let hint = card.hint || '';

  for (const ref of refs) {
    const raw = (ref.sourceUrl || '').trim();
    const isSelfContainedOrWeb = /^(?:https?:\/\/|data:)/i.test(raw);
    const isLoadedLocally =
      availableSet.has(ref.filename.toLowerCase()) ||
      availableSet.has(raw.toLowerCase());

    if (!isSelfContainedOrWeb && !isLoadedLocally) {
      question = question.replace(ref.rawTag, '').replace(/(?:<br\s*\/?>\s*)+$/i, '').trim();
      hint = hint.replace(ref.rawTag, '').replace(/(?:<br\s*\/?>\s*)+$/i, '').trim();
    }
  }

  const stillHasImgInQuestion = /<img\b/i.test(question);
  const stillHasImgInHint = /<img\b/i.test(hint);
  let nextImageMode = card.image_mode;
  if (card.image_mode === 'recognition' && !stillHasImgInQuestion) {
    nextImageMode = undefined;
    hint = hint.replace(/^<i>[\s\S]*?<\/i>(?:\s*<br\s*\/?>\s*)*/i, '').trim();
  } else if (card.image_mode === 'feedback' && !stillHasImgInHint) {
    nextImageMode = undefined;
  }

  const cleaned: CanonicalCard = {
    ...card,
    question,
    hint,
    image_mode: nextImageMode,
  };
  if (!nextImageMode) {
    delete cleaned.image_mode;
  }
  return surgicalRepairCardLocal(cleaned);
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
      const origQMedia = new Set(extractMediaFromString(originalCard.question || ''));
      const origMedia = extractMediaFromString(
        `${originalCard.question} ${originalCard.answer} ${originalCard.hint}`
      );
      for (const mediaTag of origMedia) {
        if (!question.includes(mediaTag) && !hint.includes(mediaTag)) {
          if (mediaTag.startsWith('<audio') || mediaTag.startsWith('[sound:')) {
            // Only keep audio if it has an embedded data: or https:// source
            if (/src=["'](?:https?:\/\/|data:)/i.test(mediaTag)) {
              hint = `${hint} ${mediaTag}`.trim();
            }
          } else if (!hasNewImage) {
            if (card.image_mode === 'recognition' || origQMedia.has(mediaTag)) {
              question = `${question} ${mediaTag}`.trim();
            } else if (hint) {
              const sep = /^<i>/i.test(hint.trim()) ? '<br>' : '<br><br>';
              hint = `${mediaTag}${sep}${hint.trim()}`;
            } else {
              hint = mediaTag;
            }
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
 * Separates leading <img> tags and optional <i>legend</i> from the textual Comentário body
 * so images/legends never receive a duplicate "<b>Comentário:</b>" prefix or inflate comment length.
 */
function splitLeadingMediaAndLegend(
  rawHint: string,
  topic: string,
  imageMode?: 'recognition' | 'feedback'
): { legendPrefix: string; bodyHint: string } {
  let working = rawHint.trim();

  // Strip spurious leading "<b>Comentário:</b>" emitted before leading <img> or when another Comentário: follows
  if (/^<b>\s*Coment[áa]rio:\s*<\/b>\s*(?:<img\b|<i>)/i.test(working)) {
    const afterSpurious = working.replace(/^<b>\s*Coment[áa]rio:\s*<\/b>\s*/i, '').trim();
    if (/^<img\b/i.test(afterSpurious) || /Coment[áa]rio:/i.test(afterSpurious)) {
      working = afterSpurious;
    }
  }

  let leadingImgs: string[] = [];
  if (imageMode === 'recognition') {
    working = working.replace(/<img\b[^>]*>/gi, '').trim();
  } else {
    const imgBlockMatch = working.match(/^(?:\s*<img\b[^>]*>\s*(?:<br\s*\/?>\s*)*)+/i);
    if (imgBlockMatch) {
      leadingImgs = imgBlockMatch[0].match(/<img\b[^>]*>/gi) || [];
      working = working.slice(imgBlockMatch[0].length).replace(/^(?:<br\s*\/?>\s*)+/i, '').trim();
    }
  }

  let legendHtml = '';
  const italicMatch = working.match(/^<i>[\s\S]*?<\/i>/i);
  const restAfterItalic = italicMatch
    ? working.slice(italicMatch[0].length).replace(/^(?:<br\s*\/?>\s*)+/i, '').trim()
    : '';
  const hasCommentAfterLegend = Boolean(italicMatch) && /^(?:<b>\s*)?Coment[áa]rio:(?:\s*<\/b>)?/i.test(restAfterItalic);

  if (imageMode === 'recognition') {
    if (italicMatch) {
      legendHtml = italicMatch[0];
      working = restAfterItalic;
    } else {
      legendHtml = `<i>Achado complementar demonstrando padrão característico de ${stripHtml(topic)}.</i>`;
    }
  } else if (italicMatch && (hasCommentAfterLegend || leadingImgs.length > 0)) {
    legendHtml = italicMatch[0];
    working = restAfterItalic;
  }

  const prefixParts: string[] = [];
  if (leadingImgs.length > 0) prefixParts.push(leadingImgs.join('<br>'));
  if (legendHtml) prefixParts.push(legendHtml);

  const legendPrefix = prefixParts.length > 0 ? `${prefixParts.join('<br>')}<br><br>` : '';
  return { legendPrefix, bodyHint: working };
}

/**
 * Highlights the first significant medical token in bold if the comment lacks inline <b> emphasis,
 * avoiding synthetic boilerplate text injection.
 */
function ensureBoldEmphasisInComment(textHint: string): string {
  const afterPrefix = textHint.replace(/^<b>\s*Coment[áa]rio:\s*<\/b>\s*/i, '');
  if (/<(?:b|strong)\b/i.test(afterPrefix)) return textHint;

  const prefixMatch = textHint.match(/^<b>\s*Coment[áa]rio:\s*<\/b>\s*/i);
  const prefix = prefixMatch ? prefixMatch[0] : '<b>Comentário:</b> ';
  const body = prefixMatch ? textHint.slice(prefix.length) : textHint;

  // Bold the first standalone 5+ letter token outside HTML tags
  const parts = body.split(/(<\/?[a-zA-Z!][^>]*>)/g);
  let bolded = false;
  const updated = parts
    .map((part) => {
      if (bolded || /^<\/?[a-zA-Z!]/.test(part)) return part;
      const m = part.match(/\b([A-Za-zÀ-ú]{5,}(?:-[A-Za-zÀ-ú0-9]+)?)\b/);
      if (!m || m.index === undefined) return part;
      bolded = true;
      return `${part.slice(0, m.index)}<b>${m[1]}</b>${part.slice(m.index + m[1].length)}`;
    })
    .join('');

  return `${prefix}${updated}`;
}

/**
 * Truncates a Comentário HTML string within maxVisibleChars at sentence or whole-word boundaries,
 * preserving inline HTML tags (<b>, <i>) and never cutting words in half.
 */
function truncateCommentHtmlPreservingWords(textHint: string, maxVisibleChars: number): string {
  const prefixMatch = textHint.match(/^<b>\s*Coment[áa]rio:\s*<\/b>\s*/i);
  const prefix = prefixMatch ? prefixMatch[0] : '<b>Comentário:</b> ';
  const bodyHtml = prefixMatch ? textHint.slice(prefix.length) : textHint;

  const plainBody = stripHtml(bodyHtml);
  if (plainBody.length <= maxVisibleChars) return textHint;

  // Compute safe character budget on plainBody: prefer last complete sentence >= 110 chars
  const head = plainBody.slice(0, maxVisibleChars);
  let budget = -1;
  const sentenceEnds = Array.from(head.matchAll(/[.!?](?=\s|$)/g));
  if (sentenceEnds.length > 0) {
    const lastEnd = sentenceEnds[sentenceEnds.length - 1].index!;
    if (lastEnd + 1 >= 110) {
      budget = lastEnd + 1;
    }
  }
  if (budget < 0) {
    const lastSpace = head.lastIndexOf(' ');
    budget = lastSpace >= 60 ? lastSpace : maxVisibleChars;
  }

  // Walk bodyHtml emitting tags and up to `budget` visible characters
  const tokens = bodyHtml.split(/(<\/?[a-zA-Z!][^>]*>)/g);
  const openTags: string[] = [];
  let emitted = 0;
  let out = '';

  for (const tok of tokens) {
    if (!tok) continue;
    if (/^<\/?[a-zA-Z!]/.test(tok)) {
      const closeM = tok.match(/^<\/([a-z0-9]+)/i);
      const openM = tok.match(/^<([a-z0-9]+)\b[^>]*>$/i);
      if (closeM) {
        const tag = closeM[1].toLowerCase();
        const idx = openTags.lastIndexOf(tag);
        if (idx >= 0) openTags.splice(idx, 1);
        out += tok;
      } else if (openM && !/^<(?:br|hr|img)\b/i.test(tok) && !tok.endsWith('/>')) {
        if (emitted < budget) {
          openTags.push(openM[1].toLowerCase());
          out += tok;
        }
      } else if (emitted < budget) {
        out += tok;
      }
      continue;
    }

    if (emitted >= budget) break;
    const remaining = budget - emitted;
    if (tok.length <= remaining) {
      out += tok;
      emitted += tok.length;
    } else {
      out += tok.slice(0, remaining);
      emitted += remaining;
      break;
    }
  }

  out = out.replace(/[\s,;:-]+$/, '').trim();
  for (let i = openTags.length - 1; i >= 0; i--) {
    out += `</${openTags[i]}>`;
  }
  if (!/[.!?]$/.test(stripHtml(out))) {
    out += '.';
  }
  return `${prefix}${out}`;
}

/**
 * Eliminates TOPIC_SPOILER even when the leaking radical resides in the prefix before " - ".
 */
function sanitizeTopicAgainstSpoiler(
  card: CanonicalCard,
  topic: string,
  question: string,
  answer: string,
  hint: string
): string {
  const prefix = (topic.split(' - ')[0] || 'Tema Clínico').trim();
  const candidateWithNeutralSub = `${prefix} - Tomada de Decisão e Conduta`;
  if (!lintCard({ ...card, topic: candidateWithNeutralSub, question, answer, hint }).metrics.hasTopicSpoiler) {
    return candidateWithNeutralSub;
  }

  // Filter out prefix words whose stem/prefix collides with target answer stems
  const targetStr = card.type === 'basic' ? answer : question;
  const targetKws = extractCoreKeywords(targetStr);
  const targetStems = new Set(targetKws.map((k) => stemPortugueseWord(k)).filter((s) => s.length >= 4));
  const prefixTokens = prefix.split(/\s+/).filter(Boolean);
  const safeTokens = prefixTokens.filter((tok) => {
    const kws = extractCoreKeywords(tok);
    if (kws.length === 0) return true;
    return !kws.some((kw) => {
      const st = stemPortugueseWord(kw);
      if (st.length >= 4 && targetStems.has(st)) return true;
      if (st.length >= 5) {
        for (const ts of targetStems) {
          if (ts.length >= 5 && ts.slice(0, 5) === st.slice(0, 5)) return true;
        }
      }
      return false;
    });
  });

  const safeNonConnectors = safeTokens.filter((t) => extractCoreKeywords(t).length > 0);
  if (safeNonConnectors.length >= 2) {
    const cleanedPrefix = safeTokens.join(' ').replace(/^(?:de|da|do|das|dos|em|na|no)\s+/i, '').trim();
    if (cleanedPrefix) {
      const candidate = `${cleanedPrefix} - Tomada de Decisão e Conduta`;
      if (!lintCard({ ...card, topic: candidate, question, answer, hint }).metrics.hasTopicSpoiler) {
        return candidate;
      }
    }
  }

  for (const fallbackPrefix of ['Manejo Clínico', 'Conduta Médica', 'Avaliação Diagnóstica', 'Tema Clínico']) {
    const candidate = `${fallbackPrefix} - Tomada de Decisão e Conduta`;
    if (!lintCard({ ...card, topic: candidate, question, answer, hint }).metrics.hasTopicSpoiler) {
      return candidate;
    }
  }
  return 'Tema Clínico - Tomada de Decisão e Conduta';
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

  // 3B. Fix Matuschak unfocused set prompts ("Quais são as causas/critérios...?", "Cite...") -> focused single-attribute prompt
  question = question.replace(
    /\b(?:quais\s+(?:s[aã]o\s+)?(?:os|as)\s+(?:principais\s+)?(causas|crit[eé]rios|sintomas|sinais|fatores|manifesta[cç][oõ]es|complica[cç][oõ]es|indica[cç][oõ]es|etapas|tipos)|cite\s+(?:os|as|\d+)\s+([a-zà-ú]+)|liste\s+(?:os|as)\s+([a-zà-ú]+))/gi,
    'Qual o achado ou parâmetro determinante de primeira linha'
  );

  // 3C. Fix Nielsen passive definition prompt ("O que é X?", "Defina X") -> salience clinical prompt
  if (
    /^\s*(?:o\s+que\s+[eé]\s+(?:o|a|um|uma)?\s*([a-zà-ú0-9\s-]{2,40})\??|defina\s+([a-zà-ú0-9\s-]{2,40})\.?|fale\s+sobre\s+(.+))$/i.test(
      stripHtml(question).trim()
    )
  ) {
    const cleanSub = stripHtml(topic.split(' - ').pop() || topic);
    question = `Diante de suspeita clínica de ${cleanSub}, qual o achado determinante ou conduta imediata de primeira escolha?`;
  }

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

    // Strip numbered/bulleted multi-item lists in basic answers (Matuschak Focused)
    if (/(?:^|\s)(?:1[.)]\s+.+2[.)]\s+|[-•]\s+.+[-•]\s+)/.test(answer)) {
      answer = answer
        .replace(/^\s*(?:1[.)]|[-•])\s*/, '')
        .split(/\s+(?:2[.)]|[-•])\s+/)[0]
        .trim();
    }

    // Replace binary Yes/No answers with atomic clinical conduct (Nielsen & Matuschak)
    if (/^(?:sim|n[aã]o|verdadeiro|falso)(?:[.,!]\s*|$)/i.test(stripHtml(answer).trim())) {
      const afterBinary = stripHtml(answer)
        .replace(/^(?:sim|n[aã]o|verdadeiro|falso)[.,!:\s-]*/i, '')
        .trim();
      answer = afterBinary || `Conduta imediata guiada por ${stripHtml(topic.split(' - ').pop() || topic)}`;
    }

    let plainWords = stripHtml(answer).replace(/\.$/, '').split(/\s+/).filter(Boolean);
    if (plainWords.length > MAX_BASIC_ANSWER_WORDS || stripHtml(answer).length > MAX_BASIC_ANSWER_CHARS) {
      answer = answer
        .replace(/\bpor\s+via\s+intravenosa\b/gi, 'IV')
        .replace(/\bvia\s+intravenosa\b/gi, 'IV')
        .replace(/\bpor\s+via\s+oral\b/gi, 'VO')
        .replace(/\bvia\s+oral\b/gi, 'VO')
        .replace(/\bdose\s+[úu]nica\b/gi, 'DU')
        .replace(/\bassociad[ao]s?\s+[àa]o?\b/gi, '+');
      plainWords = stripHtml(answer).replace(/\.$/, '').split(/\s+/).filter(Boolean);
    }
    if (plainWords.length > MAX_BASIC_ANSWER_WORDS || stripHtml(answer).length > MAX_BASIC_ANSWER_CHARS) {
      let cut = Math.min(plainWords.length, MAX_BASIC_ANSWER_WORDS);
      while (cut > 1 && plainWords.slice(0, cut).join(' ').length > MAX_BASIC_ANSWER_CHARS - 1) {
        cut--;
      }
      // Never slice right between a number and its measurement unit, nor end on a dangling stopword
      while (
        cut > 1 &&
        (DANGLING_STOPWORDS.has(plainWords[cut - 1].toLowerCase().replace(/[,;:.]/g, '')) ||
          /^\d+(?:[.,]\d+)?$/.test(plainWords[cut - 1]))
      ) {
        cut--;
      }
      // Also avoid leaving an orphan drug/noun before a removed bare number if the slice ended at a preposition
      while (
        cut > 1 &&
        DANGLING_STOPWORDS.has(plainWords[cut - 1].toLowerCase().replace(/[,;:.]/g, ''))
      ) {
        cut--;
      }
      answer = plainWords.slice(0, cut).join(' ').replace(/[,;:+]+$/, '').trim();
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
    topic = sanitizeTopicAgainstSpoiler(card, topic, question, answer, hint);
  }

  // Restore media in question if needed
  for (const m of mediaInQuestion) {
    if (!question.includes(m)) {
      question = `${question} ${m}`.trim();
    }
  }

  // 7. Normalize Hint structure & automatically remove orphan <audio> tags without files
  question = stripOrphanAudioFromHtml(question).cleanedHtml;
  hint = stripOrphanAudioFromHtml(hint).cleanedHtml;

  hint = hint
    .replace(/<b>\s*🩺\s*Preceptoria[^<]*:?<\/b>\s*/gi, '')
    .replace(/<b>\s*⚠️\s*Armadilha[^<]*:?<\/b>\s*/gi, '')
    .replace(/🎯\s*\[ALVO DE BANCA\]\s*/gi, '')
    .replace(/🚨\s*\[BEIRA-LEITO\]\s*/gi, '')
    .replace(/\[BUSCAR\s+IMAGEM[^\]]*\]\s*/gi, '');

  const audioBlocks = hint.match(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi) || [];
  const hintWithoutAudio = hint.replace(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi, '').trim();

  // Preserve leading <img> and visual <i>legend</i> before <b>Comentário:</b>
  const { legendPrefix, bodyHint } = splitLeadingMediaAndLegend(
    hintWithoutAudio,
    topic,
    card.image_mode
  );
  let textHint = bodyHint;

  if (!/^<b>\s*Coment[áa]rio:\s*<\/b>/i.test(textHint)) {
    textHint = `<b>Comentário:</b> ${textHint.replace(/^Coment[áa]rio:\s*/i, '')}`.trim();
  }

  textHint = ensureBoldEmphasisInComment(textHint);

  let visLen = extractCommentVisibleText(textHint).length;
  if (visLen > MAX_COMMENT_CHARS) {
    for (const [pattern, repl] of MEDICAL_ABBREVIATIONS) {
      textHint = textHint.replace(pattern, repl);
    }
    visLen = extractCommentVisibleText(textHint).length;
  }

  if (visLen > MAX_COMMENT_CHARS) {
    textHint = truncateCommentHtmlPreservingWords(textHint, MAX_COMMENT_CHARS);
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
 * Converts a Basic card into a Cloze card with a single 1–5 word {{c1::...}} gap,
 * keeping measurement units outside the gap.
 * If forceConvertWithFeedbackImage is true and the card has an <img> in question,
 * moves the <img> to hint (feedback mode) so the deck can strictly satisfy the 45%-55% Basic/Cloze ratio.
 */
export function convertBasicToCloze(
  card: CanonicalCard,
  forceConvertWithFeedbackImage: boolean = false
): CanonicalCard {
  const hasQuestionImg = /<img\b/i.test(card.question || '');
  if ((card.image_mode === 'recognition' || hasQuestionImg) && !forceConvertWithFeedbackImage) {
    return surgicalRepairCardLocal(card);
  }

  let workingQuestion = card.question || '';
  let workingHint = card.hint || '';
  let nextImageMode = card.image_mode;

  if (hasQuestionImg) {
    const imgs = workingQuestion.match(/<img\b[^>]*>/gi) || [];
    workingQuestion = workingQuestion
      .replace(/\s*(?:<br\s*\/?>\s*)*<img\b[^>]*>/gi, '')
      .trim();
    workingHint = workingHint.replace(/^<i>[\s\S]*?<\/i>(?:\s*<br\s*\/?>\s*)*/i, '').trim();
    if (imgs[0] && !workingHint.includes(imgs[0])) {
      workingHint = `${workingHint}<br>${imgs[0]}`;
    }
    nextImageMode = 'feedback';
  }

  const rawAnswer = stripHtml(card.answer || '')
    .replace(/^(?:Resposta|R):\s*/i, '')
    .replace(/[.?!;]+$/, '')
    .trim();
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

  const rawQuestion = stripClozeMarkup(workingQuestion).trim();
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

  const converted: CanonicalCard = {
    ...card,
    type: 'cloze',
    image_mode: nextImageMode,
    question: declarativeQuestion,
    answer: '',
    hint: workingHint,
  };
  if (!nextImageMode) {
    delete converted.image_mode;
  }
  return surgicalRepairCardLocal(converted);
}

/**
 * Audits, prunes redundant/overlapping cards (excluding their IDs), adds missing P1-P4 concepts
 * from the Clinical Map (creating new sequential IDs), and repairs Matuschak & Nielsen violations
 * while preserving each card's natural format (basic/cloze, no rigid 50/50 quota) and original FSRS IDs.
 */
export function curateAndRebalanceDeck(
  inputCards: CanonicalCard[],
  metadata: ExtractedDeckMetadata,
  deckKey: string,
  clinicalMap?: ClinicalMapResponse | null,
  options?: { skipTemplateGapAdditions?: boolean }
): { cards: CanonicalCard[]; stats: DeckCurationStats } {
  const originalCount =
    metadata.rawCards && metadata.rawCards.length > 0
      ? metadata.rawCards.length
      : inputCards.length;

  const existingIdSet = new Set<number>(metadata.existingIds || []);
  const originalTypeById = new Map<number, 'basic' | 'cloze'>();
  for (const c of metadata.rawCards || []) {
    if (Number.isFinite(c.id)) {
      const numId = Number(c.id);
      existingIdSet.add(numId);
      originalTypeById.set(numId, c.type === 'cloze' ? 'cloze' : 'basic');
    }
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

  if (!options?.skipTemplateGapAdditions && clinicalMap && Array.isArray(clinicalMap.items)) {
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

        const conceptWords = stripHtml(cleanConcept).split(/\s+/).filter(Boolean);
        const shortTargetWords = conceptWords.slice(0, Math.min(conceptWords.length, 4));
        while (
          shortTargetWords.length > 1 &&
          DANGLING_STOPWORDS.has(
            shortTargetWords[shortTargetWords.length - 1].toLowerCase().replace(/[,;:.]/g, '')
          )
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

  // Step 4: Reconcile IDs and media by ID preserving each card's natural format (basic vs cloze without rigid 50/50 quota)
  const reconciled = reconcileDeckIdsAndMedia(survivingCards, metadata, cleanDeckKey).map((c) =>
    surgicalRepairCardLocal(c)
  );

  const finalCount = reconciled.length;
  const finalBasic = reconciled.filter((c) => c.type === 'basic').length;
  const basicPct = finalCount > 0 ? Math.round((finalBasic / finalCount) * 100) : 0;
  const clozePct = finalCount > 0 ? 100 - basicPct : 0;
  const preservedIdsCount = reconciled.filter((c) => existingIdSet.has(Number(c.id))).length;
  const finalPrunedCount =
    existingIdSet.size > 0
      ? Math.max(prunedCount, existingIdSet.size - preservedIdsCount)
      : prunedCount;
  const finalAddedCount =
    existingIdSet.size > 0
      ? Math.max(addedCount, reconciled.filter((c) => !existingIdSet.has(Number(c.id))).length)
      : addedCount;
  const convertedCount =
    originalTypeById.size > 0
      ? reconciled.filter((c) => {
          const origType = originalTypeById.get(Number(c.id));
          return Boolean(origType && origType !== c.type);
        }).length
      : 0;

  return {
    cards: reconciled,
    stats: {
      originalCount,
      finalCount,
      prunedCount: finalPrunedCount,
      addedCount: finalAddedCount,
      convertedCount,
      preservedIdsCount,
      basicPct,
      clozePct,
    },
  };
}

/**
 * Guarantees that any deck with >= 2 cards strictly respects the 45% to 55% Basic / Cloze range,
 * converting excess cards toward 50%/50% if the deck falls outside 45%–55% (e.g. 44%/56%).
 */
export function enforceStrictDeckRatio(
  inputCards: CanonicalCard[]
): { cards: CanonicalCard[]; convertedCount: number } {
  const working = inputCards.map((c) => ({ ...c }));
  const total = working.length;
  if (total < 2) {
    return { cards: working, convertedCount: 0 };
  }

  const currentBasicCount = working.filter((c) => c.type === 'basic').length;
  const currentBasicPct = Math.round((currentBasicCount / total) * 100);
  const targetBasicCount = Math.round(total * 0.5);
  let convertedCount = 0;

  if (currentBasicPct < 45 || currentBasicCount < targetBasicCount) {
    const needed = targetBasicCount - currentBasicCount;
    let converted = 0;
    for (let i = 0; i < working.length && converted < needed; i++) {
      if (working[i].type === 'cloze') {
        working[i] = convertClozeToBasic(working[i]);
        converted++;
        convertedCount++;
      }
    }
  } else if (currentBasicPct > 55 || currentBasicCount > targetBasicCount) {
    const needed = currentBasicCount - targetBasicCount;
    let converted = 0;
    // Pass 1: convert basic cards that do NOT have <img> in question
    for (let i = 0; i < working.length && converted < needed; i++) {
      const card = working[i];
      if (
        card.type === 'basic' &&
        card.image_mode !== 'recognition' &&
        !/<img\b/i.test(card.question || '')
      ) {
        working[i] = convertBasicToCloze(card, false);
        if (working[i].type === 'cloze') {
          converted++;
          convertedCount++;
        }
      }
    }
    // Pass 2: if still above targetBasicCount, force-convert remaining basic cards by moving <img> to feedback mode
    for (let i = 0; i < working.length && converted < needed; i++) {
      const card = working[i];
      if (card.type === 'basic') {
        working[i] = convertBasicToCloze(card, true);
        if (working[i].type === 'cloze') {
          converted++;
          convertedCount++;
        }
      }
    }
  }

  return { cards: working, convertedCount };
}

const BASE91_TABLE =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';

/**
 * Generates a deterministic positive integer deck_id from a deck_key string.
 */
export function computeDeterministicDeckId(deckKey: string): number {
  const clean = (deckKey || 'internato_deck').trim().toLowerCase();
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= ch * 31;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return 1730000000000 + ((h1 * 1000 + (h2 % 1000)) % 9000000000);
}

/**
 * Computes a deterministic Anki GUID for `<deckKey>:id:<noteId>` or returns the existing entry
 * from `note_guid_registry.json`, preserving 100% of Anki's FSRS schedule on re-import.
 */
export function resolveOrCreateNoteGuid(
  deckKey: string,
  deckId: number,
  noteId: number,
  registryEntries: Record<string, string>
): { guid: string; key: string } {
  const cleanKey = (deckKey || 'deck').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  const regKey = `${cleanKey}:id:${noteId}`;
  if (registryEntries[regKey]) {
    return { guid: registryEntries[regKey], key: regKey };
  }

  // Deterministic 10-char base91 hash from ("criador-de-cards", deckId, regKey)
  const seed = `criador-de-cards__${deckId}__${regKey}`;
  let hA = 0x9e3779b9;
  let hB = 0x243f6a88;
  for (let i = 0; i < seed.length; i++) {
    const code = seed.charCodeAt(i);
    hA = Math.imul(hA ^ code, 0x85ebca6b) >>> 0;
    hB = Math.imul(hB ^ (code + i), 0xc2b2ae35) >>> 0;
  }
  let val = (BigInt(hA) << 32n) | BigInt(hB);
  if (val === 0n) val = BigInt(noteId || 1);

  const base = BigInt(BASE91_TABLE.length);
  let guid = '';
  while (val > 0n) {
    const rem = Number(val % base);
    guid = BASE91_TABLE[rem] + guid;
    val = val / base;
  }
  registryEntries[regKey] = guid;
  return { guid, key: regKey };
}


