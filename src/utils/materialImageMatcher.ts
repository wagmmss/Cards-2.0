import { CanonicalCard, MedicalImageResult, PdfExtractedImage, UploadedPdfFile } from '../types/deck';

export interface MaterialCatalogItem {
  id: string;
  pdfName: string;
  pageNumber: number;
  width: number;
  height: number;
  captionHint?: string;
  pageTextSnippet: string;
}

export type ModalityKey =
  | 'ecg'
  | 'rx'
  | 'tc'
  | 'rm'
  | 'usg'
  | 'laparoscopy'
  | 'eda'
  | 'colonoscopia'
  | 'ctg'
  | 'fundus'
  | 'smear'
  | 'derm'
  | 'partograma'
  | 'obstetric_maneuver'
  | 'flowchart';

const VISUAL_DIAGNOSTIC_MODALITIES = new Set<ModalityKey>([
  'ecg',
  'rx',
  'tc',
  'rm',
  'usg',
  'laparoscopy',
  'eda',
  'colonoscopia',
  'ctg',
  'fundus',
  'smear',
  'derm',
  'partograma',
  'obstetric_maneuver',
]);

const MODALITY_PATTERNS: Array<{
  key: ModalityKey;
  trigger: RegExp;
  candidate: RegExp;
}> = [
  {
    key: 'ecg',
    trigger:
      /\b(ecg|ekg|eletrocardiograma|supra|infra|arritmia|fibrilacao|flutter|bav|taquicardia|qrs|onda|delta|wpw|brd|bre|brugada)\b/i,
    candidate:
      /\b(ecg|ekg|eletrocardiograma|electrocardiogram|derivac|qrs|supra|st|arritmia|onda|ritmo|v1|v2|v5|v6)\b/i,
  },
  {
    key: 'rx',
    trigger:
      /\b(rx|radiografia|raio[\s-]?x|torax|pneumotorax|pneumoperitonio|derrame|fratura|volvo)\b/i,
    candidate:
      /\b(rx|radiografia|raio[\s-]?x|radiograph|x-ray|torax|pneumotorax|fratura|derrame|velamento)\b/i,
  },
  {
    key: 'tc',
    trigger:
      /\b(tc|tomografia|angiotc|hematoma|avc|hemorragia|pancreatite|diverticulite|apendicite|tep)\b/i,
    candidate:
      /\b(tc|tomografia|ct|corte\s+axial|contraste|hipodens|hiperdens|hematoma|tomografico)\b/i,
  },
  {
    key: 'rm',
    trigger:
      /\b(rm|rnm|ressonancia(?:\s+magnetica)?|colangiorressonancia|angiorressonancia|mri|magnetic\s+resonance)\b/i,
    candidate:
      /\b(rm|rnm|ressonancia(?:\s+magnetica)?|mri|magnetic\s+resonance|t1|t2|flair|difusao|colangiorressonancia)\b/i,
  },
  {
    key: 'usg',
    trigger:
      /\b(usg|ultrassom|ultrassonografia|ecografia|fast|e-fast|colecistite|ectopica|intussuscepcao|transvaginal|roda dentada|contas de rosario)\b/i,
    candidate:
      /\b(usg|ultrassom|ultrassonografia|ultrasound|sonography|ecografia|doppler|sombra acustica|liquido livre|transvaginal|roda dentada|contas de rosario|anecoic|hipoecoic|ecogenic)\b/i,
  },
  {
    key: 'laparoscopy',
    trigger:
      /\b(videolaparoscopia|laparoscopia|laparotomia|histeroscopia|aderencia|aderencias|fitz[\s-]?hugh[\s-]?curtis|cordas de violino|intraoperatorio|achado cirurgico|aspecto laparoscopico)\b/i,
    candidate:
      /\b(videolaparoscopia|laparoscopia|laparoscopy|laparoscopica|laparoscopico|laparotomia|histeroscopia|aderencia|aderencias|fitz[\s-]?hugh[\s-]?curtis|cordas de violino|intraoperatorio|achado cirurgico|aspecto laparoscopico|tuba inflamada)\b/i,
  },
  {
    key: 'eda',
    trigger:
      /\b(eda|endoscopia(?:\s+digestiva(?:\s+alta)?)?|esofagite|forrest|ulcera\s+peptica|varizes\s+esofagicas)\b/i,
    candidate:
      /\b(eda|endoscopia|endoscopy|endoscopica|endoscopico|mucosa\s+gastrica|ulcera|forrest|esofagite)\b/i,
  },
  {
    key: 'colonoscopia',
    trigger:
      /\b(colonoscopia|retossigmoidoscopia|coloscopia|polipo\s+colonico|pseudomembrana)\b/i,
    candidate:
      /\b(colonoscopia|colonoscopy|retossigmoidoscopia|colonoscopico|mucosa\s+colonica|polipo)\b/i,
  },
  {
    key: 'ctg',
    trigger:
      /\b(ctg|cardiotocografia|desaceleracao|desaceleracoes|taquissistolia|dip\s*[i123]|variabilidade\s+(?:ausente|minima|moderada)|linha\s+de\s+base\s+fetal|sofrimento\s+fetal\s+agudo|monitorizacao\s+fetal)\b/i,
    candidate:
      /\b(ctg|cardiotocografia|cardiotocography|desaceleracao|desaceleracoes|bcf|variabilidade|dip\s*[i123]|taquissistolia|linha\s+de\s+base)\b/i,
  },
  {
    key: 'fundus',
    trigger:
      /\b(fundoscopia|fundo\s+de\s+olho|retinografia|retinopatia|papiledema|mancha\s+cereja|hemorragia\s+en\s+chama)\b/i,
    candidate:
      /\b(fundoscopia|fundoscopy|retina|retinografia|disco\s+optico|papila|macula|fundus)\b/i,
  },
  {
    key: 'smear',
    trigger:
      /\b(esfregaco|lamina\s+histologica|hematoscopia|histopatologia|histologia|esquizocito|drepanocito|blasto|bastonete\s+de\s+auer|papanicolaou|colpocitologia)\b/i,
    candidate:
      /\b(esfregaco|blood\s+smear|histologia|histology|histopatol|lamina|microscopia|biopsia|giemsa|hematoxilina)\b/i,
  },
  {
    key: 'derm',
    trigger:
      /\b(dermatoscopia|melanoma|lesao|pele|rash|exantema|herpes|zoster|sifilis|basocelular|eritema)\b/i,
    candidate:
      /\b(pele|cutanea|lesao|exantema|macula|papula|vesicula|melanoma|dermatoscopia|dermoscopy)\b/i,
  },
  {
    key: 'partograma',
    trigger:
      /\b(partograma|partogram|linha\s+de\s+alerta|linha\s+de\s+acao|parada\s+secundaria\s+da\s+(?:dilatacao|descida)|fase\s+ativa\s+prolongada)\b/i,
    candidate:
      /\b(partograma|partogram|linha\s+de\s+alerta|linha\s+de\s+acao|curva\s+de\s+friedman|dilatacao\s+cervical)\b/i,
  },
  {
    key: 'obstetric_maneuver',
    trigger:
      /\b(manobras?\s+de\s+leopold|leopold[\s-]?zweifel|distocia\s+de\s+ombro|mcroberts|rubin|woods|jacquemier|zavanelli|kristeller|ritgen|brandt[\s-]?andrews|forcipe|kielland|simpson|piper|vacuo[\s-]?extrator|pelvimetria|bacia\s+obstetrica|conjugata|episiotomia|estatica\s+fetal|sinclitismo|assinclitismo)\b/i,
    candidate:
      /\b(leopold|distocia\s+de\s+ombro|shoulder\s+dystocia|mcroberts|rubin|woods|jacquemier|zavanelli|forcipe|forceps|vacuum|pelvimetria|pelvimetry|bacia|conjugata|episiotomia|episiotomy|estatica\s+fetal|apresentacao\s+(?:cefalica|pelvica|cormica)|manobra|maneuver)\b/i,
  },
  {
    key: 'flowchart',
    trigger: /\b(fluxograma|algoritmo|escore|classificacao|criterios|estadiamento|tabela)\b/i,
    candidate: /\b(fluxograma|algoritmo|escore|classificacao|criterio|estadio|tabela|quadro)\b/i,
  },
];

const STOPWORDS = new Set([
  'para',
  'com',
  'sem',
  'que',
  'qual',
  'quais',
  'como',
  'onde',
  'quando',
  'paciente',
  'clinico',
  'clinica',
  'exame',
  'conduta',
  'primeira',
  'escolha',
  'linha',
  'imediata',
  'caso',
  'apresenta',
  'evolui',
  'sobre',
  'entre',
  'apos',
  'antes',
  'durante',
  'tratamento',
  'diagnostico',
  'manejo',
  'comentario',
  'imagem',
  'figura',
]);

function stripAccents(text: string): string {
  return (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeTextTokens(text: string): string[] {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export function detectModalitiesInText(text: string, mode: 'trigger' | 'candidate'): ModalityKey[] {
  const clean = stripAccents(text || '');
  if (!clean.trim()) return [];
  const matched: ModalityKey[] = [];
  for (const mod of MODALITY_PATTERNS) {
    const regex = mode === 'trigger' ? mod.trigger : mod.candidate;
    if (regex.test(clean)) {
      matched.push(mod.key);
    }
  }
  return matched;
}

/**
 * Checks whether a card's expected imaging modality (e.g. USG, ECG, RX, TC, CTG, laparoscopy)
 * directly conflicts with the candidate image's visual modality.
 */
export function hasLocalModalityConflict(
  expectedText: string,
  candidateCaptionText: string,
  candidateBodyText = ''
): boolean {
  const expectedVisual = detectModalitiesInText(expectedText, 'trigger').filter((m) =>
    VISUAL_DIAGNOSTIC_MODALITIES.has(m)
  );
  if (expectedVisual.length === 0) return false;

  const captionVisual = detectModalitiesInText(candidateCaptionText, 'candidate').filter((m) =>
    VISUAL_DIAGNOSTIC_MODALITIES.has(m)
  );
  if (captionVisual.length > 0) {
    return !expectedVisual.some((m) => captionVisual.includes(m));
  }

  const combinedVisual = detectModalitiesInText(
    `${candidateCaptionText} ${candidateBodyText}`,
    'candidate'
  ).filter((m) => VISUAL_DIAGNOSTIC_MODALITIES.has(m));
  if (combinedVisual.length > 0) {
    return !expectedVisual.some((m) => combinedVisual.includes(m));
  }

  return false;
}

export function canonicalizeImageSourceKey(rawUrlOrData: string): string {
  const raw = (rawUrlOrData || '').trim();
  if (!raw) return '';
  if (/^data:/i.test(raw)) {
    return `data:${raw.slice(0, 120)}:${raw.length}`;
  }
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const lowerHost = parsed.hostname.toLowerCase();
      if (lowerHost.includes('upload.wikimedia.org') || lowerHost.includes('commons.wikimedia.org')) {
        let lastSeg = decodeURIComponent(parsed.pathname.split('/').pop() || '');
        lastSeg = lastSeg.replace(/^\d+px-/i, '').toLowerCase().trim();
        if (lastSeg) return `wikimedia:${lastSeg}`;
      }
      return `url:${lowerHost}${parsed.pathname.replace(/\/+$/, '').toLowerCase()}`;
    } catch {
      return `url:${raw.toLowerCase()}`;
    }
  }
  return `local:${raw.toLowerCase()}`;
}

export function getImageCandidateTrackingKeys(item: MedicalImageResult): string[] {
  const keys = new Set<string>();
  if (item.id) {
    keys.add(item.id);
    if (item.id.startsWith('mat-')) {
      keys.add(item.id.slice(4));
    }
  }
  if (item.thumbUrl) {
    const thumbKey = canonicalizeImageSourceKey(item.thumbUrl);
    if (thumbKey) keys.add(thumbKey);
    if (item.thumbUrl.startsWith('data:')) keys.add(item.thumbUrl);
  }
  if (item.fullUrl) {
    const fullKey = canonicalizeImageSourceKey(item.fullUrl);
    if (fullKey) keys.add(fullKey);
    if (item.fullUrl.startsWith('data:')) keys.add(item.fullUrl);
  }
  return Array.from(keys);
}

/**
 * Extracts tracking keys for all already-resolved images across a deck so
 * automatic resolution enforces strict 1-image-to-1-card uniqueness.
 */
export function extractUsedImageKeysFromCards(
  cards: CanonicalCard[],
  materialImages: PdfExtractedImage[] = []
): Set<string> {
  const used = new Set<string>();
  const materialByDataUrl = new Map<string, PdfExtractedImage>();
  for (const img of materialImages || []) {
    if (img.dataUrl) {
      materialByDataUrl.set(img.dataUrl, img);
    }
  }

  for (const card of cards || []) {
    const combined = `${card.question || ''} ${card.hint || ''}`;
    const imgRegex = /<img\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = imgRegex.exec(combined)) !== null) {
      const tag = m[0];
      const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
      const srcVal = (srcMatch?.[1] || '').trim();
      if (!srcVal || /^(?:pdfimg|buscar_imagem):/i.test(srcVal)) continue;

      if (/^(?:https?:\/\/|data:)/i.test(srcVal)) {
        const key = canonicalizeImageSourceKey(srcVal);
        if (key) used.add(key);
        if (srcVal.startsWith('data:')) {
          used.add(srcVal);
          const mat = materialByDataUrl.get(srcVal);
          if (mat) {
            used.add(mat.id);
            used.add(`mat-${mat.id}`);
          }
        }
      }
    }
  }

  return used;
}

export function collectAllMaterialImages(pdfs: UploadedPdfFile[]): PdfExtractedImage[] {
  const out: PdfExtractedImage[] = [];
  for (const pdf of pdfs || []) {
    if (Array.isArray(pdf.extractedImages) && pdf.extractedImages.length > 0) {
      out.push(...pdf.extractedImages);
    }
  }
  return out;
}

export function buildCatalogFromExtractedImages(
  images: PdfExtractedImage[]
): MaterialCatalogItem[] {
  return (images || []).slice(0, 60).map((img) => ({
    id: img.id,
    pdfName: img.pdfName,
    pageNumber: img.pageNumber,
    width: img.width,
    height: img.height,
    captionHint: img.captionHint,
    pageTextSnippet: img.pageTextSnippet.slice(0, 320),
  }));
}

export function buildPdfImagesCatalog(pdfs: UploadedPdfFile[]): MaterialCatalogItem[] {
  return buildCatalogFromExtractedImages(collectAllMaterialImages(pdfs));
}

/**
 * Merges material-extracted figures (`fromMaterial: true`) and Web candidates
 * without duplicates, prioritizing exact/high-confidence material matches while keeping
 * both sources represented in the strip/gallery.
 */
export function mergeMaterialAndWebImages(
  materialHits: MedicalImageResult[],
  webHits: MedicalImageResult[],
  limit = 6
): MedicalImageResult[] {
  const mat = (materialHits || []).filter(Boolean);
  const web = (webHits || []).filter(Boolean);
  const seen = new Set<string>();
  const combined: MedicalImageResult[] = [];

  const pushUnique = (item: MedicalImageResult) => {
    const key = canonicalizeImageSourceKey(item.thumbUrl || item.id) || (item.thumbUrl || item.id).trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    combined.push(item);
  };

  // Strong material matches (>= 26 or exact ID boost >= 100) come first
  const strongMat = mat.filter((m) => (m.materialScore ?? 0) >= 26);
  const softMat = mat.filter((m) => (m.materialScore ?? 0) < 26);

  if (strongMat.length > 0) {
    strongMat.slice(0, 3).forEach(pushUnique);
    web.slice(0, 4).forEach(pushUnique);
    softMat.forEach(pushUnique);
    web.slice(4).forEach(pushUnique);
  } else {
    if (web.length > 0) {
      web.slice(0, 2).forEach(pushUnique);
      softMat.slice(0, 2).forEach(pushUnique);
      web.slice(2).forEach(pushUnique);
      softMat.slice(2).forEach(pushUnique);
    } else {
      softMat.forEach(pushUnique);
    }
  }

  return combined.slice(0, limit);
}

/**
 * Matches and ranks images extracted from user-uploaded materials (PDFs/Markdown)
 * against a card or search query, applying strict modality conflict detection and optional
 * `usedImageIds` deduplication across the deck.
 */
export function matchMaterialImagesForCard(
  materialImages: PdfExtractedImage[],
  context: {
    query?: string;
    topic?: string;
    question?: string;
    answer?: string;
    hint?: string;
    preferredPdfImageId?: string;
    usedImageIds?: Set<string>;
  }
): MedicalImageResult[] {
  if (!Array.isArray(materialImages) || materialImages.length === 0) {
    return [];
  }

  const answerTokens = new Set(normalizeTextTokens(context.answer || ''));
  const queryTopicTokens = new Set(
    normalizeTextTokens(`${context.query || ''} ${context.topic || ''}`)
  );
  const bodyTokens = new Set(
    normalizeTextTokens(`${context.question || ''} ${context.hint || ''}`)
  );

  // Use answer + query + topic + question (without hint noise) for expected visual modality
  const expectedModalitySource = stripAccents(
    `${context.answer || ''} ${context.query || ''} ${context.topic || ''} ${context.question || ''}`
  );
  const expectedVisualMods = detectModalitiesInText(expectedModalitySource, 'trigger').filter((m) =>
    VISUAL_DIAGNOSTIC_MODALITIES.has(m)
  );
  const allExpectedMods = detectModalitiesInText(expectedModalitySource, 'trigger');

  const scored: Array<{ img: PdfExtractedImage; score: number }> = [];

  for (const img of materialImages) {
    if (context.usedImageIds) {
      const dataKey = img.dataUrl ? canonicalizeImageSourceKey(img.dataUrl) : '';
      if (
        context.usedImageIds.has(img.id) ||
        context.usedImageIds.has(`mat-${img.id}`) ||
        (img.dataUrl && context.usedImageIds.has(img.dataUrl)) ||
        (dataKey && context.usedImageIds.has(dataKey))
      ) {
        continue;
      }
    }

    const captionText = stripAccents(img.captionHint || '');
    const snippetText = stripAccents(`${img.pageTextSnippet || ''} ${img.pdfName || ''}`);
    const hayText = `${captionText} ${snippetText}`;
    const captionTokens = new Set(normalizeTextTokens(captionText));
    const hayTokens = new Set(normalizeTextTokens(hayText));

    const captionVisualMods = detectModalitiesInText(captionText, 'candidate').filter((m) =>
      VISUAL_DIAGNOSTIC_MODALITIES.has(m)
    );
    const bodyMods = detectModalitiesInText(hayText, 'candidate');

    const hasCaptionConflict =
      expectedVisualMods.length > 0 &&
      captionVisualMods.length > 0 &&
      !expectedVisualMods.some((m) => captionVisualMods.includes(m));

    if (hasCaptionConflict) {
      continue;
    }

    let score = 0;

    if (context.preferredPdfImageId && img.id === context.preferredPdfImageId) {
      score += 140;
    }

    let captionAnswerHits = 0;
    let answerHits = 0;
    for (const tok of answerTokens) {
      if (captionTokens.has(tok)) captionAnswerHits++;
      if (hayTokens.has(tok)) answerHits++;
    }
    let queryHits = 0;
    for (const tok of queryTopicTokens) {
      if (hayTokens.has(tok)) queryHits++;
    }
    let bodyHits = 0;
    for (const tok of bodyTokens) {
      if (hayTokens.has(tok)) bodyHits++;
    }

    score += captionAnswerHits * 12 + answerHits * 16 + queryHits * 11 + Math.min(20, bodyHits * 4);

    const hasBodyConflict =
      expectedVisualMods.length > 0 &&
      bodyMods.some((m) => VISUAL_DIAGNOSTIC_MODALITIES.has(m)) &&
      !expectedVisualMods.some((m) => bodyMods.includes(m));

    if (hasBodyConflict) {
      score -= 80;
    } else {
      for (const mod of allExpectedMods) {
        if (captionVisualMods.includes(mod as ModalityKey)) {
          score += 28;
        } else if (bodyMods.includes(mod)) {
          score += 18;
        }
      }
    }

    if (img.kind === 'embedded') {
      score += 6;
    }

    const hasSearchTerms =
      answerTokens.size > 0 || queryTopicTokens.size > 0 || bodyTokens.size > 0;
    if (
      (context.preferredPdfImageId && img.id === context.preferredPdfImageId && !hasBodyConflict) ||
      (!hasSearchTerms && img.kind === 'embedded') ||
      score >= 16
    ) {
      scored.push({ img, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 6).map(({ img, score }) => {
    const cleanCaption = (img.captionHint || img.pageTextSnippet || '').trim();
    const shortTitle =
      cleanCaption.slice(0, 70) || `${img.pdfName} (Pág. ${img.pageNumber})`;
    return {
      id: `mat-${img.id}`,
      title: shortTitle,
      thumbUrl: img.dataUrl,
      fullUrl: img.dataUrl,
      description: `Extraída de ${img.pdfName} · Pág. ${img.pageNumber}${
        cleanCaption ? ` — ${cleanCaption.slice(0, 120)}` : ''
      }`,
      suggestedFilename: img.suggestedFilename,
      defaultLegend: cleanCaption
        ? `Legenda visual: ${cleanCaption.slice(0, 130)}.`
        : `Legenda visual: figura clínica extraída de ${img.pdfName}, página ${img.pageNumber}.`,
      source: img.id.startsWith('mdimg_')
        ? 'Material (Markdown)'
        : `Material PDF (Pág. ${img.pageNumber})`,
      fromMaterial: true,
      pdfName: img.pdfName,
      pageNumber: img.pageNumber,
      materialScore: score,
    };
  });
}

/**
 * Extracts explicit image references (`![alt](url)` or `<img src="...">`) from uploaded Markdown/TXT materials.
 */
export function extractMarkdownTextImages(
  text: string,
  filename: string
): PdfExtractedImage[] {
  if (!text) return [];
  const results: PdfExtractedImage[] = [];
  const seen = new Set<string>();
  const cleanBase = filename
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 28);

  const pushImg = (url: string, alt: string, idx: number, contextSnippet: string) => {
    const trimmed = (url || '').trim();
    if (!trimmed || (!/^https?:\/\//i.test(trimmed) && !/^data:image\//i.test(trimmed))) {
      return;
    }
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    results.push({
      id: `mdimg_${cleanBase}_${idx + 1}`,
      pdfName: filename,
      pageNumber: 1,
      width: 600,
      height: 400,
      dataUrl: trimmed,
      pageTextSnippet: contextSnippet.slice(0, 320),
      captionHint: alt.trim(),
      suggestedFilename: `${cleanBase}_fig${idx + 1}.jpg`,
      kind: 'embedded',
    });
  };

  let idx = 0;
  const mdRegex = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdRegex.exec(text)) !== null) {
    const start = Math.max(0, m.index - 120);
    const end = Math.min(text.length, m.index + m[0].length + 140);
    pushImg(m[2], m[1], idx++, text.slice(start, end).replace(/\s+/g, ' ').trim());
  }

  const htmlRegex = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  while ((m = htmlRegex.exec(text)) !== null) {
    const altMatch = /\balt=["']([^"']*)["']/i.exec(m[0]);
    const start = Math.max(0, m.index - 120);
    const end = Math.min(text.length, m.index + m[0].length + 140);
    pushImg(m[1], altMatch?.[1] || '', idx++, text.slice(start, end).replace(/\s+/g, ' ').trim());
  }

  return results;
}
