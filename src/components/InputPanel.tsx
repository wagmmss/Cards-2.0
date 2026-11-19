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
  Database,
  Download,
  Plus,
  Image as ImageIcon,
} from 'lucide-react';
import {
  DomainProfile,
  ExtractedDeckMetadata,
  GeminiModelOption,
  UploadedPdfFile,
} from '../types/deck';
import { DOMAIN_PROFILE_CONFIGS, DOMAIN_PROFILE_ORDER } from '../utils/domainProfiles';
import { readMultipleDocumentFiles } from '../utils/documentUpload';

const GEMINI_MODEL_OPTIONS: Array<{ value: GeminiModelOption; label: string }> = [
  { value: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (Padrão)' },
  { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Rápido)' },
  { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite (Eco)' },
];

interface InputPanelProps {
  pdfs: UploadedPdfFile[];
  onAddPdfs: (files: UploadedPdfFile[]) => void;
  onRemovePdf: (index: number) => void;
  onClearPdfs: () => void;
  extractedImagesCount?: number;
  onOpenPdfGallery?: (tab?: 'extracted' | 'browse') => void;
  localMediaAssets?: Record<string, string>;
  onAddLocalMedia?: (assets: Record<string, string>) => void;
  onClearLocalMedia?: () => void;
  rawJsonText: string;
  onRawJsonChange: (text: string) => void;
  jsonError: string | null;
  extractedMeta: ExtractedDeckMetadata;
  deckKey: string;
  onDeckKeyChange: (val: string) => void;
  selectedProfile: 'auto' | DomainProfile;
  onProfileChange: (val: 'auto' | DomainProfile) => void;
  selectedModel: GeminiModelOption;
  onModelChange: (val: GeminiModelOption) => void;
  useGoogleSearch: boolean;
  onToggleGoogleSearch: (val: boolean) => void;
  onGenerateClinicalMap: () => void;
  onAuditExistingDeck?: () => void;
  onRecreateCanonicalDeck: () => void;
  onRunFullPipeline?: () => void;
  onLoadGenericSample: () => void;
  hasExistingCards?: boolean;
  isGeneratingMap: boolean;
  isAuditingDeck?: boolean;
  isGeneratingDeck: boolean;
  isRunningFullPipeline?: boolean;
  guidCount: number;
  onImportGuidRegistry: (jsonText: string) => void;
  onExportGuidRegistry: () => void;
}

export const InputPanel: React.FC<InputPanelProps> = ({
  pdfs,
  onAddPdfs,
  onRemovePdf,
  onClearPdfs,
  extractedImagesCount = 0,
  onOpenPdfGallery,
  localMediaAssets = {},
  onAddLocalMedia,
  onClearLocalMedia,
  rawJsonText,
  onRawJsonChange,
  jsonError,
  extractedMeta,
  deckKey,
  onDeckKeyChange,
  selectedProfile,
  onProfileChange,
  selectedModel,
  onModelChange,
  useGoogleSearch,
  onToggleGoogleSearch,
  onGenerateClinicalMap,
  onAuditExistingDeck,
  onRecreateCanonicalDeck,
  onRunFullPipeline,
  onLoadGenericSample,
  hasExistingCards = false,
  isGeneratingMap,
  isAuditingDeck = false,
  isGeneratingDeck,
  isRunningFullPipeline = false,
  guidCount,
  onImportGuidRegistry,
  onExportGuidRegistry,
}) => {
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);
  const guidFileInputRef = useRef<HTMLInputElement>(null);
  const localMediaInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingPdf, setIsDraggingPdf] = useState(false);
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [confirmClearAction, setConfirmClearAction] = useState<
    null | 'pdfs' | 'localMedia' | 'json'
  >(null);

  const localMediaCount = Object.keys(localMediaAssets).length;

  const handleDocumentFiles = async (fileList: File[] | FileList | null) => {
    const processed = await readMultipleDocumentFiles(fileList);

    if (processed.length > 0) {
      onAddPdfs(processed);
      if (!deckKey.trim()) {
        const inferred = processed[0].name
          .replace(/\.(?:pdf|txt|md)$/i, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '');
        if (inferred) onDeckKeyChange(inferred);
      }
    }
  };

  const handleLocalMediaUpload = async (fileList: File[] | FileList | null) => {
    if (!fileList || fileList.length === 0 || !onAddLocalMedia) return;
    const loaded: Record<string, string> = {};
    for (const file of Array.from(fileList)) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });
      if (dataUrl) {
        loaded[file.name] = dataUrl;
      }
    }
    if (Object.keys(loaded).length > 0) {
      onAddLocalMedia(loaded);
    }
  };

  const handleJsonFileUpload = async (fileList: File[] | FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    const text = await file.text();
    onRawJsonChange(text);
    setShowJsonEditor(true);
  };

  const handleGuidFileUpload = async (fileList: File[] | FileList | null) => {
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
            1. Entrada de Múltiplos Documentos & Tema
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Anexe simultaneamente múltiplos PDFs/documentos (Diretrizes + Resumos + Questões) e/ou o JSON atual. Imagens ausentes são buscadas automaticamente no Google/Web.
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

      {/* Row 1: Deck Key + Domain Profile + Model Selector + Google Search Toggle */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
        <div className="md:col-span-3">
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
            placeholder="Ex.: etica_medica, abdome_agudo"
            className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-slate-700/90 rounded-lg text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none transition-colors"
          />
        </div>

        <div className="md:col-span-3">
          <label
            htmlFor="domain-profile-select"
            className="block text-xs font-medium text-slate-300 mb-1.5"
          >
            Perfil P1–P4
          </label>
          <select
            id="domain-profile-select"
            value={selectedProfile}
            onChange={(e) => onProfileChange(e.target.value as 'auto' | DomainProfile)}
            className="w-full px-2.5 py-2 text-sm bg-[#0B0F17] border border-slate-700/90 rounded-lg text-slate-100 focus:border-sky-400 focus:outline-none transition-colors cursor-pointer"
          >
            <option value="auto">Automático (por tema)</option>
            {DOMAIN_PROFILE_ORDER.map((prof) => (
              <option key={prof} value={prof}>
                {DOMAIN_PROFILE_CONFIGS[prof].label}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-3">
          <label
            htmlFor="gemini-model-select"
            className="block text-xs font-medium text-slate-300 mb-1.5"
          >
            Modelo IA
          </label>
          <select
            id="gemini-model-select"
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value as GeminiModelOption)}
            className="w-full px-2.5 py-2 text-sm bg-[#0B0F17] border border-slate-700/90 rounded-lg text-slate-100 focus:border-sky-400 focus:outline-none transition-colors cursor-pointer"
          >
            {GEMINI_MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-3">
          <label
            htmlFor="google-search-toggle"
            className="flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-lg border border-slate-700/90 bg-[#0B0F17] cursor-pointer select-none min-h-[38px]"
          >
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-200 truncate">
                Google Search + Web
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                Diretrizes + Wikimedia/LITFL
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

      {/* Row 2: Multi-Document Dropzone (Diretriz + Resumo + Questões) */}
      <div>
        <input
          ref={pdfInputRef}
          id="pdf-file-upload"
          type="file"
          accept="application/pdf,.pdf,.txt,.md,text/plain,text/markdown"
          multiple
          onChange={(e) => {
            const selectedFiles = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = '';
            void handleDocumentFiles(selectedFiles);
          }}
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
            e.stopPropagation();
            setIsDraggingPdf(false);
            const droppedFiles = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
            void handleDocumentFiles(droppedFiles);
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
          className={`flex flex-col sm:flex-row items-center justify-between gap-4 px-5 py-4 border border-dashed rounded-lg transition-colors cursor-pointer ${
            isDraggingPdf
              ? 'border-sky-400 bg-slate-900/90'
              : 'border-slate-700 hover:border-slate-600 bg-[#0B0F17]/70'
          }`}
        >
          <div className="flex items-center gap-3">
            <Upload className="w-4 h-4 text-sky-400 shrink-0" />
            <div className="text-left">
              <p className="text-xs font-medium text-slate-200">
                Anexe múltiplos documentos simultaneamente (Diretrizes + Resumo + Questões)
              </p>
              <p className="text-[11px] text-slate-400">
                Arraste vários arquivos <code className="font-mono text-slate-300">.pdf</code>,{' '}
                <code className="font-mono text-slate-300">.txt</code> ou{' '}
                <code className="font-mono text-slate-300">.md</code> de uma vez ou adicione em etapas
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-md whitespace-nowrap shrink-0">
            <Plus className="w-3.5 h-3.5 text-sky-400" />
            <span>
              {pdfs.length > 0
                ? `${pdfs.length} documento(s) anexado(s) — Adicionar mais`
                : 'Selecionar Múltiplos Arquivos'}
            </span>
          </span>
        </div>

        {pdfs.length > 0 && (
          <div className="mt-2 border border-slate-800 rounded-lg bg-[#0B0F17] overflow-hidden">
            <div className="px-3.5 py-1.5 bg-slate-900/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>
                <strong className="text-slate-200">{pdfs.length}</strong> documento(s) ·{' '}
                <strong className="text-sky-300">{extractedImagesCount}</strong> figura(s) extraída(s)
              </span>
              <div className="flex items-center gap-3">
                {onOpenPdfGallery && (
                  <button
                    type="button"
                    onClick={() => onOpenPdfGallery('extracted')}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-700/70 text-indigo-200 hover:bg-indigo-900/80 font-medium cursor-pointer"
                  >
                    <ImageIcon className="w-3 h-3" />
                    <span>Galeria da Apostila &amp; Recortar ({extractedImagesCount})</span>
                  </button>
                )}
                {confirmClearAction === 'pdfs' ? (
                  <span className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmClearAction(null);
                        onClearPdfs();
                      }}
                      className="px-2 py-0.5 rounded bg-red-900/90 border border-red-600 text-red-100 hover:bg-red-800 font-semibold cursor-pointer"
                    >
                      Confirmar remover PDFs
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClearAction(null)}
                      className="text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClearAction('pdfs')}
                    className="text-slate-400 hover:text-red-400 cursor-pointer"
                  >
                    Remover todos
                  </button>
                )}
              </div>
            </div>
            <ul className="divide-y divide-slate-800 max-h-40 overflow-y-auto">
              {pdfs.map((pdf, index) => (
                <li
                  key={`${pdf.name}-${index}`}
                  className="flex items-center justify-between px-3.5 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span className="font-mono text-slate-200 truncate">{pdf.name}</span>
                    <span className="text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-sky-300/90 text-[11px] shrink-0 capitalize">
                      {pdf.docRole || 'documento'}
                    </span>
                    <span className="text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-400 tabular-nums shrink-0">
                      {Math.max(1, Math.round(pdf.size / 1024))} KB
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
          </div>
        )}
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
              {extractedMeta.existingIds.length} IDs ·{' '}
              <strong className="text-emerald-400">{guidCount}</strong> GUIDs FSRS salvos
            </span>

            <input
              ref={jsonFileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const selectedFiles = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = '';
                void handleJsonFileUpload(selectedFiles);
              }}
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
              onChange={(e) => {
                const selectedFiles = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = '';
                void handleGuidFileUpload(selectedFiles);
              }}
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

            <input
              ref={localMediaInputRef}
              type="file"
              accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.svg,.mp3,.wav,.ogg,audio/*"
              multiple
              onChange={(e) => {
                const selectedFiles = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = '';
                void handleLocalMediaUpload(selectedFiles);
              }}
              className="sr-only"
            />
            {onAddLocalMedia && (
              <button
                type="button"
                onClick={() => localMediaInputRef.current?.click()}
                title="Carregar arquivos locais de imagem ou áudio (collection.media) referenciados no *_notes.json"
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ImageIcon className="w-3 h-3 text-indigo-400" />
                <span>
                  {localMediaCount > 0 ? `Mídias Locais (${localMediaCount})` : '+ Mídias Locais'}
                </span>
              </button>
            )}
            {localMediaCount > 0 && onClearLocalMedia && (
              confirmClearAction === 'localMedia' ? (
                <span className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmClearAction(null);
                      onClearLocalMedia();
                    }}
                    className="px-2 py-0.5 text-[11px] font-semibold text-red-100 bg-red-900/90 border border-red-600 rounded hover:bg-red-800 whitespace-nowrap cursor-pointer"
                  >
                    Confirmar limpar mídias
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAction(null)}
                    className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    Cancelar
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClearAction('localMedia')}
                  className="text-xs text-slate-400 hover:text-red-400 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Limpar mídias
                </button>
              )
            )}

            {rawJsonText && (
              confirmClearAction === 'json' ? (
                <span className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmClearAction(null);
                      onRawJsonChange('');
                    }}
                    className="px-2 py-0.5 text-[11px] font-semibold text-red-100 bg-red-900/90 border border-red-600 rounded hover:bg-red-800 whitespace-nowrap cursor-pointer"
                  >
                    Confirmar limpar JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAction(null)}
                    className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    Cancelar
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClearAction('json')}
                  className="text-xs text-slate-400 hover:text-red-400 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Limpar JSON
                </button>
              )
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
              placeholder='Cole aqui o conteúdo do arquivo *_notes.json para preservar os "id" numéricos FSRS (áudios órfãos serão limpos e imagens locais serão buscadas automaticamente no Google/Web)...'
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

      {/* Row 4: Full Pipeline + Step-by-Step Action Bar */}
      <div className="pt-1 flex flex-wrap items-center justify-end gap-2.5">
        {hasExistingCards && onAuditExistingDeck && (
          <button
            type="button"
            onClick={onAuditExistingDeck}
            disabled={isGeneratingMap || isAuditingDeck || isGeneratingDeck || isRunningFullPipeline}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-200 bg-amber-950/60 border border-amber-700/70 rounded-lg hover:bg-amber-900/70 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            <span>
              {isAuditingDeck ? 'Julgando Cards...' : 'Julgar Deck Atual (IA)'}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={onGenerateClinicalMap}
          disabled={isGeneratingMap || isAuditingDeck || isGeneratingDeck || isRunningFullPipeline}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-100 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Layers className="w-3.5 h-3.5 text-sky-400" />
          <span>
            {isGeneratingMap
              ? 'Gerando Mapa...'
              : 'Passo 1: Mapa Clínico P1–P4'}
          </span>
        </button>

        <button
          type="button"
          onClick={onRecreateCanonicalDeck}
          disabled={isGeneratingMap || isAuditingDeck || isGeneratingDeck || isRunningFullPipeline}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-sky-200 bg-sky-950/70 border border-sky-700/70 rounded-lg hover:bg-sky-900/70 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 text-sky-400" />
          <span>
            {isGeneratingDeck
              ? 'Recriando Deck JSON...'
              : 'Passo 2: Recriar Deck JSON'}
          </span>
        </button>

        {onRunFullPipeline && (
          <button
            type="button"
            onClick={onRunFullPipeline}
            disabled={isGeneratingMap || isAuditingDeck || isGeneratingDeck || isRunningFullPipeline}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-950 bg-emerald-400 rounded-lg hover:bg-emerald-300 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>
              {isRunningFullPipeline
                ? 'Executando Pipeline Completo...'
                : 'Executar Pipeline Completo (Planejar → Julgar → Refazer → Confirmar)'}
            </span>
          </button>
        )}
      </div>
    </section>
  );
};
