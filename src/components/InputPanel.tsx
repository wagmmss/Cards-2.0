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
  XCircle,
} from 'lucide-react';
import { DomainProfile, ExtractedDeckMetadata, UploadedPdfFile } from '../types/deck';
import { DOMAIN_PROFILE_CONFIGS, DOMAIN_PROFILE_ORDER } from '../utils/domainProfiles';
import { readMultipleDocumentFiles } from '../utils/documentUpload';

interface InputPanelProps {
  pdfs: UploadedPdfFile[];
  onAddPdfs: (files: UploadedPdfFile[]) => void;
  onRemovePdf: (index: number) => void;
  onClearPdfs: () => void;
  rawJsonText: string;
  onRawJsonChange: (text: string) => void;
  jsonError: string | null;
  extractedMeta: ExtractedDeckMetadata;
  deckKey: string;
  onDeckKeyChange: (val: string) => void;
  selectedProfile: 'auto' | DomainProfile;
  onProfileChange: (val: 'auto' | DomainProfile) => void;
  useGoogleSearch: boolean;
  onToggleGoogleSearch: (val: boolean) => void;
  onGenerateClinicalMap: () => void;
  onRecreateCanonicalDeck: () => void;
  onCancelGeneration: () => void;
  onLoadGenericSample: () => void;
  isGeneratingMap: boolean;
  isGeneratingDeck: boolean;
  guidCount: number;
  onImportGuidRegistry: (jsonText: string) => void;
  onExportGuidRegistry: () => void;
}

export const InputPanel: React.FC<InputPanelProps> = ({
  pdfs,
  onAddPdfs,
  onRemovePdf,
  onClearPdfs,
  rawJsonText,
  onRawJsonChange,
  jsonError,
  extractedMeta,
  deckKey,
  onDeckKeyChange,
  selectedProfile,
  onProfileChange,
  useGoogleSearch,
  onToggleGoogleSearch,
  onGenerateClinicalMap,
  onRecreateCanonicalDeck,
  onCancelGeneration,
  onLoadGenericSample,
  isGeneratingMap,
  isGeneratingDeck,
  guidCount,
  onImportGuidRegistry,
  onExportGuidRegistry,
}) => {
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);
  const guidFileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingPdf, setIsDraggingPdf] = useState(false);
  const [showAdvancedJson, setShowAdvancedJson] = useState(false);

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

  const handleJsonFileUpload = async (fileList: File[] | FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const text = await fileList[0].text();
    onRawJsonChange(text);
    setShowAdvancedJson(true);
  };

  const handleGuidFileUpload = async (fileList: File[] | FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const text = await fileList[0].text();
    onImportGuidRegistry(text);
  };

  const isBusy = isGeneratingMap || isGeneratingDeck;

  return (
    <section
      id="painel-entrada"
      className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-base font-bold text-slate-100 font-display">
            1. Importar Tema, Documentos ou Deck Existente
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Anexe PDFs/resumos (diretrizes, aulas ou questões) e/ou importe um baralho JSON existente para preservar o histórico FSRS.
          </p>
        </div>

        <button
          type="button"
          onClick={onLoadGenericSample}
          className="text-xs font-medium text-sky-400 hover:text-sky-300 underline underline-offset-4 whitespace-nowrap shrink-0 cursor-pointer"
        >
          Carregar exemplo clínico
        </button>
      </div>

      {/* Row 1: Deck Key + Domain Profile + Google Search Toggle */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-end">
        <div className="md:col-span-5">
          <label
            htmlFor="deck-key-input"
            className="block text-xs font-medium text-slate-300 mb-1.5"
          >
            Tema ou Identificador do Baralho
          </label>
          <input
            id="deck-key-input"
            type="text"
            value={deckKey}
            onChange={(e) => onDeckKeyChange(e.target.value)}
            placeholder="Ex.: etica_medica, abdome_agudo, diabetes_mellitus"
            className="w-full px-3.5 py-2 text-sm bg-[#0B0F17] border border-slate-700/90 rounded-lg text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none transition-colors"
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
            className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-slate-700/90 rounded-lg text-slate-100 focus:border-sky-400 focus:outline-none transition-colors cursor-pointer"
          >
            <option value="auto">Automático (por tema)</option>
            {DOMAIN_PROFILE_ORDER.map((prof) => (
              <option key={prof} value={prof}>
                {DOMAIN_PROFILE_CONFIGS[prof].label}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-4">
          <label
            htmlFor="google-search-toggle"
            className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-lg border border-slate-700/90 bg-[#0B0F17] cursor-pointer select-none"
          >
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-200 truncate">
                Google Search + Imagens Reais
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                Diretrizes atualizadas e acervos clínicos
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

      {/* Row 2: Multi-Document Dropzone */}
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
                Anexe documentos de apoio (Diretrizes, Resumos ou Provas)
              </p>
              <p className="text-[11px] text-slate-400">
                Arraste arquivos <code className="font-mono text-slate-300">.pdf</code>,{' '}
                <code className="font-mono text-slate-300">.txt</code> ou{' '}
                <code className="font-mono text-slate-300">.md</code> — arquivos duplicados são filtrados automaticamente
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-md whitespace-nowrap shrink-0">
            <Plus className="w-3.5 h-3.5 text-sky-400" />
            <span>
              {pdfs.length > 0 ? `${pdfs.length} anexo(s) — Adicionar` : 'Selecionar Arquivos'}
            </span>
          </span>
        </div>

        {pdfs.length > 0 && (
          <div className="mt-2 border border-slate-800 rounded-lg bg-[#0B0F17] overflow-hidden">
            <div className="px-3.5 py-1.5 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
              <span>
                <strong className="text-slate-200 tabular-nums">{pdfs.length}</strong> documento(s) anexado(s)
              </span>
              <button
                type="button"
                onClick={onClearPdfs}
                className="text-slate-400 hover:text-red-400 cursor-pointer"
              >
                Remover todos
              </button>
            </div>
            <ul className="divide-y divide-slate-800 max-h-40 overflow-y-auto">
              {pdfs.map((pdf, index) => (
                <li
                  key={`${pdf.name}-${pdf.size}-${index}`}
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

      {/* Row 3: Importar Deck JSON + Disclosure Avançado para JSON Bruto & GUIDs FSRS */}
      <div className="border border-slate-800 rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-[#0B0F17]/90">
          <button
            type="button"
            onClick={() => setShowAdvancedJson((prev) => !prev)}
            className="flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-slate-100 cursor-pointer"
          >
            {showAdvancedJson ? (
              <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span>Importar Deck JSON &amp; Opções Avançadas (FSRS)</span>
          </button>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <span className="text-slate-400 tabular-nums">
              {extractedMeta.existingIds.length} IDs carregados ·{' '}
              <strong className="text-emerald-400">{guidCount}</strong> GUIDs FSRS
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
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileJson className="w-3.5 h-3.5 text-sky-400" />
              <span>Importar .json</span>
            </button>
          </div>
        </div>

        {showAdvancedJson && (
          <div className="p-4 border-t border-slate-800 space-y-3 bg-[#0F1623]">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
              <span className="text-[11px] text-slate-400">
                Editor JSON bruto e sincronização manual de registro FSRS (<code className="font-mono text-slate-300">note_guid_registry.json</code>)
              </span>
              <div className="flex flex-wrap items-center gap-2">
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
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-700 rounded hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Database className="w-3 h-3 text-emerald-400" />
                  <span>Importar GUIDs</span>
                </button>
                <button
                  type="button"
                  onClick={onExportGuidRegistry}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-700 rounded hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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

            <textarea
              id="current-deck-json"
              rows={5}
              value={rawJsonText}
              onChange={(e) => onRawJsonChange(e.target.value)}
              placeholder='Cole o conteúdo de um arquivo *_notes.json existente para preservar os IDs FSRS...'
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

      {/* Row 4: Clean Action Bar */}
      <div className="pt-1 flex flex-wrap items-center justify-end gap-3">
        {isBusy && (
          <button
            type="button"
            onClick={onCancelGeneration}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-200 bg-red-950/80 border border-red-700 rounded-lg hover:bg-red-900/80 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <XCircle className="w-3.5 h-3.5 text-red-400" />
            <span>Cancelar</span>
          </button>
        )}

        <button
          type="button"
          onClick={onGenerateClinicalMap}
          disabled={isBusy}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-100 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Layers className="w-3.5 h-3.5 text-sky-400" />
          <span>
            {isGeneratingMap ? 'Gerando Mapa Clínico...' : '1. Gerar Mapa Clínico P1–P4'}
          </span>
        </button>

        <button
          type="button"
          onClick={onRecreateCanonicalDeck}
          disabled={isBusy}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-400 rounded-lg hover:bg-sky-300 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>
            {isGeneratingDeck ? 'Gerando Deck...' : '2. Gerar / Reconstruir Deck'}
          </span>
        </button>
      </div>
    </section>
  );
};
