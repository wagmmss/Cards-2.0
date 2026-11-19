import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PdfExtractedImage } from '../types/deck';
import {
  assignCaptionsAndFilterWatermarks,
  collectPageCaptionMatches,
  extractCaptionHint,
  extractContextForFigure,
  hasClinicalFigurePageKeyword,
  hasExplicitClinicalVisualExamCue,
  isDidacticTextSlideOnly,
  isLikelyBannerOrDecorativeCandidate,
  shouldAllowFallbackPageCrop,
  type CaptionMatch,
  type RawPdfPageBuffer,
  type RawPdfPageImageCandidate,
} from './pdfImageCore';

export {
  assignCaptionsAndFilterWatermarks,
  collectPageCaptionMatches,
  extractCaptionHint,
  extractContextForFigure,
  hasClinicalFigurePageKeyword,
  hasExplicitClinicalVisualExamCue,
  isDidacticTextSlideOnly,
  isLikelyBannerOrDecorativeCandidate,
  shouldAllowFallbackPageCrop,
  type CaptionMatch,
  type RawPdfPageBuffer,
  type RawPdfPageImageCandidate,
};

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

function getPageObjectWithTimeout(
  objs: { get: (name: string, cb?: (data: unknown) => void) => unknown; has?: (name: string) => boolean },
  name: string,
  timeoutMs = 2500
): Promise<RawPdfImageObj | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);

    try {
      if (typeof objs.has === 'function' && objs.has(name)) {
        const val = objs.get(name) as RawPdfImageObj | null;
        globalThis.clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve(val || null);
        }
        return;
      }
      objs.get(name, (val: unknown) => {
        globalThis.clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve((val as RawPdfImageObj) || null);
        }
      });
    } catch {
      globalThis.clearTimeout(timer);
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
  if (aspect > 6.2 || aspect < 0.16) return null;

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
    const bucketCounts = new Map<number, number>();
    let minV = 255;
    let maxV = 0;
    for (let i = 0; i < sData.length; i += 4) {
      const lum = Math.round((sData[i] + sData[i + 1] + sData[i + 2]) / 3);
      const bucket = Math.floor(lum / 16);
      vals.push(bucket);
      bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
      if (lum < minV) minV = lum;
      if (lum > maxV) maxV = lum;
    }
    let maxBucketFreq = 0;
    for (const count of bucketCounts.values()) {
      if (count > maxBucketFreq) maxBucketFreq = count;
    }
    const dominantRatio = vals.length > 0 ? maxBucketFreq / vals.length : 1;
    // Reject solid/uniform blocks and flat single-color horizontal callout ribbons
    if (maxV - minV < 14 || (dominantRatio > 0.94 && aspect > 2.8)) {
      isUniform = true;
    }
    signature = `${targetW}x${targetH}:${vals.join('')}`;
  }

  if (isUniform) return null;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { dataUrl, width: targetW, height: targetH, signature, isUniform };
}

/**
 * Extracts real embedded clinical figures (and figure-rich slide pages as fallback)
 * directly from an uploaded PDF ArrayBuffer inside the browser.
 */
export async function extractImagesFromPdfBuffer(
  buffer: ArrayBuffer,
  pdfName: string,
  maxPages = 220,
  maxTotalImages = 300
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

  const pageBuffers: RawPdfPageBuffer[] = [];
  let totalRawCandidates = 0;

  try {
    const wasmUrl =
      typeof window !== 'undefined' && window.location?.origin
        ? new URL('/pdfjs-wasm/', window.location.origin).href
        : undefined;
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer.slice(0)),
      ...(wasmUrl ? { wasmUrl } : {}),
    });
    const pdfDoc = await loadingTask.promise;
    const pageLimit = Math.min(pdfDoc.numPages, maxPages);

    for (let pageNum = 1; pageNum <= pageLimit; pageNum++) {
      if (totalRawCandidates >= maxTotalImages * 3) break;

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
      const inlineImageObjs: RawPdfImageObj[] = [];
      let formXObjectCount = 0;
      let pathDrawCount = 0;

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
          } else if (fn === pdfjsLib.OPS.paintInlineImageXObject) {
            const inlineObj = opList.argsArray[i]?.[0] as RawPdfImageObj | undefined;
            if (inlineObj && (inlineObj.data || inlineObj.bitmap)) {
              inlineImageObjs.push(inlineObj);
            }
          } else if (fn === pdfjsLib.OPS.paintFormXObjectBegin) {
            formXObjectCount++;
          } else if (
            fn === pdfjsLib.OPS.constructPath ||
            fn === pdfjsLib.OPS.stroke ||
            fn === pdfjsLib.OPS.fill
          ) {
            pathDrawCount++;
          }
        }
      }

      const hasVectorDiagramOps = formXObjectCount >= 1 || pathDrawCount >= 14;
      const candidates: RawPdfPageImageCandidate[] = [];
      let figIdx = 0;

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

        for (const objName of imageObjNames) {
          let imgObj = await getPageObjectWithTimeout(page.objs, objName, 2500);
          if (!imgObj && page.commonObjs) {
            imgObj = await getPageObjectWithTimeout(page.commonObjs, objName, 2500);
          }
          if (!imgObj) continue;

          const encoded = drawPdfImageToCanvas(imgObj, 1050);
          if (!encoded) continue;

          figIdx++;
          totalRawCandidates++;
          candidates.push({
            id: `pdf_${cleanBase}_p${pageNum}_f${figIdx}`,
            pdfName,
            pageNumber: pageNum,
            width: encoded.width,
            height: encoded.height,
            dataUrl: encoded.dataUrl,
            pageTextSnippet: '',
            captionHint: '',
            suggestedFilename: `${cleanBase}_p${pageNum}_fig${figIdx}.jpg`,
            kind: 'embedded',
            signature: encoded.signature,
            byteLengthHint: encoded.dataUrl.length,
          });
        }
      }

      for (const inlineObj of inlineImageObjs) {
        const encoded = drawPdfImageToCanvas(inlineObj, 1050);
        if (!encoded) continue;

        figIdx++;
        totalRawCandidates++;
        candidates.push({
          id: `pdf_${cleanBase}_p${pageNum}_f${figIdx}`,
          pdfName,
          pageNumber: pageNum,
          width: encoded.width,
          height: encoded.height,
          dataUrl: encoded.dataUrl,
          pageTextSnippet: '',
          captionHint: '',
          suggestedFilename: `${cleanBase}_p${pageNum}_fig${figIdx}.jpg`,
          kind: 'embedded',
          signature: encoded.signature,
          byteLengthHint: encoded.dataUrl.length,
        });
      }

      // Defer page_crop rendering until cross-page watermark counts are known across the whole PDF
      pageBuffers.push({
        pageNumber: pageNum,
        pageText,
        captionMatches,
        candidates,
        fallbackCropCandidate: null,
        hasVectorDiagramOps,
      });

      page.cleanup();
    }

    // Compute cross-page watermark frequency (`pageCount >= 3`) BEFORE closing pdfDoc so pages
    // whose >8 XObjects were all repeated logos/icons still receive an on-demand vector/table page_crop!
    const rawSigPages = new Map<string, Set<number>>();
    for (const pb of pageBuffers) {
      for (const cand of pb.candidates) {
        const set = rawSigPages.get(cand.signature) || new Set<number>();
        set.add(pb.pageNumber);
        rawSigPages.set(cand.signature, set);
      }
    }

    for (const pb of pageBuffers) {
      const survivingCount = pb.candidates.filter((cand) => {
        const count = rawSigPages.get(cand.signature)?.size || 1;
        if (count >= 3) return false;
        const asp = cand.height > 0 ? cand.width / cand.height : 1;
        if (count >= 2 && (asp > 3.2 || asp < 0.32 || (cand.width <= 260 && cand.height <= 260))) {
          return false;
        }
        return !isLikelyBannerOrDecorativeCandidate(cand, pb.pageText);
      }).length;
      const needsPageCrop = shouldAllowFallbackPageCrop(
        pb.pageText,
        survivingCount,
        Boolean(pb.hasVectorDiagramOps)
      );
      if (!needsPageCrop) continue;

      try {
        const page = await pdfDoc.getPage(pb.pageNumber);
        const vp = page.getViewport({ scale: 1.35 });
        if (vp.width > 0 && vp.height > 0 && vp.width <= 2200 && vp.height <= 2500) {
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
            const dataUrl = pCanvas.toDataURL('image/jpeg', 0.84);
            pb.fallbackCropCandidate = {
              id: `pdf_${cleanBase}_p${pb.pageNumber}_page`,
              pdfName,
              pageNumber: pb.pageNumber,
              width: pCanvas.width,
              height: pCanvas.height,
              dataUrl,
              pageTextSnippet: pb.pageText.slice(0, 1000),
              captionHint: extractCaptionHint(pb.pageText, 0, 1),
              suggestedFilename: `${cleanBase}_p${pb.pageNumber}_slide.jpg`,
              kind: 'page_crop',
              signature: `page_${pb.pageNumber}_${pCanvas.width}x${pCanvas.height}`,
              byteLengthHint: dataUrl.length,
            };
          }
        }
        page.cleanup();
      } catch {
        // Non-fatal fallback skip for this page
      }
    }

    await loadingTask.destroy();
  } catch (err) {
    console.warn(`[pdfImageExtractor] Aviso ao extrair figuras de ${pdfName}:`, err);
    return [];
  }

  return assignCaptionsAndFilterWatermarks(pageBuffers, maxTotalImages);
}

export function base64ToArrayBuffer(base64Data: string): ArrayBuffer {
  const clean = (base64Data || '').includes(',') ? base64Data.split(',')[1] : base64Data;
  const binary = atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function getPdfDocumentPageCount(buffer: ArrayBuffer): Promise<number> {
  if (!buffer || buffer.byteLength === 0) return 0;
  ensurePdfWorker();
  const wasmUrl =
    typeof window !== 'undefined' && window.location?.origin
      ? new URL('/pdfjs-wasm/', window.location.origin).href
      : undefined;
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer.slice(0)),
    ...(wasmUrl ? { wasmUrl } : {}),
  });
  try {
    const pdfDoc = await loadingTask.promise;
    return pdfDoc.numPages;
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

export interface PdfRenderedPageInfo {
  width: number;
  height: number;
  pageText: string;
  numPages: number;
}

export interface PdfDocumentSession {
  readonly numPages: number;
  renderPage: (
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale?: number
  ) => Promise<PdfRenderedPageInfo>;
  destroy: () => Promise<void>;
}

/**
 * Opens a cached PDFDocumentProxy session so navigating pages or changing zoom
 * inside PdfGalleryModal reuses the already-parsed document instead of reparsing
 * the entire PDF ArrayBuffer on every page turn.
 */
export async function openPdfDocumentSession(buffer: ArrayBuffer): Promise<PdfDocumentSession> {
  ensurePdfWorker();
  const wasmUrl =
    typeof window !== 'undefined' && window.location?.origin
      ? new URL('/pdfjs-wasm/', window.location.origin).href
      : undefined;
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer.slice(0)),
    ...(wasmUrl ? { wasmUrl } : {}),
  });
  const pdfDoc = await loadingTask.promise;
  let destroyed = false;

  return {
    numPages: pdfDoc.numPages,
    async renderPage(pageNumber: number, canvas: HTMLCanvasElement, scale = 1.5) {
      if (destroyed) {
        throw new Error('Sessão do PDF já foi encerrada.');
      }
      const safePage = Math.max(1, Math.min(pageNumber, pdfDoc.numPages));
      const page = await pdfDoc.getPage(safePage);
      try {
        const vp = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.round(vp.width));
        canvas.height = Math.max(1, Math.round(vp.height));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
        }
        const textContent = await page.getTextContent().catch(() => ({ items: [] }));
        const pageText = (textContent.items as Array<{ str?: string }>)
          .map((it) => it.str || '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        return {
          width: canvas.width,
          height: canvas.height,
          pageText,
          numPages: pdfDoc.numPages,
        };
      } finally {
        page.cleanup();
      }
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      await loadingTask.destroy().catch(() => undefined);
    },
  };
}

export async function renderPdfPageToCanvas(
  buffer: ArrayBuffer,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.5
): Promise<PdfRenderedPageInfo> {
  const session = await openPdfDocumentSession(buffer);
  try {
    return await session.renderPage(pageNumber, canvas, scale);
  } finally {
    await session.destroy();
  }
}
