import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CanonicalCard,
  MedicalImageResult,
  PdfExtractedImage,
  UploadedPdfFile,
} from '../../types/deck';
import { collectAllMaterialImages } from '../../utils/materialImageMatcher';
import {
  base64ToArrayBuffer,
  openPdfDocumentSession,
  type PdfDocumentSession,
} from '../../utils/pdfImageExtractor';
import {
  DeckImageUsageMap,
  normalizeImageSrcForComparison,
} from './CardMediaPanel';

function cardNeedsImage(card: CanonicalCard): boolean {
  if (card.needsManualImage) return true;
  const combined = `${card.question || ''} ${card.hint || ''}`;
  if (/<img\b[^>]*\bsrc=["'](?:pdfimg|buscar_imagem):/i.test(combined)) return true;
  return !/<img\b/i.test(combined);
}

interface PdfGalleryModalProps {
  open: boolean;
  onClose: () => void;
  pdfs: UploadedPdfFile[];
  cards: CanonicalCard[];
  initialCardId?: number | null;
  initialTab?: 'extracted' | 'browse';
  deckImageUsage: DeckImageUsageMap;
  onAttachImageToCard: (
    cardId: number,
    result: MedicalImageResult,
    legend: string,
    mode: 'recognition' | 'feedback'
  ) => void;
  onSaveCroppedPdfImage?: (pdfName: string, image: PdfExtractedImage) => void;
}

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function stripHtmlShort(html: string, maxLen = 78): string {
  const clean = (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 1)}…` : clean;
}

export const PdfGalleryModal: React.FC<PdfGalleryModalProps> = ({
  open,
  onClose,
  pdfs,
  cards,
  initialCardId = null,
  initialTab = 'extracted',
  deckImageUsage,
  onAttachImageToCard,
  onSaveCroppedPdfImage,
}) => {
  const allMaterialImages = useMemo(() => collectAllMaterialImages(pdfs), [pdfs]);
  const viewablePdfs = useMemo(
    () =>
      pdfs.filter(
        (p) =>
          (p.mimeType === 'application/pdf' || p.name.toLowerCase().endsWith('.pdf')) &&
          Boolean(p.rawArrayBuffer || p.base64Data)
      ),
    [pdfs]
  );

  const [activeTab, setActiveTab] = useState<'extracted' | 'browse'>(initialTab);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(
    initialCardId ?? cards[0]?.id ?? null
  );
  const [attachMode, setAttachMode] = useState<'recognition' | 'feedback'>('feedback');
  const [pdfFilter, setPdfFilter] = useState<string>('ALL');
  const [kindFilter, setKindFilter] = useState<'all' | 'embedded' | 'page_crop'>('all');
  const [searchText, setSearchText] = useState('');
  const [selectedFigure, setSelectedFigure] = useState<PdfExtractedImage | null>(null);
  const [customLegend, setCustomLegend] = useState('');
  const [statusFeedback, setStatusFeedback] = useState('');

  // Inline fast crop state for selectedFigure (composite extracted PDF figures)
  const [isCroppingFigure, setIsCroppingFigure] = useState(false);
  const [figureCropRect, setFigureCropRect] = useState<CropRect | null>(null);
  const [isDraggingFigure, setIsDraggingFigure] = useState(false);
  const figureDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const figureImgRef = useRef<HTMLImageElement | null>(null);

  // PDF Browser / Cropper state + cached PDFDocumentProxy session
  const [browsePdfName, setBrowsePdfName] = useState<string>('');
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [zoomScale, setZoomScale] = useState<number>(1.4);
  const [renderingPage, setRenderingPage] = useState(false);
  const [pageError, setPageError] = useState('');
  const [pageTextSnippet, setPageTextSnippet] = useState('');
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfSessionRef = useRef<{
    pdfName: string;
    bufRef: ArrayBuffer | string;
    session: PdfDocumentSession;
  } | null>(null);
  const cardsRef = useRef<CanonicalCard[]>(cards);
  cardsRef.current = cards;

  const pendingImageCardIds = useMemo(
    () => cards.filter((c) => cardNeedsImage(c)).map((c) => c.id),
    [cards]
  );

  useEffect(() => {
    if (!open) {
      if (pdfSessionRef.current) {
        void pdfSessionRef.current.session.destroy();
        pdfSessionRef.current = null;
      }
      setIsCroppingFigure(false);
      setFigureCropRect(null);
      return;
    }
    const latestCards = cardsRef.current;
    setActiveTab(initialTab);
    const nextCardId = initialCardId ?? latestCards[0]?.id ?? null;
    setSelectedCardId(nextCardId);
    const targetCard = latestCards.find((c) => c.id === nextCardId);
    if (targetCard?.type === 'cloze') {
      setAttachMode('feedback');
    } else if (targetCard?.image_mode) {
      setAttachMode(targetCard.image_mode);
    }
    setStatusFeedback('');
  }, [open, initialCardId, initialTab]);

  // Cleanup cached PDFDocumentProxy session on unmount
  useEffect(() => {
    return () => {
      if (pdfSessionRef.current) {
        void pdfSessionRef.current.session.destroy();
        pdfSessionRef.current = null;
      }
    };
  }, []);

  // Reset inline crop box whenever selected figure changes
  useEffect(() => {
    setIsCroppingFigure(false);
    setFigureCropRect(null);
    setIsDraggingFigure(false);
    figureDragStartRef.current = null;
  }, [selectedFigure?.id]);

  useEffect(() => {
    if (!open) return;
    if (!browsePdfName || !viewablePdfs.some((p) => p.name === browsePdfName)) {
      if (viewablePdfs[0]?.name) {
        setBrowsePdfName(viewablePdfs[0].name);
        setPageNumber(1);
      }
    }
  }, [open, viewablePdfs, browsePdfName]);

  const activeBrowsePdf = useMemo(
    () => viewablePdfs.find((p) => p.name === browsePdfName) || viewablePdfs[0] || null,
    [viewablePdfs, browsePdfName]
  );

  // Render PDF page when browsing, reusing cached PDFDocumentProxy per PDF
  useEffect(() => {
    if (!open || activeTab !== 'browse' || !activeBrowsePdf || !canvasRef.current) return;
    let cancelled = false;
    const render = async () => {
      setRenderingPage(true);
      setPageError('');
      setCropRect(null);
      try {
        const bufKey: ArrayBuffer | string =
          activeBrowsePdf.rawArrayBuffer || activeBrowsePdf.base64Data || '';
        let session = pdfSessionRef.current?.session || null;

        if (
          !session ||
          pdfSessionRef.current?.pdfName !== activeBrowsePdf.name ||
          pdfSessionRef.current?.bufRef !== bufKey
        ) {
          if (pdfSessionRef.current) {
            void pdfSessionRef.current.session.destroy();
            pdfSessionRef.current = null;
          }
          const buf =
            activeBrowsePdf.rawArrayBuffer ||
            (activeBrowsePdf.base64Data ? base64ToArrayBuffer(activeBrowsePdf.base64Data) : null);
          if (!buf) {
            throw new Error('Buffer do PDF não disponível para visualização.');
          }
          session = await openPdfDocumentSession(buf);
          if (cancelled) {
            void session.destroy();
            return;
          }
          pdfSessionRef.current = {
            pdfName: activeBrowsePdf.name,
            bufRef: bufKey,
            session,
          };
        }

        const info = await session.renderPage(pageNumber, canvasRef.current!, zoomScale);
        if (cancelled) return;
        setTotalPages(Math.max(1, info.numPages));
        if (pageNumber > info.numPages) {
          setPageNumber(info.numPages);
        }
        setPageTextSnippet(info.pageText.slice(0, 420));
      } catch (err) {
        if (!cancelled) {
          setPageError(err instanceof Error ? err.message : 'Falha ao renderizar página do PDF.');
        }
      } finally {
        if (!cancelled) setRenderingPage(false);
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [open, activeTab, activeBrowsePdf, pageNumber, zoomScale]);

  const filteredImages = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return allMaterialImages.filter((img) => {
      if (pdfFilter !== 'ALL' && img.pdfName !== pdfFilter) return false;
      if (kindFilter !== 'all' && (img.kind || 'embedded') !== kindFilter) return false;
      if (q) {
        const hay = `${img.pdfName} pág ${img.pageNumber} ${img.captionHint || ''} ${img.pageTextSnippet || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allMaterialImages, pdfFilter, kindFilter, searchText]);

  const selectedCard = useMemo(
    () => cards.find((c) => c.id === selectedCardId) || null,
    [cards, selectedCardId]
  );

  const getUsageCardIds = (img: PdfExtractedImage): number[] => {
    const ids = new Set<number>();
    const norm = normalizeImageSrcForComparison(img.dataUrl);
    if (norm) {
      for (const id of deckImageUsage.byNormalizedSrc.get(norm) || []) {
        ids.add(id);
      }
    }
    if (img.suggestedFilename) {
      for (const id of deckImageUsage.byFilename.get(img.suggestedFilename.toLowerCase()) || []) {
        ids.add(id);
      }
    }
    return Array.from(ids).sort((a, b) => a - b);
  };

  const toMedicalImageResult = (img: PdfExtractedImage): MedicalImageResult => {
    const cleanCaption = (img.captionHint || img.pageTextSnippet || '').trim();
    return {
      id: `mat-${img.id}`,
      title: cleanCaption.slice(0, 70) || `${img.pdfName} (Pág. ${img.pageNumber})`,
      thumbUrl: img.dataUrl,
      fullUrl: img.dataUrl,
      description: `Extraída de ${img.pdfName} · Pág. ${img.pageNumber}`,
      suggestedFilename: img.suggestedFilename,
      defaultLegend: cleanCaption
        ? `Legenda visual: ${cleanCaption.slice(0, 140)}.`
        : `Legenda visual: figura de ${img.pdfName}, pág. ${img.pageNumber}.`,
      source: `Material PDF (Pág. ${img.pageNumber})`,
      fromMaterial: true,
      pdfName: img.pdfName,
      pageNumber: img.pageNumber,
    };
  };

  const handleAttachSelectedFigure = (img: PdfExtractedImage, overrideLegend?: string) => {
    if (!selectedCardId) {
      setStatusFeedback('Selecione um card alvo acima antes de anexar a figura.');
      return;
    }
    const result = toMedicalImageResult(img);
    const legend = (overrideLegend ?? customLegend).trim() || result.defaultLegend;
    onAttachImageToCard(selectedCardId, result, legend, attachMode);
    setStatusFeedback(
      `Figura da pág. ${img.pageNumber} anexada ao card ID ${selectedCardId} (${attachMode === 'recognition' ? 'Frente' : 'Verso'}).`
    );
  };

  const getRelativeCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (renderingPage || !canvasRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getRelativeCanvasCoords(e.clientX, e.clientY);
    dragStartRef.current = pt;
    setIsDragging(true);
    setCropRect({ x: pt.x, y: pt.y, w: 0, h: 0 });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStartRef.current) return;
    const pt = getRelativeCanvasCoords(e.clientX, e.clientY);
    const x = Math.min(dragStartRef.current.x, pt.x);
    const y = Math.min(dragStartRef.current.y, pt.y);
    const w = Math.abs(pt.x - dragStartRef.current.x);
    const h = Math.abs(pt.y - dragStartRef.current.y);
    setCropRect({ x, y, w, h });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsDragging(false);
    dragStartRef.current = null;
  };

  const getRelativeFigureCoords = (clientX: number, clientY: number) => {
    const imgEl = figureImgRef.current;
    if (!imgEl) return { x: 0, y: 0 };
    const rect = imgEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    return { x, y };
  };

  const handleFigurePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isCroppingFigure || !figureImgRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getRelativeFigureCoords(e.clientX, e.clientY);
    figureDragStartRef.current = pt;
    setIsDraggingFigure(true);
    setFigureCropRect({ x: pt.x, y: pt.y, w: 0, h: 0 });
  };

  const handleFigurePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingFigure || !figureDragStartRef.current) return;
    const pt = getRelativeFigureCoords(e.clientX, e.clientY);
    const x = Math.min(figureDragStartRef.current.x, pt.x);
    const y = Math.min(figureDragStartRef.current.y, pt.y);
    const w = Math.abs(pt.x - figureDragStartRef.current.x);
    const h = Math.abs(pt.y - figureDragStartRef.current.y);
    setFigureCropRect({ x, y, w, h });
  };

  const handleFigurePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsDraggingFigure(false);
    figureDragStartRef.current = null;
  };

  const buildCroppedSelectedFigure = (): PdfExtractedImage | null => {
    const imgEl = figureImgRef.current;
    if (!imgEl || !selectedFigure || !figureCropRect) return null;
    if (figureCropRect.w < 14 || figureCropRect.h < 14) return null;
    const rect = imgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || imgEl.naturalWidth <= 0 || imgEl.naturalHeight <= 0) {
      return null;
    }

    const scaleX = imgEl.naturalWidth / rect.width;
    const scaleY = imgEl.naturalHeight / rect.height;
    const sx = Math.max(0, Math.round(figureCropRect.x * scaleX));
    const sy = Math.max(0, Math.round(figureCropRect.y * scaleY));
    const sw = Math.min(imgEl.naturalWidth - sx, Math.round(figureCropRect.w * scaleX));
    const sh = Math.min(imgEl.naturalHeight - sy, Math.round(figureCropRect.h * scaleY));
    if (sw < 20 || sh < 20) return null;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = sw;
    outCanvas.height = sh;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return null;
    outCtx.fillStyle = '#ffffff';
    outCtx.fillRect(0, 0, sw, sh);
    outCtx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, sw, sh);

    const dataUrl = outCanvas.toDataURL('image/jpeg', 0.9);
    const cleanBase =
      selectedFigure.pdfName
        .replace(/\.pdf$/i, '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 24) || 'figura';

    const uid = Math.random().toString(36).slice(2, 6);
    const cleanLegend = customLegend.trim().replace(/^Legenda visual:\s*/i, '');

    return {
      id: `figcrop_${cleanBase}_p${selectedFigure.pageNumber}_${uid}`,
      pdfName: selectedFigure.pdfName,
      pageNumber: selectedFigure.pageNumber,
      width: sw,
      height: sh,
      dataUrl,
      pageTextSnippet: selectedFigure.pageTextSnippet || '',
      captionHint:
        cleanLegend ||
        selectedFigure.captionHint ||
        `Recorte rápido pág. ${selectedFigure.pageNumber} (${selectedFigure.pdfName})`,
      suggestedFilename: `${cleanBase}_p${selectedFigure.pageNumber}_recorte_${uid}.jpg`,
      kind: 'page_crop',
    };
  };

  const handleApplyInlineFigureCrop = (andAttach: boolean) => {
    const cropped = buildCroppedSelectedFigure();
    if (!cropped) {
      setStatusFeedback('Arraste um retângulo sobre a imagem antes de aplicar o recorte.');
      return;
    }
    onSaveCroppedPdfImage?.(cropped.pdfName, cropped);
    setSelectedFigure(cropped);
    setIsCroppingFigure(false);
    setFigureCropRect(null);
    if (andAttach && selectedCardId) {
      const result = toMedicalImageResult(cropped);
      const legend = customLegend.trim() || result.defaultLegend;
      onAttachImageToCard(selectedCardId, result, legend, attachMode);
      setStatusFeedback(
        `Recorte rápido da pág. ${cropped.pageNumber} salvo na galeria e anexado ao card ID ${selectedCardId}!`
      );
    } else {
      setStatusFeedback(`Recorte rápido da pág. ${cropped.pageNumber} salvo na Galeria da Apostila!`);
    }
  };

  const buildCroppedPdfImage = (): PdfExtractedImage | null => {
    const canvas = canvasRef.current;
    if (!canvas || !activeBrowsePdf) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const hasCrop = cropRect && cropRect.w >= 18 && cropRect.h >= 18;
    const sx = hasCrop ? Math.max(0, Math.round(cropRect!.x * scaleX)) : 0;
    const sy = hasCrop ? Math.max(0, Math.round(cropRect!.y * scaleY)) : 0;
    const sw = hasCrop
      ? Math.min(canvas.width - sx, Math.round(cropRect!.w * scaleX))
      : canvas.width;
    const sh = hasCrop
      ? Math.min(canvas.height - sy, Math.round(cropRect!.h * scaleY))
      : canvas.height;

    if (sw < 20 || sh < 20) return null;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = sw;
    outCanvas.height = sh;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return null;
    outCtx.fillStyle = '#ffffff';
    outCtx.fillRect(0, 0, sw, sh);
    outCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    const dataUrl = outCanvas.toDataURL('image/jpeg', 0.88);
    const cleanBase =
      activeBrowsePdf.name
        .replace(/\.pdf$/i, '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 24) || 'apostila';

    const uid = Math.random().toString(36).slice(2, 6);
    const cleanLegend = customLegend.trim().replace(/^Legenda visual:\s*/i, '');

    return {
      id: `crop_${cleanBase}_p${pageNumber}_${uid}`,
      pdfName: activeBrowsePdf.name,
      pageNumber,
      width: sw,
      height: sh,
      dataUrl,
      pageTextSnippet: pageTextSnippet || '',
      captionHint: cleanLegend || `Recorte manual pág. ${pageNumber} (${activeBrowsePdf.name})`,
      suggestedFilename: `${cleanBase}_p${pageNumber}_crop_${uid}.jpg`,
      kind: 'page_crop',
    };
  };

  const handleSaveCrop = (andAttach: boolean) => {
    const cropped = buildCroppedPdfImage();
    if (!cropped) {
      setStatusFeedback('Desenhe um retângulo na página (ou use a página inteira) antes de recortar.');
      return;
    }
    onSaveCroppedPdfImage?.(cropped.pdfName, cropped);
    if (andAttach && selectedCardId) {
      const result = toMedicalImageResult(cropped);
      const legend = customLegend.trim() || result.defaultLegend;
      onAttachImageToCard(selectedCardId, result, legend, attachMode);
      setStatusFeedback(
        `Recorte da pág. ${pageNumber} salvo na galeria e anexado ao card ID ${selectedCardId}!`
      );
    } else {
      setStatusFeedback(`Recorte da pág. ${pageNumber} salvo na Galeria da Apostila!`);
    }
    setCropRect(null);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Galeria da Apostila e Recorte Manual de PDF"
    >
      <div className="w-full max-w-6xl max-h-[92vh] bg-[#111827] text-slate-100 rounded-2xl border border-slate-700 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#0B0F17] border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-bold tracking-tight flex items-center gap-2 text-slate-100">
              <span>Galeria Completa da Apostila &amp; Recorte Manual</span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/20 text-sky-300 border border-sky-400/30">
                {allMaterialImages.length} figura(s) extraída(s)
              </span>
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Escolha qualquer figura extraída dos seus PDFs ou navegue página por página para recortar exatamente o diagrama, tabela ou exame desejado.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 cursor-pointer"
          >
            Fechar
          </button>
        </div>

        {/* Target Card & Mode Bar */}
        <div className="px-5 py-3 bg-[#0F1623] border-b border-slate-800 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Card Alvo para Anexar Figura ({cards.length} no deck)
                {pendingImageCardIds.length > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 normal-case">
                    {pendingImageCardIds.length} sem imagem
                  </span>
                )}
              </label>
              {pendingImageCardIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const currentIdx = selectedCardId
                      ? pendingImageCardIds.indexOf(selectedCardId)
                      : -1;
                    const nextPendingId =
                      pendingImageCardIds[(currentIdx + 1) % pendingImageCardIds.length];
                    setSelectedCardId(nextPendingId);
                    const nextCard = cards.find((c) => c.id === nextPendingId);
                    if (nextCard?.type === 'cloze') {
                      setAttachMode('feedback');
                    } else if (nextCard?.image_mode) {
                      setAttachMode(nextCard.image_mode);
                    }
                  }}
                  className="text-[10px] font-bold text-amber-300 hover:text-amber-200 underline cursor-pointer"
                >
                  Próx. pendente →
                </button>
              )}
            </div>
            <select
              value={selectedCardId ?? ''}
              onChange={(e) => {
                const nextId = e.target.value ? Number(e.target.value) : null;
                setSelectedCardId(nextId);
                const nextCard = cards.find((c) => c.id === nextId);
                if (nextCard?.type === 'cloze') {
                  setAttachMode('feedback');
                } else if (nextCard?.image_mode) {
                  setAttachMode(nextCard.image_mode);
                }
              }}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] text-xs text-slate-100"
            >
              {cards.length === 0 && <option value="">Nenhum card gerado ainda</option>}
              {cards.map((c, idx) => {
                const pending = cardNeedsImage(c);
                return (
                  <option key={c.id} value={c.id}>
                    {pending ? '● [PENDENTE] ' : ''}#{idx + 1} [ID {c.id}] ({c.topic}) — {stripHtmlShort(c.question, 56)}
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Posição no Card
            </span>
            <div className="inline-flex rounded-lg border border-slate-700 bg-[#0B0F17] p-0.5">
              <button
                type="button"
                disabled={selectedCard?.type === 'cloze'}
                title={
                  selectedCard?.type === 'cloze'
                    ? 'Cards Cloze aceitam imagem apenas no Verso (Feedback)'
                    : 'Coloca a imagem na frente do card (Recognition)'
                }
                onClick={() => setAttachMode('recognition')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                  attachMode === 'recognition'
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                Recognition (Frente)
              </button>
              <button
                type="button"
                onClick={() => setAttachMode('feedback')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                  attachMode === 'feedback'
                    ? 'bg-emerald-500 text-slate-950'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                Feedback (Verso)
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 pt-4">
            <button
              type="button"
              onClick={() => setActiveTab('extracted')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                activeTab === 'extracted'
                  ? 'bg-sky-500 text-slate-950 border-sky-400'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
              }`}
            >
              Figuras Extraídas ({allMaterialImages.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('browse')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                activeTab === 'browse'
                  ? 'bg-indigo-500 text-white border-indigo-400'
                  : 'bg-slate-800 text-indigo-300 border-slate-700 hover:bg-slate-700'
              }`}
            >
              Navegar Páginas &amp; Recortar ({viewablePdfs.length} PDF)
            </button>
          </div>
        </div>

        {statusFeedback && (
          <div className="px-5 py-2 bg-emerald-950/70 border-b border-emerald-800 text-xs font-medium text-emerald-200 flex items-center justify-between">
            <span>{statusFeedback}</span>
            <button
              type="button"
              onClick={() => setStatusFeedback('')}
              className="text-emerald-300 hover:text-white font-bold cursor-pointer"
            >
              OK
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-[#0B0F17]">
          {activeTab === 'extracted' ? (
            <div className="space-y-4">
              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2.5 bg-[#111827] p-3 rounded-xl border border-slate-800">
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Filtrar por legenda, tema, exame ou página (ex: Bishop, partograma, ECG)..."
                  className="flex-1 min-w-[220px] px-3 py-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] text-xs text-slate-100 placeholder:text-slate-500"
                />
                <select
                  value={pdfFilter}
                  onChange={(e) => setPdfFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-100 bg-[#0B0F17]"
                >
                  <option value="ALL">Todos os materiais ({pdfs.length})</option>
                  {pdfs.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} ({p.extractedImages?.length || 0})
                    </option>
                  ))}
                </select>
                <select
                  value={kindFilter}
                  onChange={(e) => setKindFilter(e.target.value as 'all' | 'embedded' | 'page_crop')}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-100 bg-[#0B0F17]"
                >
                  <option value="all">Todas ({allMaterialImages.length})</option>
                  <option value="embedded">Figuras Isoladas</option>
                  <option value="page_crop">Páginas / Recortes</option>
                </select>
              </div>

              {selectedFigure && (
                <div className="bg-[#111827] p-4 rounded-xl border-2 border-sky-500/70 shadow-sm space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-bold text-slate-100">
                      {selectedFigure.pdfName} · Página {selectedFigure.pageNumber} ({selectedFigure.width}×{selectedFigure.height}px)
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setIsCroppingFigure((prev) => !prev);
                          setFigureCropRect(null);
                        }}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border cursor-pointer ${
                          isCroppingFigure
                            ? 'bg-amber-500 text-slate-950 border-amber-400'
                            : 'bg-sky-950/80 text-sky-200 border-sky-700/70 hover:bg-sky-900/80'
                        }`}
                      >
                        {isCroppingFigure ? 'Cancelar Recorte Rápido' : '✂️ Recortar Figura'}
                      </button>
                      {viewablePdfs.some((p) => p.name === selectedFigure.pdfName) && (
                        <button
                          type="button"
                          onClick={() => {
                            setBrowsePdfName(selectedFigure.pdfName);
                            setPageNumber(selectedFigure.pageNumber);
                            setActiveTab('browse');
                          }}
                          className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-indigo-950/80 text-indigo-200 border border-indigo-700/70 hover:bg-indigo-900/80 cursor-pointer"
                        >
                          Abrir Pág. {selectedFigure.pageNumber}
                        </button>
                      )}
                    </div>
                  </div>

                  {isCroppingFigure ? (
                    <div className="space-y-3">
                      <p className="text-[11px] text-amber-200/90">
                        Arraste diretamente sobre a imagem abaixo para isolar apenas o exame clínico (removendo caixas de texto ou legendas coladas).
                      </p>
                      <div className="bg-slate-950 rounded-lg border border-slate-700 p-3 flex justify-center overflow-auto max-h-[46vh]">
                        <div
                          className="relative inline-block select-none cursor-crosshair touch-none"
                          onPointerDown={handleFigurePointerDown}
                          onPointerMove={handleFigurePointerMove}
                          onPointerUp={handleFigurePointerUp}
                          onPointerCancel={handleFigurePointerUp}
                        >
                          <img
                            ref={figureImgRef}
                            src={selectedFigure.dataUrl}
                            alt={selectedFigure.captionHint || selectedFigure.pdfName}
                            draggable={false}
                            className="block max-w-full max-h-[42vh] object-contain pointer-events-none"
                          />
                          {figureCropRect && figureCropRect.w > 4 && figureCropRect.h > 4 && (
                            <div
                              className="absolute border-2 border-emerald-400 bg-emerald-400/20 pointer-events-none"
                              style={{
                                left: `${figureCropRect.x}px`,
                                top: `${figureCropRect.y}px`,
                                width: `${figureCropRect.w}px`,
                                height: `${figureCropRect.h}px`,
                              }}
                            >
                              <span className="absolute -top-5 left-0 px-1.5 py-0.5 rounded bg-emerald-500 text-slate-950 text-[10px] font-bold whitespace-nowrap">
                                {Math.round(figureCropRect.w)}×{Math.round(figureCropRect.h)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <input
                        type="text"
                        value={customLegend}
                        onChange={(e) => setCustomLegend(e.target.value)}
                        placeholder="Legenda clínica descritiva para o recorte (obrigatória no card)..."
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] text-xs text-slate-100 placeholder:text-slate-500"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={!selectedCard || !figureCropRect || figureCropRect.w < 14}
                          onClick={() => handleApplyInlineFigureCrop(true)}
                          className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 text-xs font-bold cursor-pointer"
                        >
                          Recortar &amp; Anexar ao Card {selectedCard ? `ID ${selectedCard.id}` : ''}
                        </button>
                        <button
                          type="button"
                          disabled={!figureCropRect || figureCropRect.w < 14}
                          onClick={() => handleApplyInlineFigureCrop(false)}
                          className="px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
                        >
                          Salvar Recorte na Galeria
                        </button>
                        {figureCropRect && (
                          <button
                            type="button"
                            onClick={() => setFigureCropRect(null)}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
                          >
                            Limpar Seleção
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col md:flex-row gap-4 items-start">
                      <img
                        src={selectedFigure.dataUrl}
                        alt={selectedFigure.captionHint || selectedFigure.pdfName}
                        className="w-full md:w-64 max-h-52 object-contain rounded-lg border border-slate-700 bg-slate-950"
                      />
                      <div className="flex-1 space-y-2.5 w-full">
                        <input
                          type="text"
                          value={customLegend}
                          onChange={(e) => setCustomLegend(e.target.value)}
                          placeholder="Legenda clínica descritiva (obrigatória no card)..."
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] text-xs text-slate-100 placeholder:text-slate-500"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={!selectedCard}
                            onClick={() => handleAttachSelectedFigure(selectedFigure)}
                            className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 text-xs font-bold cursor-pointer"
                          >
                            Anexar ao Card {selectedCard ? `ID ${selectedCard.id}` : ''}
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedFigure(null)}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium cursor-pointer"
                          >
                            Limpar Prévia
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {filteredImages.length === 0 ? (
                <div className="bg-[#111827] rounded-xl border border-dashed border-slate-700 p-8 text-center">
                  <p className="text-sm font-semibold text-slate-200">
                    Nenhuma figura extraída corresponde ao filtro atual.
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Você pode ir para a aba <strong>Navegar Páginas &amp; Recortar</strong> para extrair qualquer área manualmente de seus PDFs.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {filteredImages.map((img) => {
                    const usageIds = getUsageCardIds(img);
                    const usedElsewhere = usageIds.some((id) => id !== selectedCardId);
                    const usedHere = selectedCardId ? usageIds.includes(selectedCardId) : false;
                    const isPicked = selectedFigure?.id === img.id;
                    return (
                      <div
                        key={img.id}
                        className={`group rounded-xl border bg-[#111827] p-2 flex flex-col gap-1.5 transition ${
                          isPicked
                            ? 'border-sky-400 ring-2 ring-sky-500/30'
                            : usedElsewhere
                              ? 'border-amber-600/80 bg-amber-950/20'
                              : 'border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFigure(img);
                            setCustomLegend(
                              img.captionHint
                                ? `Legenda visual: ${img.captionHint.slice(0, 140)}.`
                                : `Legenda visual: figura de ${img.pdfName}, pág. ${img.pageNumber}.`
                            );
                          }}
                          className="relative w-full h-32 rounded-lg overflow-hidden bg-slate-950 flex items-center justify-center cursor-pointer"
                        >
                          <img
                            src={img.dataUrl}
                            alt={img.captionHint || img.pdfName}
                            className="max-w-full max-h-full object-contain"
                          />
                          {usedElsewhere && (
                            <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px] font-bold shadow">
                              Em uso · ID {usageIds.filter((id) => id !== selectedCardId)[0]}
                            </span>
                          )}
                          {usedHere && (
                            <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-emerald-500 text-slate-950 text-[10px] font-bold shadow">
                              Neste card
                            </span>
                          )}
                          <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-slate-900/90 text-slate-200 text-[10px] font-semibold border border-slate-700">
                            Pág. {img.pageNumber} · {img.kind === 'page_crop' ? 'Recorte' : 'Figura'}
                          </span>
                        </button>
                        <div className="text-[11px] font-medium text-slate-300 line-clamp-2 min-h-[2rem]">
                          {img.captionHint || img.pageTextSnippet || img.pdfName}
                        </div>
                        <div className="flex items-center gap-1 mt-auto pt-1">
                          <button
                            type="button"
                            disabled={!selectedCard}
                            onClick={() => {
                              const legend =
                                isPicked && customLegend.trim()
                                  ? customLegend.trim()
                                  : img.captionHint
                                    ? `Legenda visual: ${img.captionHint.slice(0, 140)}.`
                                    : `Legenda visual: figura de ${img.pdfName}, pág. ${img.pageNumber}.`;
                              handleAttachSelectedFigure(img, legend);
                            }}
                            className="flex-1 px-2 py-1 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 text-[11px] font-bold cursor-pointer"
                          >
                            Anexar
                          </button>
                          {viewablePdfs.some((p) => p.name === img.pdfName) && (
                            <button
                              type="button"
                              onClick={() => {
                                setBrowsePdfName(img.pdfName);
                                setPageNumber(img.pageNumber);
                                setActiveTab('browse');
                              }}
                              className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold cursor-pointer"
                              title="Abrir esta página no visualizador para recortar outro detalhe"
                            >
                              Pág.
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {viewablePdfs.length === 0 ? (
                <div className="bg-[#111827] rounded-xl border border-dashed border-slate-700 p-8 text-center">
                  <p className="text-sm font-semibold text-slate-200">
                    Nenhum PDF carregado na memória nesta sessão.
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Anexe uma apostila ou diretriz em PDF na seção de Entrada para navegar página por página e recortar imagens.
                  </p>
                </div>
              ) : (
                <>
                  {/* PDF Navigation Toolbar */}
                  <div className="bg-[#111827] p-3 rounded-xl border border-slate-800 flex flex-wrap items-center gap-3">
                    <select
                      value={activeBrowsePdf?.name || ''}
                      onChange={(e) => {
                        setBrowsePdfName(e.target.value);
                        setPageNumber(1);
                      }}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs font-medium text-slate-100 bg-[#0B0F17] max-w-xs"
                    >
                      {viewablePdfs.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={pageNumber <= 1 || renderingPage}
                        onClick={() => setPageNumber((n) => Math.max(1, n - 1))}
                        className="px-2.5 py-1 rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-semibold text-slate-200 cursor-pointer"
                      >
                        ◀ Anterior
                      </button>
                      <div className="flex items-center gap-1 text-xs text-slate-300">
                        <span>Pág.</span>
                        <input
                          type="number"
                          min={1}
                          max={totalPages}
                          value={pageNumber}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!Number.isNaN(val)) {
                              setPageNumber(Math.max(1, Math.min(totalPages, val)));
                            }
                          }}
                          className="w-16 px-2 py-1 rounded border border-slate-700 bg-[#0B0F17] text-center text-xs text-slate-100"
                        />
                        <span className="text-slate-400">/ {totalPages}</span>
                      </div>
                      <button
                        type="button"
                        disabled={pageNumber >= totalPages || renderingPage}
                        onClick={() => setPageNumber((n) => Math.min(totalPages, n + 1))}
                        className="px-2.5 py-1 rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-semibold text-slate-200 cursor-pointer"
                      >
                        Próxima ▶
                      </button>
                    </div>

                    <div className="flex items-center gap-1 ml-auto">
                      <span className="text-[11px] text-slate-400">Zoom:</span>
                      {[1.1, 1.4, 1.8].map((z) => (
                        <button
                          key={z}
                          type="button"
                          onClick={() => setZoomScale(z)}
                          className={`px-2 py-1 rounded text-[11px] font-semibold border cursor-pointer ${
                            zoomScale === z
                              ? 'bg-sky-500 text-slate-950 border-sky-400'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                        >
                          {z}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Crop Legend & Action Bar */}
                  <div className="bg-[#111827] p-3 rounded-xl border border-indigo-700/60 flex flex-wrap items-center gap-2.5">
                    <input
                      type="text"
                      value={customLegend}
                      onChange={(e) => setCustomLegend(e.target.value)}
                      placeholder="Legenda para este recorte (ex: Partograma mostrando parada secundária da dilatação)..."
                      className="flex-1 min-w-[240px] px-3 py-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] text-xs text-slate-100 placeholder:text-slate-500"
                    />
                    {cropRect && (
                      <button
                        type="button"
                        onClick={() => setCropRect(null)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer"
                      >
                        Limpar Seleção
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSaveCrop(false)}
                      className="px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold cursor-pointer"
                    >
                      {cropRect && cropRect.w >= 18 ? 'Recortar & Salvar na Galeria' : 'Salvar Página na Galeria'}
                    </button>
                    <button
                      type="button"
                      disabled={!selectedCard}
                      onClick={() => handleSaveCrop(true)}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 text-xs font-bold cursor-pointer"
                    >
                      {cropRect && cropRect.w >= 18
                        ? `Recortar & Anexar ao Card${selectedCard ? ` ${selectedCard.id}` : ''}`
                        : `Anexar Página ao Card${selectedCard ? ` ${selectedCard.id}` : ''}`}
                    </button>
                  </div>

                  {/* Interactive Canvas + Drag Box */}
                  <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 flex flex-col items-center overflow-auto max-h-[56vh]">
                    <p className="text-[11px] text-slate-400 mb-2">
                      Arraste com o mouse sobre o diagrama, partograma, tabela ou imagem médica para selecionar a área exata do recorte.
                    </p>
                    {pageError ? (
                      <div className="p-6 bg-red-950/60 border border-red-400/40 rounded-lg text-xs text-red-200">
                        {pageError}
                      </div>
                    ) : (
                      <div
                        className="relative inline-block select-none cursor-crosshair touch-none shadow-xl bg-white"
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                      >
                        <canvas ref={canvasRef} className="block max-w-full h-auto" />
                        {renderingPage && (
                          <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center text-white text-xs font-semibold">
                            Renderizando página {pageNumber}…
                          </div>
                        )}
                        {cropRect && cropRect.w > 4 && cropRect.h > 4 && (
                          <div
                            className="absolute border-2 border-emerald-400 bg-emerald-400/15 pointer-events-none"
                            style={{
                              left: `${cropRect.x}px`,
                              top: `${cropRect.y}px`,
                              width: `${cropRect.w}px`,
                              height: `${cropRect.h}px`,
                            }}
                          >
                            <span className="absolute -top-5 left-0 px-1.5 py-0.5 rounded bg-emerald-500 text-slate-950 text-[10px] font-bold whitespace-nowrap">
                              {Math.round(cropRect.w)}×{Math.round(cropRect.h)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
