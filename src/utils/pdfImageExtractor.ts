import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PdfExtractedImage } from '../types/deck';

let workerConfigured = false;
function ensurePdfWorker(): void {
  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
    workerConfigured = true;
  }
}

interface RawPdfImageObj {
  width?: number;
  height?: number;
  kind?: number; // 1 = GRAYSCALE_1BPP, 2 = RGB_24BPP, 3 = RGBA_32BPP
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
}

interface CaptionMatch {
  index: number;
  text: string;
}

function getPageObjectWithTimeout(
  objs: { get: (name: string, cb?: (data: unknown) => void) => unknown; has?: (name: string) => boolean },
  name: string,
  timeoutMs = 2500
): Promise<RawPdfImageObj | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);

    try {
      if (typeof objs.has === 'function' && objs.has(name)) {
        const val = objs.get(name) as RawPdfImageObj | null;
        window.clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve(val || null);
        }
        return;
      }
      objs.get(name, (val: unknown) => {
        window.clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve((val as RawPdfImageObj) || null);
        }
      });
    } catch {
      window.clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }
  });
}

function drawPdfImageToCanvas(
  imgObj: RawPdfImageObj,
  maxDim = 1100
): { dataUrl: string; width: number; height: number; signature: string; isUniform: boolean } | null {
  if (typeof document === 'undefined') return null;

  const srcW = Number(imgObj.bitmap?.width || imgObj.width || 0);
  const srcH = Number(imgObj.bitmap?.height || imgObj.height || 0);
  // Filter out tiny UI icons/logos (< 120x80) while preserving smaller USG/ECG crops
  if (srcW < 120 || srcH < 80) return null;

  const aspect = srcW / srcH;
  if (aspect > 8.5 || aspect < 0.12) return null;

  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Fill white behind transparent PNGs/masks so ECG/radiograph annotations remain legible
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetW, targetH);

  if (imgObj.bitmap) {
    ctx.drawImage(imgObj.bitmap, 0, 0, targetW, targetH);
  } else if (imgObj.data && srcW > 0 && srcH > 0) {
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = srcW;
    tmpCanvas.height = srcH;
    const tmpCtx = tmpCanvas.getContext('2d');
    if (!tmpCtx) return null;

    const rgba = new Uint8ClampedArray(srcW * srcH * 4);
    const data = imgObj.data;
    const totalPixels = srcW * srcH;

    if (data.length === totalPixels * 4) {
      rgba.set(data);
    } else if (data.length === totalPixels * 3) {
      for (let i = 0, j = 0; i < totalPixels; i++, j += 3) {
        const o = i * 4;
        rgba[o] = data[j];
        rgba[o + 1] = data[j + 1];
        rgba[o + 2] = data[j + 2];
        rgba[o + 3] = 255;
      }
    } else if (data.length === totalPixels) {
      for (let i = 0; i < totalPixels; i++) {
        const o = i * 4;
        const g = data[i];
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = 255;
      }
    } else if (data.length === Math.ceil(srcW / 8) * srcH) {
      // 1-bit grayscale mask fallback
      const rowBytes = Math.ceil(srcW / 8);
      for (let y = 0; y < srcH; y++) {
        for (let x = 0; x < srcW; x++) {
          const byte = data[y * rowBytes + (x >> 3)];
          const bit = (byte >> (7 - (x & 7))) & 1;
          const v = bit ? 255 : 0;
          const o = (y * srcW + x) * 4;
          rgba[o] = v;
          rgba[o + 1] = v;
          rgba[o + 2] = v;
          rgba[o + 3] = 255;
        }
      }
    } else {
      return null;
    }

    const imageData = new ImageData(rgba, srcW, srcH);
    tmpCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(tmpCanvas, 0, 0, targetW, targetH);
  } else {
    return null;
  }

  // 12x12 sample distinguishes subtle clinical annotations (arrows/highlights) while catching uniform banners
  const sampleW = 12;
  const sampleH = 12;
  const sCanvas = document.createElement('canvas');
  sCanvas.width = sampleW;
  sCanvas.height = sampleH;
  const sCtx = sCanvas.getContext('2d');
  let signature = `${targetW}x${targetH}`;
  let isUniform = false;

  if (sCtx) {
    sCtx.drawImage(canvas, 0, 0, sampleW, sampleH);
    const sData = sCtx.getImageData(0, 0, sampleW, sampleH).data;
    const vals: number[] = [];
    let minV = 255;
    let maxV = 0;
    for (let i = 0; i < sData.length; i += 4) {
      const lum = Math.round((sData[i] + sData[i + 1] + sData[i + 2]) / 3);
      vals.push(Math.floor(lum / 16));
      if (lum < minV) minV = lum;
      if (lum > maxV) maxV = lum;
    }
    if (maxV - minV < 14) {
      isUniform = true;
    }
    signature = `${targetW}x${targetH}:${vals.join('')}`;
  }

  if (isUniform) return null;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { dataUrl, width: targetW, height: targetH, signature, isUniform };
}

function collectPageCaptionMatches(pageText: string): CaptionMatch[] {
  if (!pageText) return [];
  const matches: CaptionMatch[] = [];
  const seenOffsets: number[] = [];

  const regex =
    /(?:Figura|Fig\.?|Imagem|Foto|USG|Ultrassom|Ultrassonografia|Videolaparoscopia|Laparoscopia|ECG|Eletrocardiograma|Traçado|Radiografia|Tomografia|Quadro|Tabela|Gráfico)\s*\d*[:.\-–]?\s*[^.!?]{6,150}/gi;

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

function extractContextForFigure(
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
    /(?:Figura|Fig\.?|Imagem|Foto|USG|Ultrassom|Ultrassonografia|Videolaparoscopia|Laparoscopia|ECG|Traçado|Radiografia|Tomografia|Quadro|Tabela|Gráfico)\s*\d*[:.\-–]?\s*[^.!?]{6,140}/i
  );

  let captionHint = '';
  if (localMatch?.[0]) {
    captionHint = localMatch[0].replace(/\s+/g, ' ').trim();
  } else {
    const rawSlice = localSnippet.slice(0, 140).trim();
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

function extractCaptionHint(pageText: string, figZeroIdx = 0, totalFigs = 1): string {
  const matches = collectPageCaptionMatches(pageText);
  return extractContextForFigure(pageText, matches, figZeroIdx, totalFigs).captionHint;
}

/**
 * Extracts real embedded clinical figures (and figure-rich slide pages as fallback)
 * directly from an uploaded PDF ArrayBuffer inside the browser.
 */
export async function extractImagesFromPdfBuffer(
  buffer: ArrayBuffer,
  pdfName: string,
  maxPages = 55,
  maxTotalImages = 45
): Promise<PdfExtractedImage[]> {
  if (typeof document === 'undefined' || !buffer || buffer.byteLength === 0) {
    return [];
  }

  ensurePdfWorker();

  const cleanBase =
    pdfName
      .replace(/\.pdf$/i, '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 26) || 'material';

  const rawExtracted: Array<PdfExtractedImage & { signature: string; byteLengthHint: number }> = [];

  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer.slice(0)),
    });
    const pdfDoc = await loadingTask.promise;
    const pageLimit = Math.min(pdfDoc.numPages, maxPages);

    for (let pageNum = 1; pageNum <= pageLimit; pageNum++) {
      if (rawExtracted.length >= maxTotalImages * 2) break;

      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent().catch(() => ({ items: [] }));
      const pageText = (textContent.items as Array<{ str?: string }>)
        .map((it) => it.str || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      const captionMatches = collectPageCaptionMatches(pageText);
      const opList = await page.getOperatorList().catch(() => null);
      const imageObjNames = new Set<string>();

      if (opList) {
        for (let i = 0; i < opList.fnArray.length; i++) {
          const fn = opList.fnArray[i];
          if (
            fn === pdfjsLib.OPS.paintImageXObject ||
            fn === pdfjsLib.OPS.paintImageXObjectRepeat
          ) {
            const name = opList.argsArray[i]?.[0];
            if (typeof name === 'string') {
              imageObjNames.add(name);
            }
          }
        }
      }

      // Render page lightly to populate page.objs and page.commonObjs before reading XObjects
      let pageExtractedCount = 0;
      if (imageObjNames.size > 0) {
        const vpLow = page.getViewport({ scale: 0.65 });
        const hiddenCanvas = document.createElement('canvas');
        hiddenCanvas.width = Math.max(1, Math.round(vpLow.width));
        hiddenCanvas.height = Math.max(1, Math.round(vpLow.height));
        const hiddenCtx = hiddenCanvas.getContext('2d');
        if (hiddenCtx) {
          await page
            .render({ canvasContext: hiddenCtx, canvas: hiddenCanvas, viewport: vpLow })
            .promise.catch(() => undefined);
        }

        const totalObjs = imageObjNames.size;
        let figIdx = 0;
        for (const objName of imageObjNames) {
          let imgObj = await getPageObjectWithTimeout(page.objs, objName, 2500);
          if (!imgObj && page.commonObjs) {
            imgObj = await getPageObjectWithTimeout(page.commonObjs, objName, 2500);
          }
          if (!imgObj) continue;

          const encoded = drawPdfImageToCanvas(imgObj, 1050);
          if (!encoded) continue;

          const { pageTextSnippet, captionHint } = extractContextForFigure(
            pageText,
            captionMatches,
            figIdx,
            totalObjs
          );

          figIdx++;
          pageExtractedCount++;
          rawExtracted.push({
            id: `pdf_${cleanBase}_p${pageNum}_f${figIdx}`,
            pdfName,
            pageNumber: pageNum,
            width: encoded.width,
            height: encoded.height,
            dataUrl: encoded.dataUrl,
            pageTextSnippet,
            captionHint,
            suggestedFilename: `${cleanBase}_p${pageNum}_fig${figIdx}.jpg`,
            kind: 'embedded',
            signature: encoded.signature,
            byteLengthHint: encoded.dataUrl.length,
          });
        }
      }

      // Fallback for slides/exams where diagnostic trace (ECG, flowchart) is vector-drawn without XObjects
      const hasClinicalFigureKeyword =
        /\b(figura|fig\.|ecg|eletrocardiograma|traçado|rx|radiografia|tomografia|ultrassom|ultrassonografia|usg|videolaparoscopia|laparoscopia|ctg|cardiotocografia|algoritmo|fluxograma|partograma)\b/i.test(
          pageText
        );
      if (pageExtractedCount === 0 && hasClinicalFigureKeyword && pageText.length < 1800) {
        const vp = page.getViewport({ scale: 1.25 });
        if (vp.width > 0 && vp.height > 0 && vp.width <= 2000 && vp.height <= 2200) {
          const pCanvas = document.createElement('canvas');
          pCanvas.width = Math.round(vp.width);
          pCanvas.height = Math.round(vp.height);
          const pCtx = pCanvas.getContext('2d');
          if (pCtx) {
            pCtx.fillStyle = '#ffffff';
            pCtx.fillRect(0, 0, pCanvas.width, pCanvas.height);
            await page
              .render({ canvasContext: pCtx, canvas: pCanvas, viewport: vp })
              .promise.catch(() => undefined);
            const dataUrl = pCanvas.toDataURL('image/jpeg', 0.82);
            rawExtracted.push({
              id: `pdf_${cleanBase}_p${pageNum}_page`,
              pdfName,
              pageNumber: pageNum,
              width: pCanvas.width,
              height: pCanvas.height,
              dataUrl,
              pageTextSnippet: pageText.slice(0, 1000),
              captionHint: extractCaptionHint(pageText, 0, 1),
              suggestedFilename: `${cleanBase}_p${pageNum}_slide.jpg`,
              kind: 'page_crop',
              signature: `page_${pageNum}_${pCanvas.width}x${pCanvas.height}`,
              byteLengthHint: dataUrl.length,
            });
          }
        }
      }

      page.cleanup();
    }

    await loadingTask.destroy();
  } catch (err) {
    console.warn(`[pdfImageExtractor] Aviso ao extrair figuras de ${pdfName}:`, err);
    return [];
  }

  // Track across WHICH distinct pages each visual signature repeats to filter headers/watermarks (>= 3 pages)
  const sigPages = new Map<string, Set<number>>();
  for (const item of rawExtracted) {
    const pages = sigPages.get(item.signature) || new Set<number>();
    pages.add(item.pageNumber);
    sigPages.set(item.signature, pages);
  }

  // Deduplicate exact cross-page clones while preserving same-page clean vs. annotated variants
  const seenCrossPage = new Set<string>();
  const seenSamePageExact = new Set<string>();
  const seenCaptionPerPage = new Map<string, number>();
  const finalImages: PdfExtractedImage[] = [];

  for (const item of rawExtracted) {
    const pageCount = sigPages.get(item.signature)?.size || 1;
    if (pageCount >= 3) continue; // Repeated institution logo / watermark across 3+ pages

    // Same-page figures can be clean vs. arrow-annotated variants: keep distinct byte sizes/captions on same page,
    // while still dropping byte-identical XObject clones
    const samePageExactKey = `${item.pageNumber}:${item.signature}:${Math.round(item.byteLengthHint / 512)}`;
    if (seenSamePageExact.has(samePageExactKey)) continue;
    seenSamePageExact.add(samePageExactKey);

    if (pageCount > 1 && seenCrossPage.has(item.signature)) {
      continue;
    }
    seenCrossPage.add(item.signature);

    // Ensure two variants on the same page have distinguishable captionHint labels
    const rawCaption = (item.captionHint || '').trim();
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
      captionHint: differentiatedCaption,
    });
    if (finalImages.length >= maxTotalImages) break;
  }

  return finalImages;
}
