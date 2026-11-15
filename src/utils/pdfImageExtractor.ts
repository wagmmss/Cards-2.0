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

function getPageObjectWithTimeout(
  objs: { get: (name: string, cb?: (data: unknown) => void) => unknown; has?: (name: string) => boolean },
  name: string,
  timeoutMs = 1500
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
  if (srcW < 140 || srcH < 95) return null;

  const aspect = srcW / srcH;
  if (aspect > 7.5 || aspect < 0.13) return null;

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
    } else {
      return null;
    }

    const imageData = new ImageData(rgba, srcW, srcH);
    tmpCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(tmpCanvas, 0, 0, targetW, targetH);
  } else {
    return null;
  }

  // Fast uniformity + perceptual hash check on 8x8 sample to drop solid banners & duplicate logos
  const sampleW = 8;
  const sampleH = 8;
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

function extractCaptionHint(pageText: string): string {
  const figMatch = pageText.match(
    /(?:Figura|Fig\.?|Imagem|Quadro|Tabela|Gráfico|ECG|Traçado)\s*\d*[:.\-–]?\s*[^.]{6,130}/i
  );
  if (figMatch?.[0]) {
    return figMatch[0].replace(/\s+/g, ' ').trim();
  }
  return pageText.slice(0, 120).trim();
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

  const cleanBase = pdfName
    .replace(/\.pdf$/i, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 26) || 'material';

  const rawExtracted: Array<PdfExtractedImage & { signature: string }> = [];

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

      // Render page lightly to populate page.objs when needed
      let pageExtractedCount = 0;
      if (imageObjNames.size > 0) {
        // Quick low-res render triggers pdf.js to decode all image XObjects into page.objs cleanly
        const vpLow = page.getViewport({ scale: 0.45 });
        const hiddenCanvas = document.createElement('canvas');
        hiddenCanvas.width = Math.max(1, Math.round(vpLow.width));
        hiddenCanvas.height = Math.max(1, Math.round(vpLow.height));
        const hiddenCtx = hiddenCanvas.getContext('2d');
        if (hiddenCtx) {
          await page.render({ canvasContext: hiddenCtx, canvas: hiddenCanvas, viewport: vpLow }).promise.catch(() => undefined);
        }

        let figIdx = 0;
        for (const objName of imageObjNames) {
          const imgObj = await getPageObjectWithTimeout(page.objs, objName, 1200);
          if (!imgObj) continue;
          const encoded = drawPdfImageToCanvas(imgObj, 1050);
          if (!encoded) continue;
          figIdx++;
          pageExtractedCount++;
          rawExtracted.push({
            id: `pdf_${cleanBase}_p${pageNum}_f${figIdx}`,
            pdfName,
            pageNumber: pageNum,
            width: encoded.width,
            height: encoded.height,
            dataUrl: encoded.dataUrl,
            pageTextSnippet: pageText.slice(0, 340),
            captionHint: extractCaptionHint(pageText),
            suggestedFilename: `${cleanBase}_p${pageNum}_fig${figIdx}.jpg`,
            kind: 'embedded',
            signature: encoded.signature,
          });
        }
      }

      // Fallback for slides/exams where diagnostic trace (ECG, flowchart) is vector-drawn without XObjects
      const hasClinicalFigureKeyword =
        /\b(figura|fig\.|ecg|eletrocardiograma|traçado|rx|radiografia|tomografia|ultrassom|ctg|cardiotocografia|algoritmo|fluxograma|partograma)\b/i.test(
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
            await page.render({ canvasContext: pCtx, canvas: pCanvas, viewport: vp }).promise.catch(() => undefined);
            rawExtracted.push({
              id: `pdf_${cleanBase}_p${pageNum}_page`,
              pdfName,
              pageNumber: pageNum,
              width: pCanvas.width,
              height: pCanvas.height,
              dataUrl: pCanvas.toDataURL('image/jpeg', 0.82),
              pageTextSnippet: pageText.slice(0, 340),
              captionHint: extractCaptionHint(pageText),
              suggestedFilename: `${cleanBase}_p${pageNum}_slide.jpg`,
              kind: 'page_crop',
              signature: `page_${pageNum}_${pCanvas.width}x${pCanvas.height}`,
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

  // Filter out repeated watermarks/logos/footers occurring on > 2 pages with the exact same visual signature
  const sigCounts = new Map<string, number>();
  for (const item of rawExtracted) {
    sigCounts.set(item.signature, (sigCounts.get(item.signature) || 0) + 1);
  }

  const seenOnce = new Set<string>();
  const finalImages: PdfExtractedImage[] = [];
  for (const item of rawExtracted) {
    const freq = sigCounts.get(item.signature) || 1;
    if (freq >= 3) continue; // Likely watermark / institution header logo
    if (seenOnce.has(item.signature)) continue;
    seenOnce.add(item.signature);
    const { signature: _omitSig, ...cleanItem } = item;
    finalImages.push(cleanItem);
    if (finalImages.length >= maxTotalImages) break;
  }

  return finalImages;
}
