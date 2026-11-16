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
  WarningCode,
} from '../types/deck';

export const MAX_CLOZE_WORDS = 5;
export const MAX_BASIC_ANSWER_WORDS = 15;
export const MAX_BASIC_ANSWER_CHARS = 110;
export const MAX_QUESTION_WORDS = 50;
export const MAX_COMMENT_CHARS = 320;
export const MIN_VISUAL_LEGEND_WORDS = 6;

export type DeckAuditWarningCode =
  | WarningCode
  | 'DUPLICATE_IMAGE_IN_DECK'
  | 'IMAGE_MISSING_LEGEND'
  | 'MODALITY_CONFLICT'
  | 'REDUNDANT_VISUAL_DESCRIPTION';

export interface DeckAuditWarning {
  code: DeckAuditWarningCode;
  cardId?: number;
  cardIds?: number[];
  src?: string;
  field: 'question' | 'answer' | 'hint' | 'topic' | 'type' | 'deck';
  message: string;
  severity: 'error' | 'warning';
}

export interface DuplicateDeckImage {
  src: string;
  normalizedSrc: string;
  cardIds: number[];
}

export interface DeckAuditResult {
  deckKey: string;
  isValid: boolean;
  canExport: boolean;
  errorCount: number;
  warningCount: number;
  errors: DeckAuditWarning[];
  warnings: DeckAuditWarning[];
  allIssues: DeckAuditWarning[];
  duplicateImages: DuplicateDeckImage[];
  cardResults: CardLintResult[];
}

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
  [/&ge;/gi, '≥'],
  [/&le;/gi, '≤'],
  [/&plusmn;/gi, '±'],
  [/&times;/gi, '×'],
  [/&divide;/gi, '÷'],
  [/&deg;/gi, '°'],
  [/&rarr;/gi, '→'],
  [/&larr;/gi, '←'],
  [/&uarr;/gi, '↑'],
  [/&darr;/gi, '↓'],
  [/&ndash;/gi, '–'],
  [/&mdash;/gi, '—'],
  [/&alpha;/gi, 'α'],
  [/&beta;/gi, 'β'],
  [/&gamma;/gi, 'γ'],
  [/&delta;/g, 'δ'],
  [/&Delta;/g, 'Δ'],
  [/&mu;|&micro;/gi, 'μ'],
  [/&nbsp;/gi, ' '],
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
    .replace(/&le;/gi, '≤')
    .replace(/&ge;/gi, '≥')
    .replace(/&plusmn;/gi, '±')
    .replace(/&times;/gi, '×')
    .replace(/&divide;/gi, '÷')
    .replace(/&deg;/gi, '°')
    .replace(/&rarr;/gi, '→')
    .replace(/&larr;/gi, '←')
    .replace(/&uarr;/gi, '↑')
    .replace(/&darr;/gi, '↓')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&alpha;/gi, 'α')
    .replace(/&beta;/gi, 'β')
    .replace(/&gamma;/gi, 'γ')
    .replace(/&delta;/g, 'δ')
    .replace(/&Delta;/g, 'Δ')
    .replace(/&mu;|&micro;/gi, 'μ')
    .replace(/&apos;|&#0*39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    })
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SanitizeMedicalHtmlOptions {
  highlightCloze?: boolean;
  clozeMode?: 'inline' | 'front' | 'back';
  stripImgs?: boolean;
  localMediaAssets?: Record<string, string>;
  stripUnresolvedPlaceholderImgs?: boolean;
}

function escapeHtmlAttr(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeSafeTextSegment(segment: string): string {
  return segment
    .replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Sanitizes medical flashcard HTML strictly against XSS (<script>, event handlers, javascript: URIs)
 * while preserving safe formatting tags (b, strong, i, em, u, sub, sup, br, p, ul, ol, li, span, hr),
 * clinical comparison tables (table.med-table, thead, tbody, tr, th, td), optional <img> with
 * localMediaAssets substitution, and Cloze highlights.
 */
export function sanitizeMedicalHtml(
  rawHtml: string,
  options: SanitizeMedicalHtmlOptions = {}
): string {
  if (!rawHtml) return '';

  const {
    highlightCloze = false,
    clozeMode = 'inline',
    stripImgs = false,
    localMediaAssets,
    stripUnresolvedPlaceholderImgs = false,
  } = options;

  const localMap = new Map<string, string>();
  if (localMediaAssets) {
    for (const [k, v] of Object.entries(localMediaAssets)) {
      if (k && typeof v === 'string' && v.trim()) {
        const cleanK = k.trim().toLowerCase();
        localMap.set(cleanK, v.trim());
        const base = cleanK.split(/[\\/]/).pop();
        if (base) localMap.set(base, v.trim());
      }
    }
  }

  const working = rawHtml
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[\s\S]*?<\/embed>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const SIMPLE_TAGS = new Set([
    'b',
    'strong',
    'i',
    'em',
    'u',
    'sub',
    'sup',
    'p',
    'ul',
    'ol',
    'li',
    'span',
    'thead',
    'tbody',
    'tr',
  ]);

  const tagRegex = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let out = '';
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(working)) !== null) {
    out += escapeSafeTextSegment(working.slice(lastIdx, match.index));
    lastIdx = match.index + match[0].length;

    const isClosing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const rawAttrs = match[3] || '';

    if (tag === 'br') {
      if (!isClosing) out += '<br />';
      continue;
    }
    if (tag === 'hr') {
      if (!isClosing) out += '<hr class="med-divider" />';
      continue;
    }
    if (SIMPLE_TAGS.has(tag)) {
      out += isClosing ? `</${tag}>` : `<${tag}>`;
      continue;
    }
    if (tag === 'table') {
      out += isClosing ? '</table>' : '<table class="med-table">';
      continue;
    }
    if (tag === 'th' || tag === 'td') {
      if (isClosing) {
        out += `</${tag}>`;
      } else {
        const spanAttrs: string[] = [];
        const colspanMatch = rawAttrs.match(/\bcolspan=["']?(\d{1,2})["']?/i);
        const rowspanMatch = rawAttrs.match(/\browspan=["']?(\d{1,2})["']?/i);
        if (colspanMatch?.[1]) spanAttrs.push(`colspan="${colspanMatch[1]}"`);
        if (rowspanMatch?.[1]) spanAttrs.push(`rowspan="${rowspanMatch[1]}"`);
        out += spanAttrs.length > 0 ? `<${tag} ${spanAttrs.join(' ')}>` : `<${tag}>`;
      }
      continue;
    }
    if (tag === 'img' && !isClosing) {
      if (stripImgs) continue;
      const srcMatch = rawAttrs.match(/\bsrc=["']([^"']+)["']/i);
      const rawSrc = (srcMatch?.[1] || '').trim();
      if (!rawSrc) continue;

      if (/^(?:pdfimg|buscar_imagem):/i.test(rawSrc)) {
        if (stripUnresolvedPlaceholderImgs) continue;
        const label = escapeHtmlAttr(rawSrc);
        out += `<span class="inline-block px-1.5 py-0.5 my-1 rounded bg-amber-950/70 border border-amber-700/70 text-[11px] font-mono text-amber-200">[Imagem pendente: ${label}]</span>`;
        continue;
      }

      if (/^(?:javascript|vbscript):/i.test(rawSrc)) continue;
      if (/^data:/i.test(rawSrc) && !/^data:image\//i.test(rawSrc)) continue;

      let resolvedSrc = rawSrc;
      if (!/^(?:https?:|data:|blob:|\/)/i.test(rawSrc)) {
        const lowerRaw = rawSrc.toLowerCase();
        const lowerBase = (lowerRaw.split(/[\\/]/).pop() || lowerRaw).trim();
        const dataMatch = localMap.get(lowerRaw) || localMap.get(lowerBase);
        if (dataMatch) {
          resolvedSrc = dataMatch;
        } else {
          out += `<span class="inline-block px-1.5 py-0.5 my-1 rounded bg-slate-800 border border-slate-700 text-[11px] font-mono text-amber-300">[Arquivo local: ${escapeHtmlAttr(lowerBase)}]</span>`;
          continue;
        }
      }

      const altMatch = rawAttrs.match(/\balt=["']([^"']*)["']/i);
      const altAttr = altMatch?.[1]
        ? ` alt="${escapeHtmlAttr(altMatch[1])}"`
        : ' alt="Imagem clínica"';
      out += `<img src="${escapeHtmlAttr(resolvedSrc)}"${altAttr} referrerpolicy="no-referrer" />`;
      continue;
    }
  }

  out += escapeSafeTextSegment(working.slice(lastIdx));

  if (stripImgs) {
    out = out
      .replace(/^(?:\s*<br\s*\/?>\s*)+/i, '')
      .replace(/(?:\s*<br\s*\/?>\s*)+$/i, '')
      .trim();
  }

  if (highlightCloze) {
    out = out.replace(
      /\{\{c\d+::([\s\S]*?)(?:::([\s\S]*?))?\}\}/gi,
      (_m, inner: string, explicitHint?: string) => {
        const target = String(inner || '').split('::')[0].trim();
        if (clozeMode === 'front') {
          const hintLabel = explicitHint || String(inner || '').split('::')[1] || '';
          const label = hintLabel.trim() ? `[...${hintLabel.trim()}...]` : '[...]';
          return `<span class="px-1.5 py-0.5 rounded bg-sky-950/90 border border-sky-500/60 text-sky-300 font-semibold">${label}</span>`;
        }
        if (clozeMode === 'back') {
          return `<span class="px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-500/70 text-emerald-300 font-bold">${target}</span>`;
        }
        return `<span class="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-sky-500/15 border border-sky-400/40 text-sky-300 font-semibold">${target}</span>`;
      }
    );
  }

  return out;
}

/**
 * Extracts only the visible text after <b>Comentário:</b> (excluding <table>, <img>, <i> legend, and <audio>),
 * matching lint.py and refiner.py.
 */
export function extractCommentVisibleText(hint: string): string {
  if (!hint) return '';
  let cleaned = hint.replace(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi, ' ');
  cleaned = cleaned.replace(/<table[\s\S]*?<\/table>/gi, ' ');
  cleaned = cleaned.replace(/<table\b[\s\S]*$/gi, ' ');
  cleaned = cleaned.replace(/^(?:\s*<img\b[^>]*>\s*(?:<br\s*\/?>\s*)*)+/i, ' ');
  const parts = cleaned.split(/Coment[áa]rio:/i);
  const afterComment =
    parts.length > 1
      ? parts.slice(1).join('Comentário:')
      : cleaned.replace(/^\s*<i>[\s\S]*?<\/i>(?:\s*<br\s*\/?>\s*)*/i, ' ');
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
 * Ensures that exported Anki cards never point to volatile external https:// URLs or raw inline base64 strings,
 * while preserving existing local filenames (including accented Portuguese chars and commas) intact.
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
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_') || 'deck';

  // 1. Check explicit data-anki-file attribute if present
  const attrMatch = rawImgTag.match(/\bdata-anki-file=["']([^"']+)["']/i);
  if (attrMatch && attrMatch[1]) {
    const cleanAttr = attrMatch[1]
      .trim()
      .replace(/[\s"<>|?*\\/]+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '');
    if (cleanAttr) return cleanAttr;
  }

  const src = (rawSrc || '').trim();
  // 2. If already a local filename (not http/https/data/blob/pdfimg/buscar_imagem)
  if (src && !/^(?:https?:|data:|blob:|pdfimg:|buscar_imagem:|\/)/i.test(src)) {
    const base = (src.split(/[\\/]/).pop() || src).trim();
    return base.replace(/[\s"<>|?*]+/g, '_');
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
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
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
      .replace(/[\s"<>|?*\\/]+/g, '_');
    if (cleanAttr) return cleanAttr;
  }

  const src = (rawSrc || '').trim();
  if (src && !/^(?:https?:|data:|blob:|\/)/i.test(src)) {
    const base = (src.split(/[\\/]/).pop() || src).trim();
    return base.replace(/[\s"<>|?*]+/g, '_');
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
  deckKey: string = 'deck',
  overrideResolver?: (
    kind: 'image' | 'audio',
    rawTag: string,
    srcVal: string,
    defaultName: string,
    index: number
  ) => string
): string {
  if (!htmlText) return '';
  let imgIdx = 0;
  let audioIdx = 0;
  let out = htmlText.replace(
    /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
    (fullTag, srcVal: string) => {
      const idx = imgIdx++;
      const baseName = resolveLocalMediaFilename(fullTag, srcVal, cardId, idx, deckKey);
      const localName = overrideResolver
        ? overrideResolver('image', fullTag, srcVal, baseName, idx)
        : baseName;
      return `<img src="${localName}">`;
    }
  );

  out = out.replace(
    /<audio\b[^>]*>[\s\S]*?<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/audio>/gi,
    (fullTag, srcVal: string) => {
      const idx = audioIdx++;
      const baseName = resolveLocalAudioFilename(fullTag, srcVal, cardId, idx, deckKey);
      const localName = overrideResolver
        ? overrideResolver('audio', fullTag, srcVal, baseName, idx)
        : baseName;
      return `<audio controls preload="none" class="med-audio"><source src="${localName}" type="audio/mpeg"></audio>`;
    }
  );

  out = out.replace(
    /<audio\b[^>]*\bsrc=["']([^"']+)["'][^>]*>(?:[\s\S]*?<\/audio>)?/gi,
    (fullTag, srcVal: string) => {
      const idx = audioIdx++;
      const baseName = resolveLocalAudioFilename(fullTag, srcVal, cardId, idx, deckKey);
      const localName = overrideResolver
        ? overrideResolver('audio', fullTag, srcVal, baseName, idx)
        : baseName;
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

function disambiguateMediaFilename(
  baseFilename: string,
  cardId: number,
  usedLowerFilenames: Set<string>
): string {
  if (!usedLowerFilenames.has(baseFilename.toLowerCase())) {
    return baseFilename;
  }
  const extMatch = baseFilename.match(/(\.[a-z0-9]{2,5})$/i);
  const ext = extMatch ? extMatch[1] : '';
  const stem = ext ? baseFilename.slice(0, baseFilename.length - ext.length) : baseFilename;
  let candidate = `${stem}_${cardId}${ext}`;
  let suffix = 2;
  while (usedLowerFilenames.has(candidate.toLowerCase())) {
    candidate = `${stem}_${cardId}_${suffix++}${ext}`;
  }
  return candidate;
}

export interface DeckMediaResolution {
  manifest: MediaBundleItem[];
  resolveFilenameForField: (
    cardId: number,
    field: 'question' | 'hint',
    kind: 'image' | 'audio',
    srcVal: string,
    defaultName: string
  ) => string;
}

/**
 * Resolves deck-wide collision-free local Anki filenames so distinct `sourceUrl`s never overwrite
 * each other under the same filename while identical `sourceUrl`s share one canonical filename.
 */
export function buildDeckMediaResolution(
  cards: CanonicalCard[],
  deckKey: string = 'deck'
): DeckMediaResolution {
  const filenameBySourceKey = new Map<string, string>();
  const usedLowerFilenames = new Set<string>();
  const manifestByLowerFilename = new Set<string>();
  const fieldLookup = new Map<string, string>();
  const manifest: MediaBundleItem[] = [];

  for (const card of cards) {
    const refs = extractCardMediaReferences(card, deckKey);
    const seenOccurrenceInField = new Map<string, number>();

    for (const ref of refs) {
      const normSrc = (ref.sourceUrl || '').trim();
      const sourceKey = `${ref.kind}::${normSrc}`;
      let resolvedName = filenameBySourceKey.get(sourceKey);

      if (!resolvedName) {
        resolvedName = disambiguateMediaFilename(ref.filename, card.id, usedLowerFilenames);
        filenameBySourceKey.set(sourceKey, resolvedName);
        usedLowerFilenames.add(resolvedName.toLowerCase());
      }

      const occKey = `${card.id}:${ref.field}:${ref.kind}:${normSrc}`;
      const occIdx = seenOccurrenceInField.get(occKey) || 0;
      seenOccurrenceInField.set(occKey, occIdx + 1);
      fieldLookup.set(`${occKey}:${occIdx}`, resolvedName);

      if (!manifestByLowerFilename.has(resolvedName.toLowerCase())) {
        manifestByLowerFilename.add(resolvedName.toLowerCase());
        manifest.push({
          filename: resolvedName,
          sourceUrl: ref.sourceUrl,
          cardId: card.id,
          field: ref.field,
          kind: ref.kind,
        });
      }
    }
  }

  return {
    manifest,
    resolveFilenameForField: (cardId, field, kind, srcVal, defaultName) => {
      const normSrc = (srcVal || '').trim();
      const sourceKey = `${kind}::${normSrc}`;
      return (
        filenameBySourceKey.get(sourceKey) ||
        fieldLookup.get(`${cardId}:${field}:${kind}:${normSrc}:0`) ||
        defaultName
      );
    },
  };
}

/**
 * Extracts a manifest of all images and audio files across the deck with their local Anki filenames
 * and source URLs/data-URIs so they can be bundled into collection.media / 04_Mídias / .apkg on export.
 */
export function extractDeckMediaManifest(
  cards: CanonicalCard[],
  deckKey: string = 'deck'
): MediaBundleItem[] {
  return buildDeckMediaResolution(cards, deckKey).manifest;
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
 * Extracts unresolved local `<img src="arquivo_local.png">`, `pdfimg:ID`, and `buscar_imagem:query`
 * references from a card along with a rich search query built from the visual legend `<i>...</i>` +
 * `topic` + `answer` so they can be automatically resolved from material PDFs or Google/Web search.
 */
export function extractUnresolvedLocalImages(
  card: CanonicalCard,
  availableMediaNames?: Iterable<string>
): Array<{
  filename: string;
  field: 'question' | 'hint';
  legendText: string;
  searchQuery: string;
  pdfImageId?: string;
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
  const answerText = stripHtml(card.answer || '').trim();
  const cleanFileWords = (fname: string) =>
    fname
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b(?:img|image|card|fig|figura|ficha|resumo|apostila|aula|slide|pagina|pag|p\d+|\d+)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const refs = extractCardMediaReferences(card, card.deck_key || 'deck');
  const unresolved: Array<{
    filename: string;
    field: 'question' | 'hint';
    legendText: string;
    searchQuery: string;
    pdfImageId?: string;
  }> = [];

  for (const ref of refs) {
    if (ref.kind !== 'image') continue;
    const raw = (ref.sourceUrl || '').trim();
    const isPdfPlaceholder = /^pdfimg:/i.test(raw);
    const isSearchPlaceholder = /^buscar_imagem:/i.test(raw);
    const isSelfContainedOrWeb = /^(?:https?:\/\/|data:)/i.test(raw);
    const isLoadedLocally =
      !isPdfPlaceholder &&
      !isSearchPlaceholder &&
      (availableSet.has(ref.filename.toLowerCase()) || availableSet.has(raw.toLowerCase()));

    if (!isSelfContainedOrWeb && !isLoadedLocally) {
      const pdfImageId = isPdfPlaceholder ? raw.replace(/^pdfimg:\s*/i, '').trim() : undefined;
      const explicitSearch = isSearchPlaceholder
        ? raw.replace(/^buscar_imagem:\s*/i, '').trim()
        : '';
      const fileHint = cleanFileWords(ref.filename);
      const searchQuery = (
        explicitSearch ||
        [legendText || answerText, card.topic, fileHint].filter(Boolean).join(' ')
      )
        .slice(0, 140)
        .trim();
      unresolved.push({
        filename: ref.filename,
        field: ref.field,
        legendText,
        searchQuery: searchQuery || card.topic || 'medical exam',
        ...(pdfImageId ? { pdfImageId } : {}),
      });
    }
  }

  return unresolved;
}

/**
 * Formats a clean clinical visual legend inside `<i>Legenda visual: ...</i>`,
 * guaranteeing at least 6 descriptive words and avoiding double prefixes.
 */
export function formatVisualLegendHtml(
  rawLegend: string,
  fallbackText?: string
): string {
  const cleanText = (val: string) =>
    stripHtml(val || '')
      .replace(/^(?:legenda(?:\s+visual)?|achado(?:\s+visual)?|imagem)\s*:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();

  let body = cleanText(rawLegend);
  const words = body.split(/\s+/).filter(Boolean);
  if (words.length < 6) {
    const fallbackBody = cleanText(fallbackText || '');
    const fallbackWords = fallbackBody.split(/\s+/).filter(Boolean);
    if (fallbackWords.length >= 6) {
      body = fallbackBody;
    } else if (words.length >= 2) {
      body = `${body.replace(/[.!?]+$/, '')} para correlação diagnóstica e clínica do caso`;
    } else {
      body =
        'Achado visual complementar do exame clínico para correlação diagnóstica no internato médico';
    }
  }

  body = body.replace(/[;,:]+$/, '').trim();
  if (!/[.!?]$/.test(body)) {
    body += '.';
  }
  return `<i>Legenda visual: ${body}</i>`;
}

function injectVisualLegendIntoHint(
  rawHint: string,
  legendHtml: string,
  mode: 'recognition' | 'feedback',
  forceReplaceExisting: boolean
): string {
  let working = (rawHint || '').trim();
  const leadingImgs: string[] = [];

  if (mode === 'feedback') {
    const imgMatch = working.match(/^(?:\s*<img\b[^>]*>\s*(?:<br\s*\/?>\s*)*)+/i);
    if (imgMatch) {
      const imgs = imgMatch[0].match(/<img\b[^>]*>/gi) || [];
      leadingImgs.push(...imgs);
      working = working.slice(imgMatch[0].length).replace(/^(?:<br\s*\/?>\s*)+/i, '').trim();
    }
  } else {
    working = working.replace(/<img\b[^>]*>(?:\s*<br\s*\/?>\s*)*/gi, '').trim();
  }

  const existingItalicMatch = working.match(/^<i>([\s\S]*?)<\/i>(?:\s*<br\s*\/?>\s*)*/i);
  let chosenLegendHtml = legendHtml;

  if (existingItalicMatch) {
    const existingPlain = stripHtml(existingItalicMatch[1] || '');
    const existingHasValidLegend =
      existingPlain.split(/\s+/).filter(Boolean).length >= 6;

    if (!forceReplaceExisting && existingHasValidLegend) {
      chosenLegendHtml = `<i>${existingPlain}</i>`;
    }
    working = working.slice(existingItalicMatch[0].length).replace(/^(?:<br\s*\/?>\s*)+/i, '').trim();
  }

  const normalizedBody = /^<b>\s*Coment[áa]rio:/i.test(working)
    ? working
    : `<b>Comentário:</b> ${working.replace(/^Coment[áa]rio:\s*/i, '').trim()}`;

  if (leadingImgs.length > 0) {
    return `${leadingImgs.join('<br>')}<br>${chosenLegendHtml}<br><br>${normalizedBody}`;
  }
  return `${chosenLegendHtml}<br><br>${normalizedBody}`;
}

/**
 * Replaces a card's local `<img src="...">` (or current image) with a resolved web/material image URL
 * while preserving `data-anki-file`, storing 4–6 alternative thumbnails on `card.imageAlternatives`,
 * and guaranteeing `<i>Legenda visual: ...</i>` before `<b>Comentário:</b>`.
 */
export function applyResolvedWebImageToCard(
  card: CanonicalCard,
  targetFilename: string,
  chosenImage: MedicalImageResult,
  alternatives: MedicalImageResult[],
  legendOverride?: string
): CanonicalCard {
  const safeFile =
    chosenImage.fromMaterial && chosenImage.suggestedFilename
      ? chosenImage.suggestedFilename
      : targetFilename.trim() ||
        chosenImage.suggestedFilename ||
        resolveLocalMediaFilename('', chosenImage.thumbUrl, card.id, 0, card.deck_key || 'deck');
  const newImgTag = `<img src="${chosenImage.thumbUrl}" data-anki-file="${safeFile}">`;

  let question = card.question || '';
  let hint = card.hint || '';
  let placedIn: 'question' | 'hint' = card.image_mode === 'feedback' ? 'hint' : 'question';

  const replaceTargetImg = (html: string): { updated: string; replaced: boolean } => {
    let replaced = false;
    const updated = html.replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (fullTag, srcVal: string) => {
      if (replaced) return fullTag;
      const localName = resolveLocalMediaFilename(fullTag, srcVal, card.id, 0, card.deck_key || 'deck');
      if (
        !targetFilename ||
        localName.toLowerCase() === targetFilename.toLowerCase() ||
        srcVal.toLowerCase().includes(targetFilename.toLowerCase()) ||
        /^(?:pdfimg|buscar_imagem):/i.test(srcVal.trim())
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
    placedIn = 'question';
  } else {
    const hRes = replaceTargetImg(hint);
    if (hRes.replaced) {
      hint = hRes.updated;
      placedIn = 'hint';
    } else if (/<img\b/i.test(question)) {
      question = question.replace(/<img\b[^>]*>/i, newImgTag);
      placedIn = 'question';
    } else if (/<img\b/i.test(hint)) {
      hint = hint.replace(/<img\b[^>]*>/i, newImgTag);
      placedIn = 'hint';
    } else {
      question = `${question}<br>${newImgTag}`;
      placedIn = 'question';
    }
  }

  const effectiveMode: 'recognition' | 'feedback' =
    placedIn === 'hint' ? 'feedback' : 'recognition';
  const fallbackDesc = `Achado visual complementar de ${stripHtml(card.topic)} para correlação diagnóstica no internato`;
  const candidateLegend = (legendOverride || '').trim() || chosenImage.defaultLegend || '';
  const legendHtml = formatVisualLegendHtml(candidateLegend, fallbackDesc);

  hint = injectVisualLegendIntoHint(
    hint,
    legendHtml,
    effectiveMode,
    Boolean(legendOverride && legendOverride.trim().length > 0)
  );

  return {
    ...card,
    image_mode: effectiveMode,
    question,
    hint,
    imageAlternatives: alternatives.slice(0, 6),
    isResolvingImage: false,
  };
}

/**
 * Proactively attaches an image to a card that previously had none (choosing `recognition` on front
 * or `feedback` on hint) while preserving Wozniak/Matuschak hint structure (`<i>Legenda visual: ...</i><br><br><b>Comentário:</b> ...`).
 */
export function attachVisualSuggestionToCard(
  card: CanonicalCard,
  chosenImage: MedicalImageResult,
  legendText: string,
  mode: 'recognition' | 'feedback',
  alternatives: MedicalImageResult[]
): CanonicalCard {
  const cleanDeck =
    (card.deck_key || 'deck').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_') || 'deck';
  const safeFile =
    chosenImage.suggestedFilename?.trim() ||
    resolveLocalMediaFilename('', chosenImage.thumbUrl, card.id, 0, cleanDeck);

  const cleanQ = (card.question || '')
    .replace(/\s*(?:<br\s*\/?>\s*)*<img\b[^>]*>/gi, '')
    .trim();
  const cleanHint = (card.hint || '')
    .replace(/\s*(?:<br\s*\/?>\s*)*<img\b[^>]*>/gi, '')
    .replace(/^<i>[\s\S]*?<\/i>(?:\s*<br\s*\/?>\s*)*/i, '')
    .trim();

  const normalizedComment = /^<b>\s*Coment[áa]rio:/i.test(cleanHint)
    ? cleanHint
    : `<b>Comentário:</b> ${cleanHint.replace(/^Coment[áa]rio:\s*/i, '').trim()}`;

  const fallbackDesc = `Achado visual complementar de ${stripHtml(card.topic)} para correlação diagnóstica no internato`;
  const legendHtml = formatVisualLegendHtml(
    (legendText || '').trim() || chosenImage.defaultLegend || '',
    fallbackDesc
  );

  const imgTag = `<img src="${chosenImage.thumbUrl}" data-anki-file="${safeFile}">`;

  if (mode === 'recognition') {
    return {
      ...card,
      image_mode: 'recognition',
      imageVerified: false,
      isResolvingImage: false,
      imageAlternatives: alternatives.slice(0, 6),
      question: `${cleanQ}<br>${imgTag}`,
      hint: `${legendHtml}<br><br>${normalizedComment}`,
    };
  }

  return {
    ...card,
    image_mode: 'feedback',
    imageVerified: false,
    isResolvingImage: false,
    imageAlternatives: alternatives.slice(0, 6),
    question: cleanQ,
    hint: `${imgTag}<br>${legendHtml}<br><br>${normalizedComment}`,
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

const NON_SPOILER_ACRONYMS = new Set([
  'IV', 'EV', 'VO', 'IM', 'SC', 'DU', 'MG', 'ML', 'KG', 'CM', 'MM', 'UI',
  'PA', 'FC', 'FR', 'PH', 'RN', 'DE', 'DA', 'DO', 'EM', 'NO', 'NA', 'OS', 'AS',
]);

function extractAcronymTokens(text: string): string[] {
  const plain = stripHtml(text);
  const matches = plain.match(/\b[A-Z]{2,5}\b/g) || [];
  return Array.from(new Set(matches.filter((tok) => !NON_SPOILER_ACRONYMS.has(tok))));
}

function extractCoreKeywords(text: string): string[] {
  const norm = normalizeForSpoiler(text);
  if (!norm) return [];
  return norm
    .split(/\s+/)
    .filter((w) => w.length > 3 && !MEDICAL_UNITS_AND_STOPWORDS.has(w));
}

function stemsCollideForSpoiler(a: string, b: string): boolean {
  if (a.length < 4 || b.length < 4) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 6) {
    if (a.startsWith(b) || b.startsWith(a)) return true;
    let common = 0;
    const limit = Math.min(a.length, b.length);
    while (common < limit && a[common] === b[common]) {
      common++;
    }
    if (common >= 7) return true;
  }
  return false;
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

export interface VisualLegendEntry {
  rawHtml: string;
  text: string;
  descriptiveText: string;
  wordCount: number;
}

const DIAGNOSTIC_MODALITY_PATTERNS: Array<{
  modality: string;
  label: string;
  pattern: RegExp;
}> = [
  {
    modality: 'USG',
    label: 'USG / Ultrassonografia',
    pattern:
      /\b(?:usg|ultrassonografia|ultrassom|ultrassonogr[aá]fic[ao]|ecografia|ecogr[aá]fic[ao]|e-?fast|doppler|ultrasound|sonography)\b/i,
  },
  {
    modality: 'ECOCARDIOGRAMA',
    label: 'Ecocardiograma',
    pattern:
      /\b(?:ecocardiograma|ecocardiografia|ecocardiogr[aá]fic[ao]|echocardiogra(?:m|phy))\b/i,
  },
  {
    modality: 'TC',
    label: 'TC / Tomografia Computadorizada',
    pattern:
      /\b(?:tc|tomografia(?:\s+computadorizada)?|angiotomografia|angio-?tc|urotomografia|ct\s+scan|computed\s+tomography)\b/i,
  },
  {
    modality: 'RM',
    label: 'RM / Ressonância Magnética',
    pattern:
      /\b(?:rm|rnm|resson[aâ]ncia(?:\s+magn[eé]tica)?|colangiorresson[aâ]ncia|angiorresson[aâ]ncia|mri|magnetic\s+resonance)\b/i,
  },
  {
    modality: 'RX',
    label: 'RX / Radiografia',
    pattern:
      /\b(?:rx|raio-?x|raios-?x|radiografia|radiogr[aá]fic[ao]|teleradiografia|telerradiografia|x-?ray|chest\s+radiograph)\b/i,
  },
  {
    modality: 'ECG',
    label: 'ECG / Eletrocardiograma',
    pattern:
      /\b(?:ecg|eletrocardiograma|eletrocardiogr[aá]fic[ao]|electrocardiogra(?:m|phy))\b/i,
  },
  {
    modality: 'ECOCARDIOGRAMA',
    label: 'Ecocardiograma / Doppler Cardíaco',
    pattern:
      /\b(?:ecocardiograma|ecocardiografia|ecocardiogr[aá]fic[ao]|echocardiogra(?:m|phy)|ecodoppler\s+card[ií]aco|modo[\s-]?m)\b/i,
  },
  {
    modality: 'CTG',
    label: 'CTG / Cardiotocografia',
    pattern:
      /\b(?:ctg|cardiotocografia|cardiotocogr[aá]fic[ao]|cardiotocograma|cardiotocography)\b/i,
  },
  {
    modality: 'LAPAROSCOPIA',
    label: 'Laparoscopia / Videolaparoscopia',
    pattern:
      /\b(?:laparoscopia|videolaparoscopia|laparosc[oó]pic[ao]|videolaparosc[oó]pic[ao]|laparoscopy)\b/i,
  },
  {
    modality: 'EDA',
    label: 'EDA / Endoscopia Digestiva',
    pattern:
      /\b(?:eda|endoscopia(?:\s+digestiva(?:\s+alta)?)?|endosc[oó]pic[ao])\b/i,
  },
  {
    modality: 'COLONOSCOPIA',
    label: 'Colonoscopia / Retossigmoidoscopia',
    pattern: /\b(?:colonoscopia|retossigmoidoscopia|colonosc[oó]pic[ao])\b/i,
  },
  {
    modality: 'HISTEROSCOPIA',
    label: 'Histeroscopia',
    pattern: /\b(?:histeroscopia|histerosc[oó]pic[ao])\b/i,
  },
  {
    modality: 'COLPOSCOPIA',
    label: 'Colposcopia',
    pattern: /\b(?:colposcopia|colposc[oó]pic[ao])\b/i,
  },
  {
    modality: 'BRONCOSCOPIA',
    label: 'Broncoscopia',
    pattern: /\b(?:broncoscopia|broncosc[oó]pic[ao])\b/i,
  },
  {
    modality: 'FUNDOSCOPIA',
    label: 'Fundoscopia / Retinografia',
    pattern:
      /\b(?:fundoscopia|fundo\s+de\s+olho|mapeamento\s+de\s+retina|retinografia|fundoscopy)\b/i,
  },
  {
    modality: 'DERMATOSCOPIA',
    label: 'Dermatoscopia',
    pattern: /\b(?:dermatoscopia|dermatosc[oó]pic[ao]|dermoscopy)\b/i,
  },
  {
    modality: 'OTOSCOPIA',
    label: 'Otoscopia',
    pattern: /\b(?:otoscopia|otosc[oó]pic[ao]|otoscopy)\b/i,
  },
  {
    modality: 'HISTOPATOLOGIA',
    label: 'Histopatologia / Biópsia / Esfregaço',
    pattern:
      /\b(?:histopatol[oó]gic[ao]|anatomopatol[oó]gic[ao]|histologia|l[aâ]mina\s+histol[oó]gica|esfrega[cç]o\s+(?:de\s+)?sangue|blood\s+smear|microscopia|bi[oó]psia)\b/i,
  },
  {
    modality: 'MAMOGRAFIA',
    label: 'Mamografia',
    pattern: /\b(?:mamografia|mamogr[aá]fic[ao]|mammogra(?:m|phy))\b/i,
  },
  {
    modality: 'ESPIROMETRIA',
    label: 'Espirometria',
    pattern: /\b(?:espirometria|espirom[eé]tric[ao]|curva\s+fluxo-?volume)\b/i,
  },
  {
    modality: 'PARTOGRAMA',
    label: 'Partograma',
    pattern: /\b(?:partograma|partogram)\b/i,
  },
  {
    modality: 'ARTERIOGRAFIA',
    label: 'Arteriografia / Cateterismo',
    pattern:
      /\b(?:arteriografia|angiografia|cineangiocoronariografia|cateterismo\s+card[ií]aco)\b/i,
  },
];

const VISUAL_OVERLAP_STOPWORDS = new Set([
  'paciente', 'gestante', 'parturiente', 'lactente', 'escolar', 'idoso', 'idosa',
  'adulto', 'adulta', 'mulher', 'homem', 'crianca', 'clinico', 'clinica',
  'diagnostico', 'diagnostica', 'conduta', 'exame', 'imagem', 'figura', 'foto',
  'abaixo', 'acima', 'anexo', 'mostrado', 'mostrada', 'apresentado', 'apresentada',
  'evidencia', 'evidenciando', 'demonstra', 'demonstrando', 'mostra', 'mostrando',
  'revela', 'revelando', 'observa', 'nota', 'indica', 'indicando', 'correlacao',
  'padrao', 'caracteristico', 'caracteristica', 'achado', 'achados', 'sinal', 'sinais',
  'aspecto', 'lesao', 'alteracao', 'alteracoes', 'normal', 'agudo', 'aguda',
  'cronico', 'cronica', 'direito', 'direita', 'esquerdo', 'esquerda', 'bilateral',
  'anterior', 'posterior', 'inferior', 'superior', 'torax', 'toracico', 'toracica',
  'abdome', 'abdominal', 'pelve', 'pelvico', 'pelvica', 'cranio', 'cerebral',
  'pulmonar', 'cardiaco', 'cardiaca', 'renal', 'hepatico', 'hepatica', 'uterino',
  'uterina', 'fetal', 'intraparto', 'obstetrico', 'obstetrica', 'emergencia',
  'pronto', 'socorro', 'sala', 'ambulatorio', 'enfermaria', 'centro', 'qual', 'quais',
  'imediata', 'imediato', 'primeira', 'segunda', 'escolha', 'linha', 'ecg', 'usg',
  'tc', 'rm', 'rx', 'ctg', 'eda', 'eletrocardiograma', 'ultrassonografia', 'ultrassom',
  'tomografia', 'computadorizada', 'ressonancia', 'magnetica', 'radiografia',
  'cardiotocografia', 'cardiotocografico', 'laparoscopia', 'videolaparoscopia',
  'endoscopia', 'colonoscopia', 'derivacoes', 'ortostase', 'contraste', 'tracado',
  'corte', 'incidencia', 'legenda', 'visual', 'complementar', 'internato', 'medico',
  'medica', 'caso', 'quadro', 'realiza', 'realizou', 'submetida', 'submetido',
  'dor', 'febre', 'dispneia', 'sudorese', 'cefaleia', 'nausea', 'vomito', 'vomitos',
  'palpitacoes', 'semanas', 'meses', 'anos', 'horas', 'minutos', 'tipica', 'tipico',
  'suspeita', 'avaliacao', 'manejo', 'tratamento', 'abordagem', 'classificacao',
  'fisiologica', 'patologica', 'compatível', 'compativel', 'presenca', 'ausencia',
  'doppler', 'colorido', 'colorida', 'axial', 'coronal', 'sagital', 'transversal',
  'longitudinal', 'eletrocardiografico', 'eletrocardiografica', 'classico', 'classica',
  'utero', 'gravidico', 'gravidica', 'biliar', 'vesicula', 'onda', 'ondas',
  'intervalo', 'complexo', 'segmento', 'taquicardia', 'bradicardia', 'irregular',
  'regular', 'sinusal', 'ritmo', 'conducao', 'todas', 'todos', 'toda', 'todo',
  'partograma', 'apresentacao', 'apresentando', 'apresenta', 'contracao', 'contracoes',
  'eficaz', 'eficazes', 'dilatacao', 'trabalho', 'parto',
]);

const VISUAL_FINDING_PATTERNS: RegExp[] = [
  /\bsupradesnivelamento\s+(?:convexo\s+)?(?:do\s+segmento\s+|de\s+)?st\b/i,
  /\binfradesnivelamento\s+(?:do\s+segmento\s+|de\s+)?st\b/i,
  /\bonda\s+q\s+patol[oó]gica\b/i,
  /\bpneumoperit[oô]nio\b/i,
  /\bn[ií]vel\s+hidroa[eé]reo\b/i,
  /\bempilhamento\s+de\s+moedas\b/i,
  /\bpar[aá]bola\s+de\s+damoiseau\b/i,
  /\bsinal\s+d[aoe]\s+(?:roda\s+dentada|alvo|menisco|duplo\s+contorno|dupla\s+bolha|gr[aã]o\s+de\s+caf[eé]|tartaruga|campan[aá]rio|polegar|anel\s+de\s+fogo|halo|contas\s+de\s+ros[aá]rio)\b/i,
  /\bcordas\s+de\s+violino\b/i,
  /\bdesacelera[cç][õo]es?\s+tardias?\b/i,
  /\bvariabilidade\s+ausente\b/i,
  /\bvidro\s+fosco\b/i,
  /\bconsolida[cç][aã]o\s+lobar\b/i,
  /\bborramento\s+da\s+gordura\b/i,
  /\bespessamento\s+(?:parietal|tub[aá]rio|endometrial)\b/i,
  /\bsombra\s+ac[uú]stica\b/i,
  /\bhipotranspar[eê]ncia\b/i,
  /\bhipertranspar[eê]ncia\b/i,
  /\bimagem\s+(?:hipoecoica|hiperecoica|anecoica|hiperdensa|hipodensa)\b/i,
  /\bvelamento\s+d[eo]\s+seio\b/i,
  /\balargamento\s+(?:de\s+|do\s+)?mediastino\b/i,
  /\blente\s+biconvexa\b/i,
  /\bforma\s+de\s+crescente\b/i,
  /\bcole[cç][aã]o\s+peric[oó]lica\b/i,
];

function normalizeImageSrcForDedup(rawSrc: string): string {
  const trimmed = (rawSrc || '').trim();
  if (!trimmed) return '';
  if (/^data:/i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname}${u.search}`.replace(
        /\/+$/,
        ''
      );
    } catch {
      return trimmed.toLowerCase();
    }
  }
  return (trimmed.split(/[\\/]/).pop() || trimmed).toLowerCase();
}

export function extractImageSrcOccurrences(
  card: CanonicalCard
): Array<{ src: string; normalizedSrc: string; field: 'question' | 'hint' }> {
  const results: Array<{ src: string; normalizedSrc: string; field: 'question' | 'hint' }> = [];
  const fields: Array<['question' | 'hint', string]> = [
    ['question', card.question || ''],
    ['hint', card.hint || ''],
  ];

  for (const [field, html] of fields) {
    const regex = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null) {
      const src = (m[1] || '').trim();
      const normalizedSrc = normalizeImageSrcForDedup(src);
      if (normalizedSrc) {
        results.push({ src, normalizedSrc, field });
      }
    }
  }

  return results;
}

/**
 * Extracts `<i>...</i>` visual legend entries associated with a card (prioritizing legends
 * in `hint` before `<b>Comentário:</b>`, plus any `<i>` caption in `question` or `hint`).
 */
export function extractVisualLegendEntries(card: CanonicalCard): VisualLegendEntry[] {
  const entries: VisualLegendEntry[] = [];
  const rawHint = (card.hint || '')
    .replace(/<table[\s\S]*?<\/table>/gi, ' ')
    .replace(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi, ' ');

  const commentSplit = rawHint.split(/<b>\s*Coment[áa]rio:\s*<\/b>/i);
  const preCommentHint = commentSplit[0] || '';
  const hasCommentSplit = commentSplit.length > 1;

  const sourcesToScan = [
    hasCommentSplit ? preCommentHint : rawHint,
    card.question || '',
  ];

  const seenRaw = new Set<string>();
  for (const srcHtml of sourcesToScan) {
    const italicRegex = /<i\b[^>]*>([\s\S]*?)<\/i>/gi;
    let m: RegExpExecArray | null;
    while ((m = italicRegex.exec(srcHtml)) !== null) {
      const rawHtml = m[0];
      if (seenRaw.has(rawHtml)) continue;
      seenRaw.add(rawHtml);
      const text = stripHtml(m[1] || '').replace(/\s+/g, ' ').trim();
      const descriptiveText = text
        .replace(/^(?:legenda(?:\s+visual)?|achado(?:\s+visual)?|imagem)\s*:\s*/i, '')
        .trim();
      const wordCount = descriptiveText ? descriptiveText.split(/\s+/).filter(Boolean).length : 0;
      entries.push({ rawHtml, text, descriptiveText, wordCount });
    }
  }

  // Fallback: if <img> is inside <b>Comentário:</b> and legend was placed right after it
  if (entries.length === 0 && hasCommentSplit && /<img\b/i.test(commentSplit.slice(1).join(' '))) {
    const postComment = commentSplit.slice(1).join(' ');
    const italicRegex = /<i\b[^>]*>([\s\S]*?)<\/i>/gi;
    let m: RegExpExecArray | null;
    while ((m = italicRegex.exec(postComment)) !== null) {
      const text = stripHtml(m[1] || '').replace(/\s+/g, ' ').trim();
      const descriptiveText = text
        .replace(/^(?:legenda(?:\s+visual)?|achado(?:\s+visual)?|imagem)\s*:\s*/i, '')
        .trim();
      const wordCount = descriptiveText ? descriptiveText.split(/\s+/).filter(Boolean).length : 0;
      entries.push({ rawHtml: m[0], text, descriptiveText, wordCount });
    }
  }

  return entries;
}

export function extractDiagnosticModalities(text: string): Array<{ modality: string; label: string }> {
  const plain = stripHtml(stripClozeMarkup(text || ''));
  if (!plain) return [];
  const found: Array<{ modality: string; label: string }> = [];
  const seen = new Set<string>();
  for (const entry of DIAGNOSTIC_MODALITY_PATTERNS) {
    if (entry.pattern.test(plain) && !seen.has(entry.modality)) {
      seen.add(entry.modality);
      found.push({ modality: entry.modality, label: entry.label });
    }
  }
  return found;
}

export function detectModalityConflict(card: CanonicalCard): {
  hasConflict: boolean;
  cardModalities: string[];
  legendModalities: string[];
  message?: string;
} {
  const legendEntries = extractVisualLegendEntries(card);
  const legendCombined = legendEntries.map((e) => e.text).join(' ');
  const legendMods = extractDiagnosticModalities(legendCombined);
  if (legendMods.length === 0) {
    return { hasConflict: false, cardModalities: [], legendModalities: [] };
  }

  // Extract modalities from card prompt text (topic + question), excluding <b>Comentário:</b>
  // and next-step procedures in answer so comparative remarks or subsequent procedures never produce false conflicts.
  const cardTextCombined = [card.topic || '', card.question || ''].join(' ');
  const cardMods = extractDiagnosticModalities(cardTextCombined);
  if (cardMods.length === 0) {
    return {
      hasConflict: false,
      cardModalities: [],
      legendModalities: legendMods.map((m) => m.label),
    };
  }

  const legendSet = new Set(legendMods.map((m) => m.modality));
  const hasOverlap = cardMods.some((m) => legendSet.has(m.modality));
  if (hasOverlap) {
    return {
      hasConflict: false,
      cardModalities: cardMods.map((m) => m.label),
      legendModalities: legendMods.map((m) => m.label),
    };
  }

  const cardLabels = cardMods.map((m) => m.label).join(' / ');
  const legendLabels = legendMods.map((m) => m.label).join(' / ');
  return {
    hasConflict: true,
    cardModalities: cardMods.map((m) => m.label),
    legendModalities: legendMods.map((m) => m.label),
    message: `Conflito de modalidade texto × legenda: texto do card cita ${cardLabels}, mas a legenda visual descreve ${legendLabels}.`,
  };
}

function extractVisualFindingStems(text: string): Set<string> {
  const norm = stripHtml(stripClozeMarkup(text || ''))
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ');
  const stems = new Set<string>();
  for (const tok of norm.split(/\s+/)) {
    if (
      tok.length >= 5 &&
      !DANGLING_STOPWORDS.has(tok) &&
      !MEDICAL_UNITS_AND_STOPWORDS.has(tok) &&
      !VISUAL_OVERLAP_STOPWORDS.has(tok)
    ) {
      stems.add(stemPortugueseWord(tok));
    }
  }
  return stems;
}

export function detectRedundantVisualDescription(card: CanonicalCard): {
  isRedundant: boolean;
  reason?: string;
} {
  // Applies specifically to Med_Basic_Inverted_v2 (type === 'basic') with <img> in question
  if (card.type !== 'basic' || !/<img\b/i.test(card.question || '')) {
    return { isRedundant: false };
  }

  const qWithoutImgs = (card.question || '').replace(/<img\b[^>]*>/gi, ' ');
  const qVisible = stripHtml(stripClozeMarkup(qWithoutImgs));
  if (!qVisible) return { isRedundant: false };

  // Signal 1: Distinctive visual finding lexicon appears in question text
  for (const pattern of VISUAL_FINDING_PATTERNS) {
    const match = qVisible.match(pattern);
    if (match) {
      return {
        isRedundant: true,
        reason: `Enunciado descreve textualmente o achado visual ("${match[0]}") em card Med_Basic_Inverted_v2 com imagem na pergunta.`,
      };
    }
  }

  // Signal 2: Question shares >= 2 distinctive visual-finding stems with the <i> legend
  const legendEntries = extractVisualLegendEntries(card);
  const legendText = legendEntries.map((e) => e.descriptiveText).join(' ');
  if (legendText) {
    const qStems = extractVisualFindingStems(qVisible);
    const legendStems = extractVisualFindingStems(legendText);
    const shared: string[] = [];
    for (const st of legendStems) {
      if (qStems.has(st)) shared.push(st);
    }
    if (shared.length >= 2) {
      return {
        isRedundant: true,
        reason: `Enunciado antecipa textualmente o achado da legenda visual (${shared.slice(0, 3).join(', ')}) em card Med_Basic_Inverted_v2 com imagem na pergunta.`,
      };
    }
  }

  // Signal 3: Non-interrogative visual narration ("o ECG/exame abaixo mostra/evidencia <achado>")
  const sentences = qVisible.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    if (/^(?:qual|quais|o\s+que|como|por\s+que|quando|onde)\b/i.test(sentence)) {
      continue;
    }
    const narrationMatch = sentence.match(
      /\b(?:exame|imagem|figura|foto|tra[cç]ado|ecg|ctg|rx|radiografia|tc|tomografia|rm|resson[aâ]ncia|usg|ultrassonografia|laparoscopia|videolaparoscopia|endoscopia|eda|fundoscopia|dermatoscopia|l[aâ]mina)\s+(?:abaixo|acima|anexo|apresentad[ao]|mostrad[ao])?[^,]*?\b(?:mostra|mostrando|evidencia|evidenciando|revela|revelando|demonstra|demonstrando|exibe|exibindo|observa-se|nota-se|visualiza-se|identifica-se)\s+(.+)$/i
    );
    if (narrationMatch && narrationMatch[1]) {
      const findingStems = extractVisualFindingStems(narrationMatch[1]);
      if (findingStems.size >= 2) {
        return {
          isRedundant: true,
          reason: `Enunciado narra o achado visual da imagem ("${narrationMatch[1].slice(0, 60).trim()}") em card Med_Basic_Inverted_v2.`,
        };
      }
    }
  }

  return { isRedundant: false };
}

export function findDuplicateDeckImages(cards: CanonicalCard[]): DuplicateDeckImage[] {
  const byNormalizedSrc = new Map<
    string,
    { rawSrc: string; cardIndexSet: Set<number>; cardIds: number[] }
  >();

  cards.forEach((card, idx) => {
    const occurrences = extractImageSrcOccurrences(card);
    const seenInThisCard = new Set<string>();
    for (const occ of occurrences) {
      if (seenInThisCard.has(occ.normalizedSrc)) continue;
      seenInThisCard.add(occ.normalizedSrc);
      let entry = byNormalizedSrc.get(occ.normalizedSrc);
      if (!entry) {
        entry = {
          rawSrc: occ.src,
          cardIndexSet: new Set<number>(),
          cardIds: [],
        };
        byNormalizedSrc.set(occ.normalizedSrc, entry);
      }
      if (!entry.cardIndexSet.has(idx)) {
        entry.cardIndexSet.add(idx);
        entry.cardIds.push(card.id);
      }
    }
  });

  const duplicates: DuplicateDeckImage[] = [];
  for (const [normalizedSrc, info] of byNormalizedSrc.entries()) {
    if (info.cardIndexSet.size > 1) {
      duplicates.push({
        src: info.rawSrc,
        normalizedSrc,
        cardIds: info.cardIds,
      });
    }
  }
  return duplicates;
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
  const cardType: 'basic' | 'cloze' =
    String(card.type || 'basic').toLowerCase() === 'cloze' ? 'cloze' : 'basic';
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
        const srcMatch = clean.match(/\bsrc=["']([^"']+)["']/i);
        if (srcMatch && srcMatch[1]) {
          const srcBase = srcMatch[1].trim().split(/[\\/]/).pop();
          if (srcBase) availableMediaSet.add(srcBase);
        }
        const soundMatch = clean.match(/\[sound:([^\]]+)\]/i);
        if (soundMatch && soundMatch[1]) {
          const soundBase = soundMatch[1].trim().split(/[\\/]/).pop();
          if (soundBase) availableMediaSet.add(soundBase);
        }
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
  const answerWordCount = cardType === 'basic' ? countWords(answerText) : 0;
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
  if (cardType === 'basic') {
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
    const hasTemporalOrLineQualifier =
      /\b(?:imediata|imediato|inicial|primeira\s+(?:escolha|linha)|1[ªa]\s+(?:escolha|linha)|definitiv[ao]|ambulatorial|de\s+manuten[cç][aã]o|de\s+minuto\s+zero|(?:conduta|abordagem|manejo|proped[êe]utica|medida)\s+(?:diagn[oó]stic[ao]|terap[êe]utic[ao]|profil[áa]tic[ao]))\b/i.test(
        visQ
      );
    if (
      !hasTemporalOrLineQualifier &&
      /(?:\bqual\s+(?:é\s+)?(?:a\s+conduta|o\s+manejo|o\s+pr[oó]ximo\s+passo|o\s+tratamento)|\bcomo\s+conduzir|\bo\s+que\s+fazer)\s*\?\s*$/i.test(
        visQ
      )
    ) {
      warnings.push({
        code: 'VAGUE_TEMPORAL_WINDOW',
        field: 'question',
        severity: 'warning',
        message:
          'Especifique a janela temporal na pergunta ("Qual é a conduta imediata de minuto zero?" ou "Qual o tratamento definitivo?").',
      });
    }
  } else if (cardType === 'cloze') {
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
    /\b(?:qual|quais)\s+(?:é\s+|são\s+)?(?:o|a|os|as)?\s*(?:diagn[oó]stico|hip[oó]tese|agente|etiologia|classifica[cç][aã]o|est[aá]gio|achado|parede|mecanismo|escore)(?:\s+[a-zà-ú0-9_-]+){0,3}\s+e\s+(?:qual\s+)?(?:a\s+|o\s+|os\s+|as\s+)?(?:conduta|tratamento|manejo|exame|droga|f[áa]rmaco|terapia|antiarr[ií]tmico|ant[ií]doto|dose|art[eé]ria|interven[cç][aã]o)\b/i;
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
    /\b(?:quais\s+(?:s[aã]o\s+)?(?:os|as)\s+(?:\d+\s+)?(?:principais\s+)?(?:causas|crit[eé]rios|sintomas|sinais|fatores|manifesta[cç][oõ]es|complica[cç][oõ]es|indica[cç][oõ]es|contraindica[cç][oõ]es|agentes|etapas|tipos)|cite\s+(?:os|as|\d+)|liste\s+(?:os|as))\b/i;
  const answerNumberedListRegex = /(?:^|\s)(?:1[.)]\s+.+2[.)]\s+|[-•]\s+.+[-•]\s+)/;
  if (
    unfocusedSetRegex.test(visibleQuestion) ||
    (cardType === 'basic' && answerNumberedListRegex.test(visibleAnswer))
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
    (cardType === 'basic' && binaryAnswerRegex.test(visibleAnswer.trim()))
  ) {
    warnings.push({
      code: 'NIELSEN_PASSIVE_OR_BINARY',
      field: cardType === 'basic' && binaryAnswerRegex.test(visibleAnswer.trim()) ? 'answer' : 'question',
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
  const topicAcronyms = new Set(extractAcronymTokens(topicText));

  const subtopicPart = topicText.includes(' - ')
    ? topicText.split(' - ').slice(1).join(' - ')
    : topicText;
  const subtopicWords = expandWithSynonyms(extractCoreKeywords(subtopicPart));
  const subtopicStems = new Set<string>();
  for (const sw of subtopicWords) {
    const st = stemPortugueseWord(sw);
    if (st.length >= 4) subtopicStems.add(st);
  }

  const targetAnswerString = cardType === 'basic' ? visibleAnswer : clozeTargets.join(' ');
  const targetKeywords = extractCoreKeywords(targetAnswerString);
  const targetAcronyms = extractAcronymTokens(targetAnswerString);

  let hasTopicSpoiler = false;
  const matchedAcronymInTopic = targetAcronyms.find((acr) => topicAcronyms.has(acr));
  if ((targetKeywords.length > 0 && topicWords.size > 0) || matchedAcronymInTopic) {
    const matchedKws = targetKeywords.filter((kw) => {
      if (topicWords.has(kw)) return true;
      const kwStem = stemPortugueseWord(kw);
      if (kwStem.length >= 4 && topicStems.has(kwStem)) return true;
      for (const ts of topicStems) {
        if (stemsCollideForSpoiler(kwStem, ts)) return true;
      }
      return false;
    });

    const firstTargetKw = targetKeywords[0];
    const firstTargetStem = firstTargetKw ? stemPortugueseWord(firstTargetKw) : '';
    const firstWordStemMatchesTopic =
      firstTargetStem.length >= 4 &&
      (subtopicStems.has(firstTargetStem) || topicStems.has(firstTargetStem));

    if (
      Boolean(matchedAcronymInTopic) ||
      (targetKeywords.length > 0 && matchedKws.length === targetKeywords.length) ||
      (targetKeywords.length >= 2 && matchedKws.length / targetKeywords.length >= 0.5) ||
      firstWordStemMatchesTopic ||
      matchedKws.some((kw) => kw.length >= 5)
    ) {
      hasTopicSpoiler = true;
      warnings.push({
        code: 'TOPIC_SPOILER',
        field: 'topic',
        severity: 'error',
        message: `Spoiler no topic (radical/termo): entrega "${matchedAcronymInTopic || matchedKws[0] || firstTargetKw}" da resposta.`,
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
    const pAcronyms = new Set(extractAcronymTokens(pText));
    const exactLeak =
      targetNorm.length > 0 &&
      (targetNorm === pNorm || (targetNorm.length > 4 && pNorm.includes(targetNorm)));
    const acronymLeak = targetAcronyms.some((acr) => pAcronyms.has(acr));
    const keywordLeak =
      targetKeywords.length >= 1 &&
      (targetKeywords.every((kw) => pWords.has(kw)) ||
        targetKeywords.some((kw) => kw.length >= 5 && pWords.has(kw)));
    if (exactLeak || acronymLeak || keywordLeak) {
      warnings.push({
        code: 'QUESTION_PAREN_SPOILER',
        field: 'question',
        severity: 'error',
        message: `Spoiler entre parênteses no enunciado: "(${pText})" antecipa a resposta.`,
      });
      break;
    }
  }

  // 10. Image mode recognition validation, visual legend (>= 6 words), modality conflict, and visual redundancy
  const hasQuestionImg = /<img\b/i.test(questionText);
  const hasHintImg = /<img\b/i.test(hintText);
  const hasAnyImg = hasQuestionImg || hasHintImg;

  if (card.image_mode === 'recognition') {
    if (cardType !== 'basic' || !hasQuestionImg) {
      warnings.push({
        code: 'RECOGNITION_MISMATCH',
        field: 'question',
        severity: 'error',
        message: 'image_mode "recognition" exige card basic com <img src="..."> na pergunta.',
      });
    }
    if (hasQuestionImg && hasHintImg) {
      warnings.push({
        code: 'RECOGNITION_MISMATCH',
        field: 'hint',
        severity: 'warning',
        message:
          'Não repita a mesma tag <img> no hint de cards recognition (use apenas a legenda <i>...</i>).',
      });
    }
  }

  if (!hasAnyImg && !card.isResolvingImage) {
    const hasOrphanVisualDeixis =
      /\b(?:tra[çc]ado|ecg|eletrocardiograma|exame|imagem|figura|foto|radiografia|rx|tc|tomografia|rm|resson[aâ]ncia|usg|ultrassom|ultrassonografia|ctg|cardiotocografia|l[aâ]mina|partograma|quadro\s+visual)\s+(?:abaixo|acima|ao\s+lado|em\s+anexo|anex[ao]|mostrad[ao]|apresentad[ao]|a\s+seguir)\b/i.test(
        visibleQuestion
      ) ||
      /\b(?:abaixo|acima)\s*,?\s*(?:observa-se|nota-se|evidencia-se|v[êe]-se)\b/i.test(
        visibleQuestion
      );
    if (hasOrphanVisualDeixis) {
      warnings.push({
        code: 'ORPHAN_VISUAL_REFERENCE',
        field: 'question',
        severity: 'error',
        message:
          'Enunciado faz referência visual ("abaixo"/"acima"/"em anexo") sem nenhuma tag <img> anexada.',
      });
    }
  }

  // Validate HTML tables (<table class="med-table">) structure & placement
  if (/<table\b/i.test(questionText)) {
    warnings.push({
      code: 'TABLE_MALFORMED',
      field: 'question',
      severity: 'error',
      message: 'Tabelas HTML não devem ficar na pergunta; mova <table class="med-table"> para o campo "hint".',
    });
  }
  if (/<table\b/i.test(answerText)) {
    warnings.push({
      code: 'TABLE_MALFORMED',
      field: 'answer',
      severity: 'error',
      message: 'Tabelas HTML não devem ficar na resposta; mova <table class="med-table"> para o campo "hint".',
    });
  }
  if (/<table\b|<\/table>/i.test(hintText)) {
    const openTables = (hintText.match(/<table\b/gi) || []).length;
    const closeTables = (hintText.match(/<\/table>/gi) || []).length;
    const openTr = (hintText.match(/<tr\b/gi) || []).length;
    const closeTr = (hintText.match(/<\/tr>/gi) || []).length;
    const openCell = (hintText.match(/<t[dh]\b/gi) || []).length;
    const closeCell = (hintText.match(/<\/t[dh]>/gi) || []).length;
    const hasHeaderCell = /<th\b/i.test(hintText);
    const rows = hintText.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
    const maxCols = rows.reduce((max, row) => {
      const cells = (row.match(/<t[dh]\b/gi) || []).length;
      return Math.max(max, cells);
    }, 0);

    if (
      openTables === 0 ||
      openTables !== closeTables ||
      openTr === 0 ||
      openTr !== closeTr ||
      openCell !== closeCell ||
      !hasHeaderCell
    ) {
      warnings.push({
        code: 'TABLE_MALFORMED',
        field: 'hint',
        severity: 'error',
        message:
          'Tabela HTML malformada no hint: garanta tags fechadas (<table>, <tr>, <th>, <td>) e cabeçalho <th>.',
      });
    } else if (maxCols > 5) {
      warnings.push({
        code: 'TABLE_MALFORMED',
        field: 'hint',
        severity: 'warning',
        message: `Tabela no hint com ${maxCols} colunas (máx. recomendado: 4–5 colunas para leitura móvel no Anki).`,
      });
    }
  }

  if (hasAnyImg) {
    const legendEntries = extractVisualLegendEntries(card);
    const hasValidLegend = legendEntries.some((entry) => entry.wordCount >= MIN_VISUAL_LEGEND_WORDS);
    if (!hasValidLegend) {
      const bestCount = legendEntries.reduce((max, e) => Math.max(max, e.wordCount), 0);
      warnings.push({
        code: 'RECOGNITION_MISMATCH',
        field: 'hint',
        severity: 'error',
        message:
          legendEntries.length === 0
            ? `[IMAGE_MISSING_LEGEND] Imagem sem legenda descritiva em <i>...</i> (mín. ${MIN_VISUAL_LEGEND_WORDS} palavras) associada ao card.`
            : `[IMAGE_MISSING_LEGEND] Legenda visual em <i>...</i> muito curta (${bestCount}/${MIN_VISUAL_LEGEND_WORDS} palavras descritivas mínimas).`,
      });
    } else if (
      legendEntries.every((e) =>
        /^Achado visual complementar do exame clínico para correlação diagnóstica/i.test(
          e.descriptiveText
        )
      )
    ) {
      warnings.push({
        code: 'RECOGNITION_MISMATCH',
        field: 'hint',
        severity: 'warning',
        message:
          'Legenda visual genérica detectada; descreva o achado real visível na imagem (≥ 6 palavras).',
      });
    }

    const modalityCheck = detectModalityConflict(card);
    if (modalityCheck.hasConflict && modalityCheck.message) {
      warnings.push({
        code: 'RECOGNITION_MISMATCH',
        field: 'hint',
        severity: 'error',
        message: `[MODALITY_CONFLICT] ${modalityCheck.message}`,
      });
    }

    const redundancyCheck = detectRedundantVisualDescription(card);
    if (redundancyCheck.isRedundant && redundancyCheck.reason) {
      warnings.push({
        code: 'RECOGNITION_MISMATCH',
        field: 'question',
        severity: 'warning',
        message: `[REDUNDANT_VISUAL_DESCRIPTION] ${redundancyCheck.reason}`,
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
function stripMediaTagAndAdjacentBreaks(html: string, rawTag: string): string {
  if (!html || !rawTag) return html;
  const escaped = rawTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = html.replace(
    new RegExp(`(?:<br\\s*\\/?>\\s*)*${escaped}(?:\\s*<br\\s*\\/?>)*`, 'gi'),
    (full) => {
      const hasLeadingBr = /^\s*<br\b/i.test(full);
      const hasTrailingBr = /<br\s*\/?>\s*$/i.test(full);
      return hasLeadingBr && hasTrailingBr ? '<br>' : '';
    }
  );
  if (out === html) {
    out = out.replace(rawTag, '');
  }
  return out
    .replace(/^(?:\s*<br\s*\/?>\s*)+/i, '')
    .replace(/(?:\s*<br\s*\/?>\s*)+$/i, '')
    .trim();
}

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

  const hadImgInQuestion = /<img\b/i.test(card.question || '');
  const hadImgInHint = /<img\b/i.test(card.hint || '');
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
      question = stripMediaTagAndAdjacentBreaks(question, ref.rawTag);
      hint = stripMediaTagAndAdjacentBreaks(hint, ref.rawTag);
    }
  }

  const stillHasImgInQuestion = /<img\b/i.test(question);
  const stillHasImgInHint = /<img\b/i.test(hint);
  let nextImageMode = card.image_mode;

  if (!stillHasImgInQuestion && !stillHasImgInHint) {
    nextImageMode = undefined;
    if (hadImgInQuestion || hadImgInHint) {
      hint = hint.replace(/^<i>[\s\S]*?<\/i>(?:\s*<br\s*\/?>\s*)*/i, '').trim();
    }
    // Clean orphaned visual deictic phrases when all images were stripped
    question = question
      .replace(
        /\b(?:realiza|submete-se\s+a|apresenta)\s+(?:o|a|ao)\s+(?:tra[çc]ado|ecg|eletrocardiograma|exame|rx|radiografia|tc|tomografia|rm|resson[aâ]ncia|usg|ultrassom|ultrassonografia|ctg|cardiotocografia)\s+(?:abaixo|acima|ao\s+lado|em\s+anexo|anex[ao]|mostrad[ao]|apresentad[ao]|a\s+seguir)\b/gi,
        (m) => m.replace(/\s+(?:abaixo|acima|ao\s+lado|em\s+anexo|anex[ao]|mostrad[ao]|apresentad[ao]|a\s+seguir)\b/gi, '')
      )
      .replace(
        /\b(tra[çc]ado|ecg|eletrocardiograma|exame|imagem|figura|foto|radiografia|rx|tc|tomografia|rm|resson[aâ]ncia|usg|ultrassom|ultrassonografia|ctg|cardiotocografia|l[aâ]mina|partograma)\s+(?:abaixo|acima|ao\s+lado|em\s+anexo|anex[ao]|mostrad[ao]|apresentad[ao]|a\s+seguir)\b/gi,
        '$1 clínico'
      )
      .replace(
        /\b(?:abaixo|acima)\s*,?\s*(observa-se|nota-se|evidencia-se|v[êe]-se)\b/gi,
        '$1'
      )
      .replace(/\s{2,}/g, ' ')
      .trim();
  } else if (card.image_mode === 'recognition' && !stillHasImgInQuestion) {
    nextImageMode = undefined;
    if (hadImgInQuestion) {
      hint = hint.replace(/^<i>[\s\S]*?<\/i>(?:\s*<br\s*\/?>\s*)*/i, '').trim();
    }
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

  const cleanDeckKey =
    (deckKey || metadata.detectedDeckKey || 'internato_deck')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'internato_deck';

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

    const preservedExamRefs =
      Array.isArray(card.exam_refs) && card.exam_refs.length > 0
        ? card.exam_refs
        : originalCard?.exam_refs;
    const preservedHash = card.last_synced_hash || originalCard?.last_synced_hash;
    const preservedPriority = card.priority || originalCard?.priority;

    const hasClozeMarkup = /\{\{c\d+::[\s\S]+?\}\}/.test(question);
    const normalizedType: 'basic' | 'cloze' =
      card.type === 'cloze' || (hasClozeMarkup && !String(card.answer || '').trim())
        ? 'cloze'
        : 'basic';

    return {
      ...card,
      id: preservedId,
      deck_key: cleanDeckKey,
      type: normalizedType,
      answer: normalizedType === 'cloze' ? '' : card.answer,
      question,
      hint,
      tags: cardTags,
      ...(preservedExamRefs && preservedExamRefs.length > 0 ? { exam_refs: preservedExamRefs } : {}),
      ...(preservedHash ? { last_synced_hash: preservedHash } : {}),
      ...(preservedPriority ? { priority: preservedPriority } : {}),
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
  const cleanDeckKey =
    (deckKey || metadata?.detectedDeckKey || 'internato_deck')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'internato_deck';

  const mediaResolution = buildDeckMediaResolution(cards, cleanDeckKey);

  const strictNotes = cards.map((card) => {
    const tags = Array.from(
      new Set([
        cleanDeckKey,
        ...(Array.isArray(card.tags)
          ? card.tags.map((t) => String(t).trim()).filter((t) => t && !/\s/.test(t))
          : []),
      ])
    );

    const localQuestion = rewriteHtmlImgsToLocalAnki(
      card.question || '',
      card.id,
      cleanDeckKey,
      (kind, _tag, srcVal, defaultName) =>
        mediaResolution.resolveFilenameForField(card.id, 'question', kind, srcVal, defaultName)
    );
    const localHint = rewriteHtmlImgsToLocalAnki(
      card.hint || '',
      card.id,
      cleanDeckKey,
      (kind, _tag, srcVal, defaultName) =>
        mediaResolution.resolveFilenameForField(card.id, 'hint', kind, srcVal, defaultName)
    );

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

const COMMENT_BOLD_SKIP_WORDS = new Set([
  'apenas', 'estudo', 'sempre', 'nunca', 'entre', 'sobre', 'antes', 'depois',
  'quando', 'porque', 'mesmo', 'ainda', 'muito', 'pouco', 'forma', 'casos',
  'passo', 'todas', 'todos', 'assim', 'entao', 'pode', 'podem', 'deve',
  'devem', 'sendo', 'estar', 'diante', 'quadro', 'paciente', 'conduta', 'medida',
]);

/**
 * Highlights the first significant medical token in bold if the comment lacks inline <b> emphasis,
 * skipping common adverbs/connectors and avoiding synthetic boilerplate text injection.
 */
function ensureBoldEmphasisInComment(textHint: string): string {
  const afterPrefix = textHint.replace(/^<b>\s*Coment[áa]rio:\s*<\/b>\s*/i, '');
  if (/<(?:b|strong)\b/i.test(afterPrefix)) return textHint;

  const prefixMatch = textHint.match(/^<b>\s*Coment[áa]rio:\s*<\/b>\s*/i);
  const prefix = prefixMatch ? prefixMatch[0] : '<b>Comentário:</b> ';
  const body = prefixMatch ? textHint.slice(prefix.length) : textHint;

  // Bold the first meaningful standalone 5+ letter token outside HTML tags
  const parts = body.split(/(<\/?[a-zA-Z!][^>]*>)/g);
  let bolded = false;
  const updated = parts
    .map((part) => {
      if (bolded || /^<\/?[a-zA-Z!]/.test(part)) return part;
      const matches = Array.from(part.matchAll(/\b([A-Za-zÀ-ú]{5,}(?:-[A-Za-zÀ-ú0-9]+)?)\b/g));
      for (const m of matches) {
        if (m.index === undefined) continue;
        const normalizedTok = m[1]
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        if (COMMENT_BOLD_SKIP_WORDS.has(normalizedTok)) continue;
        bolded = true;
        return `${part.slice(0, m.index)}<b>${m[1]}</b>${part.slice(m.index + m[1].length)}`;
      }
      if (matches.length > 0 && matches[0].index !== undefined) {
        const m = matches[0];
        bolded = true;
        return `${part.slice(0, m.index)}<b>${m[1]}</b>${part.slice(m.index + m[1].length)}`;
      }
      return part;
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
  const cardType: 'basic' | 'cloze' =
    String(card.type || 'basic').toLowerCase() === 'cloze' ? 'cloze' : 'basic';
  const prefix = (topic.split(' - ')[0] || 'Tema Clínico').trim();
  const candidateWithNeutralSub = `${prefix} - Tomada de Decisão e Conduta`;
  if (!lintCard({ ...card, type: cardType, topic: candidateWithNeutralSub, question, answer, hint }).metrics.hasTopicSpoiler) {
    return candidateWithNeutralSub;
  }

  // Filter out prefix words whose stem/acronym collides with target answer stems/acronyms
  const targetStr = cardType === 'basic' ? answer : question;
  const targetKws = extractCoreKeywords(targetStr);
  const targetStems = new Set(targetKws.map((k) => stemPortugueseWord(k)).filter((s) => s.length >= 4));
  const targetAcronyms = new Set(extractAcronymTokens(targetStr));
  const prefixTokens = prefix.split(/\s+/).filter(Boolean);
  const safeTokens = prefixTokens.filter((tok) => {
    const tokAcronyms = extractAcronymTokens(tok);
    if (tokAcronyms.some((acr) => targetAcronyms.has(acr))) return false;
    const kws = extractCoreKeywords(tok);
    if (kws.length === 0) return true;
    return !kws.some((kw) => {
      const st = stemPortugueseWord(kw);
      if (st.length >= 4 && targetStems.has(st)) return true;
      for (const ts of targetStems) {
        if (stemsCollideForSpoiler(st, ts)) return true;
      }
      return false;
    });
  });

  const safeNonConnectors = safeTokens.filter((t) => extractCoreKeywords(t).length > 0);
  if (safeNonConnectors.length >= 2) {
    const cleanedPrefix = safeTokens.join(' ').replace(/^(?:de|da|do|das|dos|em|na|no)\s+/i, '').trim();
    if (cleanedPrefix) {
      const candidate = `${cleanedPrefix} - Tomada de Decisão e Conduta`;
      if (!lintCard({ ...card, type: cardType, topic: candidate, question, answer, hint }).metrics.hasTopicSpoiler) {
        return candidate;
      }
    }
  }

  for (const fallbackPrefix of ['Manejo Clínico', 'Conduta Médica', 'Avaliação Diagnóstica', 'Tema Clínico']) {
    const candidate = `${fallbackPrefix} - Tomada de Decisão e Conduta`;
    if (!lintCard({ ...card, type: cardType, topic: candidate, question, answer, hint }).metrics.hasTopicSpoiler) {
      return candidate;
    }
  }
  return 'Tema Clínico - Tomada de Decisão e Conduta';
}

/**
 * Deterministically repairs formatting, spoiler, and structural hygiene issues without truncating
 * or mutating semantic Matuschak/Nielsen violations (which are preserved for AI repair).
 */
export function surgicalRepairCardLocal(card: CanonicalCard): CanonicalCard {
  const hasSilentCloze =
    /\{\{c\d+::[\s\S]+?\}\}/.test(card.question || '') && !String(card.answer || '').trim();
  const cardType: 'basic' | 'cloze' =
    String(card.type || 'basic').toLowerCase() === 'cloze' || hasSilentCloze
      ? 'cloze'
      : 'basic';
  const mediaInQuestion = extractMediaFromString(card.question || '');
  let question = replaceLatexWithUnicode((card.question || '').trim());
  let answer = replaceLatexWithUnicode((card.answer || '').trim());
  let hint = replaceLatexWithUnicode((card.hint || '').trim());
  let topic = replaceLatexWithUnicode((card.topic || 'Clínica Médica - Conduta no Internato').trim());

  // 1. Topic format (no ALL CAPS, normalize em-dash/en-dash separator to " - ")
  topic = topic.replace(/\s+[—–]\s+/g, ' - ');
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
    /qual\s+(?:é\s+)?(?:o\s+|a\s+)?(?:diagn[oó]stico|classifica[cç][aã]o|hip[oó]tese|achado|parede|mecanismo)(?:\s+[a-zà-ú0-9_-]+){0,2}\s+e\s+(?:qual\s+)?(?:a\s+|o\s+)?(conduta|tratamento|manejo|droga|f[áa]rmaco|antiarr[ií]tmico|interven[cç][aã]o)(?:\s+imediata|\s+de\s+escolha)?/gi,
    'Qual a $1 imediata de primeira escolha'
  );

  // 4. Fix vague temporal window ("Qual a conduta?", "Qual o manejo?") even if followed by media tags
  question = question.replace(
    /\b(?:qual\s+(?:é\s+)?(?:a\s+conduta|o\s+manejo|o\s+pr[oó]ximo\s+passo|o\s+tratamento)|como\s+conduzir|o\s+que\s+fazer)\s*\?(?=\s*(?:<[^>]+>\s*)*$)/i,
    'Qual é a conduta imediata de primeira escolha?'
  );

  // 5. Remove explicit parenthetical spoilers in question
  question = question.replace(
    /\s*\((?:tratar com|usar|iniciar|diagn[oó]stico:?|conduta:?|hinchey\s+[i1v]+)[^)]*\)/gi,
    ''
  );

  if (cardType === 'cloze') {
    answer = '';
    let seenFirstCloze = false;
    question = question.replace(/\{\{c\d+::([\s\S]*?)\}\}/g, (_match, inner: string) => {
      const targetOnly = (inner.split('::')[0] || '').trim();
      let cleanTarget = stripHtml(targetOnly).replace(/\s+/g, ' ').trim();
      let words = cleanTarget.split(/\s+/).filter(Boolean);

      if (words.length > MAX_CLOZE_WORDS) {
        cleanTarget = cleanTarget
          .replace(/\bpor\s+via\s+intravenosa\b/gi, 'IV')
          .replace(/\bvia\s+intravenosa\b/gi, 'IV')
          .replace(/\bpor\s+via\s+oral\b/gi, 'VO')
          .replace(/\bvia\s+oral\b/gi, 'VO')
          .replace(/\bpor\s+via\s+intramuscular\b/gi, 'IM')
          .replace(/\bvia\s+intramuscular\b/gi, 'IM')
          .replace(/\bdose\s+[úu]nica\b/gi, 'DU')
          .replace(/\bassociad[ao]s?\s+[àa]o?\b/gi, '+');
        for (const [pattern, repl] of MEDICAL_ABBREVIATIONS) {
          cleanTarget = cleanTarget.replace(pattern, repl);
        }
        cleanTarget = cleanTarget.replace(/\s+/g, ' ').trim();
        words = cleanTarget.split(/\s+/).filter(Boolean);
      }

      if (!seenFirstCloze) {
        seenFirstCloze = true;
        // Never leak overflow words outside `}}` as a spoiler in the question stem;
        // if still > MAX_CLOZE_WORDS, keep intact so lintCard flags CLOZE_TOO_LONG cleanly.
        return `{{c1::${cleanTarget}}}`;
      }
      return `<b>${cleanTarget}</b>`;
    });

    // Remove post-cloze parenthetical crutches e.g. {{c1::...}} (critérios)
    question = question.replace(
      /(\{\{c1::[\s\S]*?\}\})\s*\((?:crit[eé]rios?|pontos?|dias?|anos?|itens?|sinais?)\)/gi,
      '$1'
    );
  } else {
    // Basic card formatting hygiene (preserve semantic violations intact for Gemini repair)
    answer = answer.replace(/^(?:Resposta|R):\s*/i, '').trim();
    answer = answer.replace(/^<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>\.?$/i, '$2').trim();
    answer = answer.replace(/^<\/?(?:b|strong)>\s*|\s*<\/?(?:b|strong)>$/gi, '').trim();

    let plainWords = stripHtml(answer).replace(/\.$/, '').split(/\s+/).filter(Boolean);
    if (plainWords.length > MAX_BASIC_ANSWER_WORDS || stripHtml(answer).length > MAX_BASIC_ANSWER_CHARS) {
      answer = answer
        .replace(/\bpor\s+via\s+intravenosa\b/gi, 'IV')
        .replace(/\bvia\s+intravenosa\b/gi, 'IV')
        .replace(/\bpor\s+via\s+oral\b/gi, 'VO')
        .replace(/\bvia\s+oral\b/gi, 'VO')
        .replace(/\bpor\s+via\s+intramuscular\b/gi, 'IM')
        .replace(/\bvia\s+intramuscular\b/gi, 'IM')
        .replace(/\bdose\s+[úu]nica\b/gi, 'DU')
        .replace(/\bassociad[ao]s?\s+[àa]o?\b/gi, '+');
      for (const [pattern, repl] of MEDICAL_ABBREVIATIONS) {
        answer = answer.replace(pattern, repl);
      }
      answer = answer.replace(/\s+/g, ' ').trim();
    }

    if (answer && !answer.endsWith('.')) {
      answer = `${answer.replace(/[;:,?!]+$/, '')}.`;
    }
    if (answer.length > 1) {
      answer = answer.charAt(0).toUpperCase() + answer.slice(1);
    }
  }

  // 6. Clean remaining parenthetical spoilers that match answer or cloze keywords
  const checkAfterAnswer = lintCard({ ...card, type: cardType, topic, question, answer, hint });
  if (checkAfterAnswer.warnings.some((w) => w.code === 'QUESTION_PAREN_SPOILER')) {
    question = question.replace(/\s*\([^)]+\)/g, '');
  }
  if (checkAfterAnswer.metrics.hasTopicSpoiler) {
    topic = sanitizeTopicAgainstSpoiler({ ...card, type: cardType }, topic, question, answer, hint);
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
  const tableBlocks = hint.match(/<table\b[\s\S]*?<\/table>/gi) || [];
  const hintWithoutAudioOrTable = hint
    .replace(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi, '')
    .replace(/<table\b[\s\S]*?<\/table>/gi, '')
    .replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>')
    .trim();

  // Preserve leading <img> and visual <i>legend</i> before <b>Comentário:</b>
  const { legendPrefix, bodyHint } = splitLeadingMediaAndLegend(
    hintWithoutAudioOrTable,
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

  const tableSuffix = tableBlocks.length > 0 ? `<br><br>${tableBlocks.map((t) => t.trim()).join('<br><br>')}` : '';
  const audioSuffix = audioBlocks[0] ? `<br>${audioBlocks[0].trim()}` : '';
  hint = `${legendPrefix}${textHint}${tableSuffix}${audioSuffix}`.trim();

  return {
    ...card,
    type: cardType,
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
    .replace(
      /\s*(?::|é|são|consiste em|caracteriza-se por|define-se como|corresponde a)\s*___TARGET___[^.?!]*[.?!]?/i,
      ''
    )
    .replace(
      /\s+(?:feit[ao]\s+com|realizad[ao]\s+(?:por|com)|por\s+meio\s+de|atrav[eé]s\s+de|com|por|de|em|para|ao|à|no|na)\s+___TARGET___[^.?!]*[.?!]?/i,
      ''
    )
    .replace(/___TARGET___/g, 'qual parâmetro ou conduta específica')
    .replace(/\s+(?:com|por|de|em|para|ao|à)\s*$/i, '')
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
  metadata?: ExtractedDeckMetadata | null,
  deckKey: string = 'internato_deck',
  clinicalMap?: ClinicalMapResponse | null,
  options?: { skipTemplateGapAdditions?: boolean }
): { cards: CanonicalCard[]; stats: DeckCurationStats } {
  const safeMetadata: ExtractedDeckMetadata = metadata || {
    existingIds: [],
    mediaTags: [],
    detectedDeckKey: '',
    rawCards: [],
    removedOrphanAudioCount: 0,
  };
  const originalCount =
    safeMetadata.rawCards && safeMetadata.rawCards.length > 0
      ? safeMetadata.rawCards.length
      : inputCards.length;

  const existingIdSet = new Set<number>(safeMetadata.existingIds || []);
  const originalTypeById = new Map<number, 'basic' | 'cloze'>();
  for (const c of safeMetadata.rawCards || []) {
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
      if (dice >= 0.96 || (sameTarget && dice >= 0.82)) {
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

  // Step 3: Add missing high-yield P1-P4 concepts from Clinical Map (if provided and not skipped) with new IDs
  const cleanDeckKey = (deckKey || safeMetadata.detectedDeckKey || 'internato_deck')
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
    const checkedItems = clinicalMap.items.filter(
      (item) => item.checked !== false && !(item.id && item.id.startsWith('map-existing-'))
    );
    for (const item of checkedItems) {
      const itemTokens = tokenizeForSimilarity(`${item.subtopic} ${item.concept}`);
      const alreadyCovered = survivingTokenSets.some(
        (existing) => computeDiceSimilarity(itemTokens, existing.tokens) >= 0.42
      );

      if (!alreadyCovered) {
        const newId = nextNewId++;
        const cleanConcept = stripClozeMarkup(item.concept).replace(/\.$/, '').trim();
        const topicPrefix = (clinicalMap.themeTitle || cleanDeckKey.replace(/_/g, ' '))
          .split(/[—–-]/)[0]
          .trim();
        const topic = `${topicPrefix} - ${item.subtopic}`;

        let conciseConcept = stripHtml(cleanConcept).replace(/\s+/g, ' ').trim();
        for (const [pattern, repl] of MEDICAL_ABBREVIATIONS) {
          conciseConcept = conciseConcept.replace(pattern, repl);
        }
        conciseConcept = conciseConcept.replace(/\s+/g, ' ').trim();
        const conceptWords = conciseConcept.split(/\s+/).filter(Boolean);

        // Never truncate long concepts into arbitrary 4-word cloze fragments; only use cloze if naturally concise (<= 5 words)
        const canFitNaturalCloze =
          item.targetCardType === 'cloze' && conceptWords.length > 0 && conceptWords.length <= MAX_CLOZE_WORDS;

        const firstClause = conciseConcept.split(/[.;]/)[0]?.trim() || conciseConcept;
        const clauseWords = firstClause.split(/\s+/).filter(Boolean);
        let basicAnswerText =
          clauseWords.length <= MAX_BASIC_ANSWER_WORDS && firstClause.length <= MAX_BASIC_ANSWER_CHARS
            ? firstClause
            : conciseConcept;
        if (basicAnswerText.split(/\s+/).length > MAX_BASIC_ANSWER_WORDS || basicAnswerText.length > MAX_BASIC_ANSWER_CHARS) {
          const safeWords = clauseWords.slice(0, MAX_BASIC_ANSWER_WORDS);
          while (
            safeWords.length > 1 &&
            (safeWords.join(' ').length > MAX_BASIC_ANSWER_CHARS - 1 ||
              DANGLING_STOPWORDS.has(safeWords[safeWords.length - 1].toLowerCase().replace(/[,;:.]/g, '')))
          ) {
            safeWords.pop();
          }
          basicAnswerText = safeWords.join(' ');
        }
        basicAnswerText = basicAnswerText.replace(/[.;:,?!]+$/, '').trim() || 'Conduta prioritária';

        const rawNewCard: CanonicalCard = canFitNaturalCloze
          ? {
              id: newId,
              type: 'cloze',
              priority: item.priority,
              deck_key: cleanDeckKey,
              topic,
              question: `Na avaliação de <b>${item.subtopic}</b> no contexto de ${topicPrefix}, a conduta ou parâmetro prioritário fundamenta-se em {{c1::${conciseConcept}}}.`,
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
              question: `Diante de quadro compatível com <b>${item.subtopic}</b> (${topicPrefix}), qual a conduta ou parâmetro imediato de primeira escolha?`,
              answer: `${basicAnswerText}.`,
              hint: `<b>Comentário:</b> A diretriz preconiza <b>${cleanConcept}</b> (${item.guidelineNote}), evitando atraso diagnóstico frente aos <b>diferenciais de menor gravidade</b>.`,
              tags: [cleanDeckKey, item.priority.toLowerCase()],
            };

        const repairedNew = surgicalRepairCardLocal(rawNewCard);
        survivingCards.push(repairedNew);
        survivingTokenSets.push({
          tokens: itemTokens,
          targetKey: (canFitNaturalCloze ? conciseConcept : basicAnswerText).toLowerCase(),
        });
        addedCount++;
      }
    }
  }

  // Step 4: Reconcile IDs and media by ID preserving each card's natural format (basic vs cloze without rigid 50/50 quota)
  const reconciled = reconcileDeckIdsAndMedia(survivingCards, safeMetadata, cleanDeckKey).map((c) =>
    surgicalRepairCardLocal(c)
  );

  const finalCount = reconciled.length;
  const finalBasic = reconciled.filter((c) => c.type === 'basic').length;
  const basicPct = finalCount > 0 ? Math.round((finalBasic / finalCount) * 100) : 0;
  const clozePct = finalCount > 0 ? 100 - basicPct : 0;
  const survivingIdSet = new Set(reconciled.map((c) => Number(c.id)));
  const prunedIds = Array.from(existingIdSet)
    .filter((id) => !survivingIdSet.has(id))
    .sort((a, b) => a - b);
  const preservedIdsCount = reconciled.filter((c) => existingIdSet.has(Number(c.id))).length;
  const finalPrunedCount =
    existingIdSet.size > 0
      ? Math.max(prunedCount, prunedIds.length)
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
      prunedIds,
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

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Utf8Bytes(input: string): Uint8Array {
  const utf8 = new TextEncoder().encode(input);
  const bitLen = utf8.length * 8;
  const paddedLen = Math.ceil((utf8.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(utf8);
  padded[utf8.length] = 0x80;
  const view = new DataView(padded.buffer);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  view.setUint32(paddedLen - 8, hi, false);
  view.setUint32(paddedLen - 4, lo, false);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10)) >>> 0;
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    outView.setUint32(i * 4, H[i], false);
  }
  return out;
}

/**
 * Generates a deterministic positive integer deck_id from a deck_key string,
 * matching server/ankiExport.ts `computeDeckIdFromKey` byte-for-byte via SHA-256.
 */
export function computeDeterministicDeckId(deckKey: string): number {
  const clean =
    (deckKey || 'internato_deck')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'internato_deck';
  const digest = sha256Utf8Bytes(clean);
  const val = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
  return 1730000000000 + (val % 900000000);
}

/**
 * Computes a deterministic Anki GUID for `<deckKey>:id:<noteId>` or returns the existing entry
 * from `note_guid_registry.json`, matching server/ankiExport.ts `genankiGuidFor` byte-for-byte.
 */
export function resolveOrCreateNoteGuid(
  deckKey: string,
  deckId: number,
  noteId: number,
  registryEntries: Record<string, string>
): { guid: string; key: string } {
  const cleanKey =
    (deckKey || 'deck')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'deck';
  const regKey = `${cleanKey}:id:${noteId}`;
  if (registryEntries[regKey]) {
    return { guid: registryEntries[regKey], key: regKey };
  }

  const seed = `criador-de-cards__${deckId}__${regKey}`;
  const digest = sha256Utf8Bytes(seed);
  let val = 0n;
  for (let i = 0; i < 8; i++) {
    val = (val << 8n) | BigInt(digest[i]);
  }

  const base = BigInt(BASE91_TABLE.length);
  let guid = '';
  while (val > 0n) {
    const rem = Number(val % base);
    guid = BASE91_TABLE[rem] + guid;
    val = val / base;
  }
  const finalGuid = guid || `id${noteId}`;
  registryEntries[regKey] = finalGuid;
  return { guid: finalGuid, key: regKey };
}

/**
 * Full deck-level and card-level deterministic audit prior to `.apkg` export.
 * Enforces:
 * 1. DUPLICATE_IMAGE_IN_DECK (error): same `<img src="...">` used across multiple cards in the deck
 * 2. IMAGE_MISSING_LEGEND (error): any `<img>` in Question or Hint without `<i>...</i>` (>= 6 words)
 * 3. MODALITY_CONFLICT (error): card text modality conflicts with `<i>` legend modality (e.g. laparoscopia vs USG)
 * 4. REDUNDANT_VISUAL_DESCRIPTION (warning): `Med_Basic_Inverted_v2` (`basic`) card with image in Question that describes the visual finding in text
 * plus all per-card Wozniak/Matuschak/Nielsen/FSRS rules from `lintCard`.
 */
export function lintDeck(
  cards: CanonicalCard[],
  availableMediaNames?: Iterable<string>,
  deckKey: string = 'internato_deck'
): DeckAuditResult {
  const cardResults = cards.map((card) => lintCard(card, availableMediaNames));
  const duplicateImages = findDuplicateDeckImages(cards);
  const allIssues: DeckAuditWarning[] = [];

  for (const dup of duplicateImages) {
    allIssues.push({
      code: 'DUPLICATE_IMAGE_IN_DECK',
      cardIds: dup.cardIds,
      src: dup.src,
      field: 'deck',
      severity: 'error',
      message: `Imagem duplicada no mesmo deck: "${dup.src}" aparece em ${dup.cardIds.length} cards (IDs: ${dup.cardIds.join(', ')}).`,
    });
  }

  for (const res of cardResults) {
    for (const w of res.warnings) {
      let semanticCode: DeckAuditWarningCode = w.code;
      if (w.message.startsWith('[IMAGE_MISSING_LEGEND]')) {
        semanticCode = 'IMAGE_MISSING_LEGEND';
      } else if (w.message.startsWith('[MODALITY_CONFLICT]')) {
        semanticCode = 'MODALITY_CONFLICT';
      } else if (w.message.startsWith('[REDUNDANT_VISUAL_DESCRIPTION]')) {
        semanticCode = 'REDUNDANT_VISUAL_DESCRIPTION';
      }

      allIssues.push({
        code: semanticCode,
        cardId: res.cardId,
        field: w.field,
        severity: w.severity,
        message: w.message,
      });
    }
  }

  const errors = allIssues.filter((i) => i.severity === 'error');
  const warnings = allIssues.filter((i) => i.severity === 'warning');

  return {
    deckKey,
    isValid: errors.length === 0,
    canExport: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
    allIssues,
    duplicateImages,
    cardResults,
  };
}
