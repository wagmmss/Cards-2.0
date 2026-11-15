import { MedicalImageResult, PdfExtractedImage, UploadedPdfFile } from '../types/deck';

export interface MaterialCatalogItem {
  id: string;
  pdfName: string;
  pageNumber: number;
  width: number;
  height: number;
  captionHint?: string;
  pageTextSnippet: string;
}

const MODALITY_PATTERNS: Array<{
  trigger: RegExp;
  candidate: RegExp;
}> = [
  {
    trigger: /\b(ecg|ekg|eletrocardiograma|supra|infra|arritmia|fibrilacao|flutter|bav|taquicardia|qrs|onda|delta|wpw|brd|bre|brugada)\b/i,
    candidate: /\b(ecg|ekg|eletrocardiograma|electrocardiogram|derivac|qrs|supra|st|arritmia|onda|ritmo|v1|v2|v5|v6)\b/i,
  },
  {
    trigger: /\b(rx|radiografia|raio[\s-]?x|torax|pneumotorax|pneumoperitonio|derrame|fratura|volvo)\b/i,
    candidate: /\b(rx|radiografia|raio[\s-]?x|radiograph|x-ray|torax|pneumotorax|fratura|derrame|velamento)\b/i,
  },
  {
    trigger: /\b(tc|tomografia|angiotc|hematoma|avc|hemorragia|pancreatite|diverticulite|apendicite|tep)\b/i,
    candidate: /\b(tc|tomografia|ct|corte|axial|contraste|hipodens|hiperdens|hematoma)\b/i,
  },
  {
    trigger: /\b(usg|ultrassom|ultrassonografia|ecografia|fast|e-fast|colecistite|ectopica|intussuscepcao)\b/i,
    candidate: /\b(usg|ultrassom|ultrassonografia|ecografia|doppler|sombra acustica|liquido livre)\b/i,
  },
  {
    trigger: /\b(ctg|cardiotocografia|dip|desaceleracao|taquissistolia|fetal)\b/i,
    candidate: /\b(ctg|cardiotocografia|desaceleracao|bcf|variabilidade|dip)\b/i,
  },
  {
    trigger: /\b(dermatoscopia|melanoma|lesao|pele|rash|exantema|herpes|zoster|sifilis|basocelular|eritema)\b/i,
    candidate: /\b(pele|cutanea|lesao|exantema|macula|papula|vesicula|melanoma|dermatoscopia)\b/i,
  },
  {
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

function normalizeTextTokens(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
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
    pageTextSnippet: img.pageTextSnippet.slice(0, 260),
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
    const key = (item.thumbUrl || item.id).trim();
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
    // Interleave up to 2 soft material hits with top web results so both sources are visible
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
 * against a card or search query. Returns clean `MedicalImageResult[]` tagged `fromMaterial: true`.
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
  const fullQueryText = `${context.answer || ''} ${context.query || ''} ${context.topic || ''} ${context.question || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const scored: Array<{ img: PdfExtractedImage; score: number }> = [];

  for (const img of materialImages) {
    let score = 0;

    if (context.preferredPdfImageId && img.id === context.preferredPdfImageId) {
      score += 140;
    }

    const hayText = `${img.captionHint || ''} ${img.pageTextSnippet || ''} ${img.pdfName || ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const hayTokens = new Set(normalizeTextTokens(hayText));

    let answerHits = 0;
    for (const tok of answerTokens) {
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

    score += answerHits * 18 + queryHits * 11 + Math.min(24, bodyHits * 5);

    for (const mod of MODALITY_PATTERNS) {
      if (mod.trigger.test(fullQueryText) && mod.candidate.test(hayText)) {
        score += 20;
      }
    }

    if (img.kind === 'embedded') {
      score += 6;
    }

    // Require minimum semantic overlap unless explicitly referenced by ID or no text query provided
    const hasSearchTerms =
      answerTokens.size > 0 || queryTopicTokens.size > 0 || bodyTokens.size > 0;
    if (
      (context.preferredPdfImageId && img.id === context.preferredPdfImageId) ||
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
        ? `Imagem do material anexado (${img.pdfName}, pág. ${img.pageNumber}): ${cleanCaption.slice(0, 120)}.`
        : `Imagem clínica extraída do material anexado (${img.pdfName}, pág. ${img.pageNumber}).`,
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
