import React, { useRef, useState } from 'react';
import {
  FileText,
  Upload,
  Trash2,
  Sparkles,
  FileJson,
  ChevronDown,
  ChevronUp,
  Layers,
  Image as ImageIcon,
  Database,
  Download,
} from 'lucide-react';
import { ExtractedDeckMetadata, LocalMediaAsset, UploadedPdfFile } from '../types/deck';

interface InputPanelProps {
  pdfs: UploadedPdfFile[];
  onAddPdfs: (files: UploadedPdfFile[]) => void;
  onRemovePdf: (index: number) => void;
  rawJsonText: string;
  onRawJsonChange: (text: string) => void;
  jsonError: string | null;
  extractedMeta: ExtractedDeckMetadata;
  deckKey: string;
  onDeckKeyChange: (val: string) => void;
  useGoogleSearch: boolean;
  onToggleGoogleSearch: (val: boolean) => void;
  onGenerateClinicalMap: () => void;
  onRecreateCanonicalDeck: () => void;
  onLoadGenericSample: () => void;
  isGeneratingMap: boolean;
  isGeneratingDeck: boolean;
  localMediaAssets: Record<string, LocalMediaAsset>;
  onAddLocalMediaFiles: (assets: LocalMediaAsset[]) => void;
  onClearLocalMedia: () => void;
  guidCount: number;
  onImportGuidRegistry: (jsonText: string) => void;
  onExportGuidRegistry: () => void;
}

export const InputPanel: React.FC<InputPanelProps> = ({
  pdfs,
  onAddPdfs,
  onRemovePdf,
  rawJsonText,
  onRawJsonChange,
  jsonError,
  extractedMeta,
  deckKey,
  onDeckKeyChange,
  useGoogleSearch,
  onToggleGoogleSearch,
  onGenerateClinicalMap,
  onRecreateCanonicalDeck,
  onLoadGenericSample,
  isGeneratingMap,
  isGeneratingDeck,
  localMediaAssets,
  onAddLocalMediaFiles,
  onClearLocalMedia,
  guidCount,
  onImportGuidRegistry,
  onExportGuidRegistry,
}) => {
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);
  const mediaFilesInputRef = useRef<HTMLInputElement>(null);
  const guidFileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingPdf, setIsDraggingPdf] = useState(false);
  const [isDraggingMedia, setIsDraggingMedia] = useState(false);
  const [showJsonEditor, setShowJsonEditor] = useState(false);

  const loadedMediaList = Object.values(localMediaAssets);

  const handlePdfFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const processed: UploadedPdfFile[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const res = typeof reader.result === 'string' ? reader.result : '';
            const base64 = res.includes(',') ? res.split(',')[1] : res;
            resolve(base64);
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        processed.push({
          name: file.name,
          size: file.size,
          mimeType: 'application/pdf',
          base64Data,
        });
      }
    }
    if (processed.length > 0) {
      onAddPdfs(processed);
      if (!deckKey.trim()) {
        const inferred = processed[0].name
          .replace(/\.pdf$/i, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '');
        if (inferred) onDeckKeyChange(inferred);
      }
    }
  };

  const handleLocalMediaFileUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const assets: LocalMediaAsset[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const lower = file.name.toLowerCase();
      if (
        lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.jpeg') ||
        lower.endsWith('.webp') ||
        lower.endsWith('.svg') ||
        lower.endsWith('.gif') ||
        lower.endsWith('.mp3') ||
        lower.endsWith('.wav') ||
        lower.endsWith('.ogg') ||
        file.type.startsWith('image/') ||
        file.type.startsWith('audio/')
      ) {
        const dataUri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        if (dataUri) {
          assets.push({
            filename: file.name.trim(),
            mimeType: file.type || (lower.endsWith('.mp3') ? 'audio/mpeg' : 'image/png'),
            dataUri,
            size: file.size,
          });
        }
      }
    }

    if (assets.length > 0) {
      onAddLocalMediaFiles(assets);
    }
  };

  const handleJsonFileUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    const text = await file.text();
    onRawJsonChange(text);
    setShowJsonEditor(true);
  };

  const handleGuidFileUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    const text = await file.text();
    onImportGuidRegistry(text);
  };

  return (
    <section
      id="painel-entrada"
      className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-5"
    >
      {/* Clean Minimal Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-base font-bold text-slate-100 font-display">
            1. Entrada de Materiais, Mídias Locais & Tema
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Crie ou recrie baralhos de qualquer especialidade médica a partir de PDFs, JSON atual e mídias locais (<code className="font-mono text-slate-300">04_Mídias/</code>).
          </p>
        </div>

        <button
          type="button"
          onClick={onLoadGenericSample}
          className="text-xs font-medium text-sky-400 hover:text-sky-300 underline underline-offset-4 whitespace-nowrap shrink-0 cursor-pointer"
        >
          Carregar exemplo de teste
        </button>
      </div>

      {/* Row 1: Deck Key + Google Search Toggle */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
        <div className="md:col-span-7">
          <label
            htmlFor="deck-key-input"
            className="block text-xs font-medium text-slate-300 mb-1.5"
          >
            Tema ou Deck Key (`*_notes.json`)
          </label>
          <input
            id="deck-key-input"
            type="text"
            value={deckKey}
            onChange={(e) => onDeckKeyChange(e.target.value)}
            placeholder="Digite qualquer tema (ex.: insuficiencia_cardiaca, assistencia_ao_parto, trauma_abdominal)"
            className="w-full px-3.5 py-2 text-sm bg-[#0B0F17] border border-slate-700/90 rounded-lg text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none transition-colors"
          />
        </div>

        <div className="md:col-span-5">
          <label
            htmlFor="google-search-toggle"
            className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-lg border border-slate-700/90 bg-[#0B0F17] cursor-pointer select-none"
          >
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-200 truncate">
                Complementar com Google Search
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                Diretrizes MS, Sociedades Brasileiras e Internacionais
              </div>
            </div>
            <input
              id="google-search-toggle"
              type="checkbox"
              checked={useGoogleSearch}
              onChange={(e) => onToggleGoogleSearch(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-sky-400 focus:ring-sky-400 shrink-0 cursor-pointer"
            />
          </label>
        </div>
      </div>

      {/* Row 2: Two side-by-side dropzones: PDFs + Local Media Assets (04_Mídias/) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* PDF Dropzone */}
        <div>
          <input
            ref={pdfInputRef}
            id="pdf-file-upload"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(e) => handlePdfFiles(e.target.files)}
            className="sr-only"
          />

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingPdf(true);
            }}
            onDragLeave={() => setIsDraggingPdf(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingPdf(false);
              handlePdfFiles(e.dataTransfer.files);
            }}
            onClick={() => pdfInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                pdfInputRef.current?.click();
              }
            }}
            className={`flex items-center justify-between gap-3 px-4 py-3.5 border border-dashed rounded-lg transition-colors cursor-pointer ${
              isDraggingPdf
                ? 'border-sky-400 bg-slate-900/90'
                : 'border-slate-700 hover:border-slate-600 bg-[#0B0F17]/70'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Upload className="w-4 h-4 text-slate-400 shrink-0" />
              <div className="text-left min-w-0">
                <p className="text-xs font-medium text-slate-200 truncate">
                  Apostilas / Diretrizes em PDF
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  Arraste PDFs ou clique para enviar (inlineData)
                </p>
              </div>
            </div>

            <span className="px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-md whitespace-nowrap shrink-0">
              {pdfs.length > 0 ? `${pdfs.length} PDF(s)` : 'Escolher PDFs'}
            </span>
          </div>

          {pdfs.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-800 border border-slate-800 rounded-lg bg-[#0B0F17] max-h-28 overflow-y-auto">
              {pdfs.map((pdf, index) => (
                <li
                  key={`${pdf.name}-${index}`}
                  className="flex items-center justify-between px-3 py-1.5 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-mono text-slate-200 truncate">{pdf.name}</span>
                    <span className="text-slate-500 tabular-nums shrink-0">
                      ({(pdf.size / 1024).toFixed(0)} KB)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemovePdf(index)}
                    aria-label={`Remover ${pdf.name}`}
                    className="p-1 text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Local Media Assets Dropzone (04_Mídias / .png, .jpg, .webp, .svg, .mp3) */}
        <div>
          <input
            ref={mediaFilesInputRef}
            id="local-media-upload"
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.svg,.gif,.mp3,.wav,.ogg,image/*,audio/*"
            multiple
            onChange={(e) => handleLocalMediaFileUpload(e.target.files)}
            className="sr-only"
          />

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingMedia(true);
            }}
            onDragLeave={() => setIsDraggingMedia(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingMedia(false);
              handleLocalMediaFileUpload(e.dataTransfer.files);
            }}
            onClick={() => mediaFilesInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                mediaFilesInputRef.current?.click();
              }
            }}
            className={`flex items-center justify-between gap-3 px-4 py-3.5 border border-dashed rounded-lg transition-colors cursor-pointer ${
              isDraggingMedia
                ? 'border-emerald-400 bg-slate-900/90'
                : 'border-slate-700 hover:border-slate-600 bg-[#0B0F17]/70'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="text-left min-w-0">
                <p className="text-xs font-medium text-slate-200 truncate">
                  Mídias Locais (<code className="font-mono text-emerald-300">04_Mídias/</code>)
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  Envie .png, .jpg, .webp, .svg ou .mp3 para embutir no .apkg/.zip
                </p>
              </div>
            </div>

            <span className="px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-md whitespace-nowrap shrink-0">
              {loadedMediaList.length > 0
                ? `${loadedMediaList.length} arquivo(s)`
                : 'Enviar Mídias'}
            </span>
          </div>

          {loadedMediaList.length > 0 && (
            <div className="mt-2 px-3 py-1.5 border border-slate-800 rounded-lg bg-[#0B0F17] flex items-center justify-between gap-2 text-xs">
              <span className="font-mono text-emerald-300 truncate">
                {loadedMediaList.length} mídia(s) pronta(s):{' '}
                {loadedMediaList
                  .slice(0, 3)
                  .map((m) => m.filename)
                  .join(', ')}
                {loadedMediaList.length > 3 ? '...' : ''}
              </span>
              <button
                type="button"
                onClick={onClearLocalMedia}
                className="text-slate-400 hover:text-red-400 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Limpar mídias
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Compact / Collapsible Optional JSON Deck Upload + GUID FSRS Registry */}
      <div className="border border-slate-800 rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-[#0B0F17]/90">
          <button
            type="button"
            onClick={() => setShowJsonEditor((prev) => !prev)}
            className="flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-slate-100 cursor-pointer"
          >
            {showJsonEditor ? (
              <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span>JSON Atual do Deck & Registro FSRS (`note_guid_registry.json`)</span>
          </button>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <span className="text-slate-400 tabular-nums">
              {extractedMeta.existingIds.length} IDs · {extractedMeta.mediaTags.length} refs de mídia ·{' '}
              <strong className="text-emerald-400">{guidCount}</strong> GUIDs FSRS salvos
            </span>

            <input
              ref={jsonFileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => handleJsonFileUpload(e.target.files)}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => jsonFileInputRef.current?.click()}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileJson className="w-3 h-3" />
              <span>Importar *_notes.json</span>
            </button>

            <input
              ref={guidFileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => handleGuidFileUpload(e.target.files)}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => guidFileInputRef.current?.click()}
              title="Importar arquivo note_guid_registry.json existente do desktop"
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-700 rounded hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Database className="w-3 h-3 text-emerald-400" />
              <span>Importar GUIDs</span>
            </button>

            <button
              type="button"
              onClick={onExportGuidRegistry}
              title="Baixar note_guid_registry.json atualizado"
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-700 rounded hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3 h-3 text-sky-400" />
              <span>Baixar GUIDs</span>
            </button>

            {rawJsonText && (
              <button
                type="button"
                onClick={() => onRawJsonChange('')}
                className="text-xs text-slate-400 hover:text-red-400 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Limpar JSON
              </button>
            )}
          </div>
        </div>

        {showJsonEditor && (
          <div className="p-4 border-t border-slate-800 space-y-2 bg-[#0F1623]">
            <textarea
              id="current-deck-json"
              rows={6}
              value={rawJsonText}
              onChange={(e) => onRawJsonChange(e.target.value)}
              placeholder='Cole aqui o conteúdo do arquivo *_notes.json para preservar os "id" numéricos FSRS...'
              className="w-full p-3 text-xs font-mono bg-[#0B0F17] text-slate-200 border border-slate-700 rounded-lg focus:border-sky-400 focus:outline-none leading-relaxed"
            />
            {jsonError && <p className="text-xs text-red-400">{jsonError}</p>}
            {extractedMeta.existingIds.length > 0 && (
              <p className="text-[11px] font-mono text-slate-400 truncate">
                IDs extraídos: {extractedMeta.existingIds.join(', ')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Row 4: Clean 2-Step Action Bar */}
      <div className="pt-1 flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={onGenerateClinicalMap}
          disabled={isGeneratingMap || isGeneratingDeck}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-100 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Layers className="w-3.5 h-3.5 text-sky-400" />
          <span>
            {isGeneratingMap
              ? 'Gerando Mapa Clínico...'
              : 'Passo 1: Gerar Mapa Clínico (P1 a P4) + Diretrizes'}
          </span>
        </button>

        <button
          type="button"
          onClick={onRecreateCanonicalDeck}
          disabled={isGeneratingMap || isGeneratingDeck}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-400 rounded-lg hover:bg-sky-300 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>
            {isGeneratingDeck
              ? 'Recriando Deck JSON...'
              : 'Passo 2: Recriar Deck JSON Canônico'}
          </span>
        </button>
      </div>
    </section>
  );
};
