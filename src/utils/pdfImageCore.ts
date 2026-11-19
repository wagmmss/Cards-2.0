import { PdfExtractedImage } from '../types/deck';

export interface CaptionMatch {
  index: number;
  text: string;
}

export interface RawPdfPageImageCandidate {
  id: string;
  pdfName: string;
  pageNumber: number;
  width: number;
  height: number;
  dataUrl: string;
  captionHint: string;
  pageTextSnippet: string;
  suggestedFilename: string;
  kind: 'embedded' | 'page_crop';
  signature: string;
  byteLengthHint: number;
}

export interface RawPdfPageBuffer {
  pageNumber: number;
  pageText: string;
  captionMatches: CaptionMatch[];
  candidates: RawPdfPageImageCandidate[];
  fallbackCropCandidate?: RawPdfPageImageCandidate | null;
  hasVectorDiagramOps?: boolean;
}

const EXPLICIT_CLINICAL_VISUAL_EXAM_RE =
  /(?:\bfig\.?(?=\s*\d|\s|:|\b)|\b(?:figura|imagem|foto\s+cl[ií]nica|ecg|ekg|eletrocardiograma|tra[çc]ado|supradesnivelamento|arritmia|rx|radiografia|raio[\s-]?x|tc|tomografia|angiotc|rm|rnm|resson[âa]ncia|colangiorresson[âa]ncia|ultrassom|ultrassonografia|usg|ecocardiograma|videolaparoscopia|laparoscopia|cistoscopia|uretrocistoscopia|otoscopia|colposcopia|histeroscopia|eda|endoscopia|colonoscopia|retossigmoidoscopia|fundoscopia|dermatoscopia|esfrega[çc]o|ctg|cardiotocografia|algoritmo|fluxograma|partograma|leopold|mcroberts|pelvimetria|hodge|de\s+lee|sinclitismo|est[áa]tica\s+fetal|mecanismo\s+de\s+parto|f[óo]rceps|v[áa]cuo[\s-]?extrator|distocia|manobra)\b)/i;

const DIDACTIC_CALLOUT_OR_SLIDE_RE =
  /\b(?:dica\s+de\s+prova|pulo\s+do\s+gato|pegadinha|fique\s+ligado|cai\s+na\s+prova|n[ãa]o\s+confunda|macete|mnem[ôo]nico|quest[ãa]o\s+comentada|coment[áa]rio\s+da\s+quest[ãa]o|alternativa\s+correta|gabarito|resumo\s+(?:do\s+cap[íi]tulo|final)|mapa\s+mental|aten[çc][ãa]o\s+especial|medgrupo|estrat[ée]gia\s*med|medway|medcof|sanar|aristo|hardwork|todos\s+os\s+direitos\s+reservados|qr\s*code|sum[áa]rio|refer[êe]ncias\s+bibliogr[áa]ficas)\b/i;

const STRIP_ALLOWED_MODALITY_RE =
  /\b(?:ecg|ekg|eletrocardiograma|ctg|cardiotocografia|tra[çc]ado|ritmo|derivac[õo]es|partograma|curva\s+de\s+friedman)\b/i;

export function hasExplicitClinicalVisualExamCue(text: string): boolean {
  if (!text) return false;
  return EXPLICIT_CLINICAL_VISUAL_EXAM_RE.test(text);
}

export function isDidacticTextSlideOnly(pageText: string): boolean {
  if (!pageText) return false;
  return DIDACTIC_CALLOUT_OR_SLIDE_RE.test(pageText) && !EXPLICIT_CLINICAL_VISUAL_EXAM_RE.test(pageText);
}

export function hasClinicalFigurePageKeyword(pageText: string): boolean {
  if (!pageText) return false;
  if (isDidacticTextSlideOnly(pageText)) return false;
  return (
    EXPLICIT_CLINICAL_VISUAL_EXAM_RE.test(pageText) ||
    /\b(?:quadro|tabela|escore|crit[eé]rios)\b/i.test(pageText)
  );
}

/**
 * Single source of truth used by both `pdfImageExtractor` and `pdfImageCore`
 * to decide whether a page deserves a full-page raster `page_crop` fallback.
 * Filters out didactic text slides ("Dica de prova", "Pulo do gato", "Questão comentada")
 * and text-heavy table/criteria pages lacking actual clinical exam cues or vector diagrams.
 */
export function shouldAllowFallbackPageCrop(
  pageText: string,
  survivingEmbeddedCount: number,
  hasVectorDiagramOps = false
): boolean {
  if (!pageText || pageText.length >= 12000) return false;
  if (isDidacticTextSlideOnly(pageText)) return false;
  if (!hasClinicalFigurePageKeyword(pageText)) return false;

  const hasExplicitVisual = hasExplicitClinicalVisualExamCue(pageText);
  // Require either an explicit clinical visual/exam/diagram cue OR vector drawing ops;
  // bare prose mentioning "tabela"/"quadro"/"critérios" with no vector art is usually a text slide.
  if (!hasExplicitVisual && !hasVectorDiagramOps) {
    return false;
  }

  return survivingEmbeddedCount === 0 || (Boolean(hasVectorDiagramOps) && survivingEmbeddedCount <= 1);
}

/**
 * Pure filter that rejects handout header/footer banners, decorative callout ribbons
 * ("Dica de prova", "Pulo do gato"), and tiny UI badges while preserving real clinical
 * exams (including wide ECG/CTG rhythm strips).
 */
export function isLikelyBannerOrDecorativeCandidate(
  item: Pick<RawPdfPageImageCandidate, 'width' | 'height' | 'captionHint' | 'pageTextSnippet'>,
  pageText = ''
): boolean {
  const w = Number(item.width || 0);
  const h = Number(item.height || 0);
  if (w < 120 || h < 80) return true;

  const aspect = w / h;
  const contextText = `${item.captionHint || ''} ${item.pageTextSnippet || ''} ${pageText || ''}`;
  const captionOnly = (item.captionHint || '').trim();
  const isStripModality = STRIP_ALLOWED_MODALITY_RE.test(contextText);

  // Ultra-wide divider strips or ultra-tall sidebar ribbons
  if (aspect > 6.2 || aspect < 0.16) return true;
  if (!isStripModality && (aspect > 4.2 || aspect < 0.24)) return true;

  // Explicit didactic callout / course branding banner without clinical exam caption
  if (
    captionOnly &&
    DIDACTIC_CALLOUT_OR_SLIDE_RE.test(captionOnly) &&
    !EXPLICIT_CLINICAL_VISUAL_EXAM_RE.test(captionOnly)
  ) {
    return true;
  }

  // Wide banner on a purely didactic text slide ("Dica de prova" / "Pulo do gato")
  if (isDidacticTextSlideOnly(pageText) && (aspect > 2.6 || w < 260 || h < 200)) {
    return true;
  }

  // Tiny square badge/icon (lightbulb, warning seal, mascot) unless explicitly captioned as an exam
  if (w < 180 && h < 180 && !EXPLICIT_CLINICAL_VISUAL_EXAM_RE.test(captionOnly)) {
    return true;
  }

  return false;
}

export function collectPageCaptionMatches(pageText: string): CaptionMatch[] {
  if (!pageText) return [];
  const matches: CaptionMatch[] = [];
  const seenOffsets: number[] = [];

  const regex =
    /(?:Figura|Fig\.?(?=\s*\d|\s|:)|Imagem|Foto|USG|Ultrassom|Ultrassonografia|Videolaparoscopia|Laparoscopia|Cistoscopia|Otoscopia|Colposcopia|Histeroscopia|Endoscopia|EDA|Colonoscopia|Resson[âa]ncia|RM|RNM|ECG|Eletrocardiograma|Ecocardiograma|Traçado|Radiografia|Tomografia|Fundoscopia|Dermatoscopia|Quadro|Tabela|Gráfico|Partograma|Manobra(?:\s+de\s+[A-ZÀ-ÿa-zà-ÿ]+)?)\s*\d*[:.\-–]?\s*[^.!?]{6,150}/gi;

  let m: RegExpExecArray | null;
  while ((m = regex.exec(pageText)) !== null) {
    const idx = m.index;
    // Skip duplicate overlapping matches within 45 chars of a captured caption start
    if (seenOffsets.some((prev) => Math.abs(prev - idx) < 45)) continue;
    seenOffsets.push(idx);
    matches.push({
      index: idx,
      text: m[0].replace(/\s+/g, ' ').trim(),
    });
  }
  return matches;
}

export function extractContextForFigure(
  pageText: string,
  captionMatches: CaptionMatch[],
  figureZeroIdx: number,
  totalFiguresOnPage: number
): { pageTextSnippet: string; captionHint: string } {
  if (!pageText) {
    return { pageTextSnippet: '', captionHint: '' };
  }

  const matched = captionMatches[figureZeroIdx];
  if (matched) {
    const start = Math.max(0, matched.index - 450);
    const end = Math.min(pageText.length, matched.index + 550);
    return {
      pageTextSnippet: pageText.slice(start, end).trim(),
      captionHint: matched.text,
    };
  }

  // Proportional position window along the page so middle/end figures don't inherit only the top 340 chars
  const totalCount = Math.max(1, totalFiguresOnPage);
  const ratio = totalCount === 1 ? 0.25 : (figureZeroIdx + 0.5) / totalCount;
  const center = Math.round(pageText.length * Math.min(0.92, Math.max(0.08, ratio)));
  const start = Math.max(0, center - 500);
  const end = Math.min(pageText.length, start + 1000);
  const localSnippet = pageText.slice(start, end).trim();

  // Look for a local caption phrase inside this proportional window
  const localMatch = localSnippet.match(
    /(?:Figura|Fig\.?(?=\s*\d|\s|:)|Imagem|Foto|USG|Ultrassom|Ultrassonografia|Videolaparoscopia|Laparoscopia|Cistoscopia|Otoscopia|Colposcopia|Histeroscopia|Endoscopia|EDA|Colonoscopia|Resson[âa]ncia|RM|RNM|ECG|Eletrocardiograma|Ecocardiograma|Traçados?|Radiografia|Tomografia|Fundoscopia|Dermatoscopia|Quadro|Tabela|Gráfico|Partograma|Manobra(?:\s+de\s+[A-ZÀ-ÿa-zà-ÿ]+)?)\s*\d*[:.\-–]?\s*[^.!?]{6,140}/i
  );

  let captionHint = '';
  if (localMatch?.[0]) {
    captionHint = localMatch[0].replace(/\s+/g, ' ').trim();
  } else {
    let rawSlice = localSnippet.slice(0, 140).trim();
    if (start > 0 && rawSlice) {
      if (!/\s/.test(pageText[start - 1] || '')) {
        rawSlice = rawSlice.replace(/^\S+\s+/, '');
      }
      rawSlice = rawSlice.replace(/^[,;:.–\-\s)]+/, '').trim();
    }
    captionHint =
      totalCount > 1 && rawSlice
        ? `${rawSlice} (fig. ${figureZeroIdx + 1})`
        : rawSlice;
  }

  return {
    pageTextSnippet: localSnippet,
    captionHint,
  };
}

export function extractCaptionHint(pageText: string, figZeroIdx = 0, totalFigs = 1): string {
  const matches = collectPageCaptionMatches(pageText);
  return extractContextForFigure(pageText, matches, figZeroIdx, totalFigs).captionHint;
}

/**
 * Pure Phase-2 post-processor: computes cross-page watermark signatures (`pageCount >= 3`,
 * or `>= 2` for banner/icon geometry) and filters decorative banners/text callouts first,
 * activates vector/slide `page_crop` fallback only on genuine clinical visual pages, and then
 * assigns sequential `figZeroIdx` captions ONLY to surviving images so logos/banners never steal captions.
 */
export function assignCaptionsAndFilterWatermarks(
  pageBuffers: RawPdfPageBuffer[],
  maxTotalImages = 300
): PdfExtractedImage[] {
  const sigPages = new Map<string, Set<number>>();
  for (const pageBuf of pageBuffers) {
    for (const item of pageBuf.candidates) {
      const pages = sigPages.get(item.signature) || new Set<number>();
      pages.add(item.pageNumber);
      sigPages.set(item.signature, pages);
    }
  }

  const seenCrossPage = new Set<string>();
  const seenSamePageExact = new Set<string>();
  const seenCaptionPerPage = new Map<string, number>();
  const finalImages: PdfExtractedImage[] = [];

  for (const pageBuf of pageBuffers) {
    if (finalImages.length >= maxTotalImages) break;

    const nonWatermarkCandidates: RawPdfPageImageCandidate[] = [];
    for (const item of pageBuf.candidates) {
      const pageCount = sigPages.get(item.signature)?.size || 1;
      if (pageCount >= 3) continue; // Repeated institution logo / watermark across 3+ pages

      const aspect = item.height > 0 ? item.width / item.height : 1;
      const isRepeatedIconOrBanner =
        pageCount >= 2 &&
        (aspect > 3.2 || aspect < 0.32 || (item.width <= 260 && item.height <= 260));
      if (isRepeatedIconOrBanner) continue;

      if (isLikelyBannerOrDecorativeCandidate(item, pageBuf.pageText)) {
        continue;
      }

      const samePageExactKey = `${item.pageNumber}:${item.signature}:${Math.round(item.byteLengthHint / 512)}`;
      if (seenSamePageExact.has(samePageExactKey)) continue;
      seenSamePageExact.add(samePageExactKey);

      nonWatermarkCandidates.push(item);
    }

    const survivingOnPage: RawPdfPageImageCandidate[] = [];
    for (const item of nonWatermarkCandidates) {
      const pageCount = sigPages.get(item.signature)?.size || 1;
      if (pageCount > 1 && seenCrossPage.has(item.signature)) {
        continue;
      }
      seenCrossPage.add(item.signature);
      survivingOnPage.push(item);
    }

    const shouldActivatePageCrop =
      Boolean(pageBuf.fallbackCropCandidate) &&
      shouldAllowFallbackPageCrop(
        pageBuf.pageText,
        nonWatermarkCandidates.length,
        Boolean(pageBuf.hasVectorDiagramOps)
      );

    if (shouldActivatePageCrop && pageBuf.fallbackCropCandidate) {
      survivingOnPage.push(pageBuf.fallbackCropCandidate);
    }

    const totalSurviving = survivingOnPage.length;
    for (let figZeroIdx = 0; figZeroIdx < totalSurviving; figZeroIdx++) {
      const item = survivingOnPage[figZeroIdx];
      const { pageTextSnippet, captionHint } =
        item.kind === 'page_crop'
          ? {
              pageTextSnippet: item.pageTextSnippet || pageBuf.pageText.slice(0, 1000),
              captionHint: item.captionHint || extractCaptionHint(pageBuf.pageText, 0, 1),
            }
          : extractContextForFigure(
              pageBuf.pageText,
              pageBuf.captionMatches,
              figZeroIdx,
              totalSurviving
            );

      // Post-caption guard: drop small/banner graphics whose assigned caption is purely a didactic callout
      if (
        item.kind === 'embedded' &&
        isLikelyBannerOrDecorativeCandidate(
          {
            width: item.width,
            height: item.height,
            captionHint,
            pageTextSnippet,
          },
          pageBuf.pageText
        )
      ) {
        continue;
      }

      const rawCaption = (captionHint || '').trim();
      const captionKey = `${item.pageNumber}:${rawCaption.toLowerCase()}`;
      const seenCapCount = (seenCaptionPerPage.get(captionKey) || 0) + 1;
      seenCaptionPerPage.set(captionKey, seenCapCount);

      const differentiatedCaption =
        rawCaption && seenCapCount > 1
          ? `${rawCaption} (variante ${seenCapCount} · pág. ${item.pageNumber})`
          : rawCaption;

      const { signature: _omitSig, byteLengthHint: _omitLen, ...cleanItem } = item;
      finalImages.push({
        ...cleanItem,
        pageTextSnippet,
        captionHint: differentiatedCaption,
      });

      if (finalImages.length >= maxTotalImages) break;
    }
  }

  return finalImages;
}
