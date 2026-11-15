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
}

export function hasClinicalFigurePageKeyword(pageText: string): boolean {
  if (!pageText) return false;
  return /(?:\bfig\.?(?=\s*\d|\s|:|\b)|\b(?:figura|imagem|ecg|eletrocardiograma|tra[çc]ado|rx|radiografia|tomografia|ultrassom|ultrassonografia|usg|videolaparoscopia|laparoscopia|ctg|cardiotocografia|algoritmo|fluxograma|partograma|leopold|mcroberts|pelvimetria|hodge|de\s+lee|sinclitismo|est[áa]tica\s+fetal|mecanismo\s+de\s+parto|f[óo]rceps|v[áa]cuo\s+extrator|distocia|manobra)\b)/i.test(
    pageText
  );
}

export function collectPageCaptionMatches(pageText: string): CaptionMatch[] {
  if (!pageText) return [];
  const matches: CaptionMatch[] = [];
  const seenOffsets: number[] = [];

  const regex =
    /(?:Figura|Fig\.?(?=\s*\d|\s|:)|Imagem|Foto|USG|Ultrassom|Ultrassonografia|Videolaparoscopia|Laparoscopia|ECG|Eletrocardiograma|Traçado|Radiografia|Tomografia|Quadro|Tabela|Gráfico|Partograma|Manobra(?:\s+de\s+[A-ZÀ-ÿa-zà-ÿ]+)?)\s*\d*[:.\-–]?\s*[^.!?]{6,150}/gi;

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
    /(?:Figura|Fig\.?(?=\s*\d|\s|:)|Imagem|Foto|USG|Ultrassom|Ultrassonografia|Videolaparoscopia|Laparoscopia|ECG|Eletrocardiograma|Traçados?|Radiografia|Tomografia|Quadro|Tabela|Gráfico|Partograma|Manobra(?:\s+de\s+[A-ZÀ-ÿa-zà-ÿ]+)?)\s*\d*[:.\-–]?\s*[^.!?]{6,140}/i
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
 * Pure Phase-2 post-processor: computes cross-page watermark signatures (`pageCount >= 3`) first,
 * activates vector/slide `page_crop` fallback when a clinical figure page has zero surviving embedded
 * images after watermark removal, and then assigns sequential `figZeroIdx` captions ONLY to surviving
 * images so institution logos never steal Figure 1/2 captions.
 */
export function assignCaptionsAndFilterWatermarks(
  pageBuffers: RawPdfPageBuffer[],
  maxTotalImages = 45
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

    if (
      nonWatermarkCandidates.length === 0 &&
      pageBuf.fallbackCropCandidate &&
      hasClinicalFigurePageKeyword(pageBuf.pageText) &&
      pageBuf.pageText.length < 4200
    ) {
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
