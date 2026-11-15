import React, { useState } from 'react';
import { Search, X } from 'lucide-react';
import { CanonicalCard, MedicalImageResult } from '../../types/deck';

interface ImageSearchDrawerProps {
  card: CanonicalCard;
  hasAnyImage: boolean;
  imageSearchTerm: string;
  onImageSearchTermChange: (val: string) => void;
  imageResults: MedicalImageResult[];
  isSearchingImages: boolean;
  onSearch: (query: string) => void;
  onAttachImage: (
    imgUrl: string,
    legendText: string,
    mode: 'recognition' | 'feedback',
    suggestedFilename?: string
  ) => void;
  onRemoveCardImages: () => void;
  onClose: () => void;
}

export const ImageSearchDrawer: React.FC<ImageSearchDrawerProps> = ({
  card,
  hasAnyImage,
  imageSearchTerm,
  onImageSearchTermChange,
  imageResults,
  isSearchingImages,
  onSearch,
  onAttachImage,
  onRemoveCardImages,
  onClose,
}) => {
  const [customImageUrl, setCustomImageUrl] = useState('');
  const [customImageLegend, setCustomImageLegend] = useState('');

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (!blob) continue;
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            onAttachImage(
              reader.result,
              customImageLegend,
              'recognition',
              `clipboard_${card.id}.png`
            );
          }
        };
        reader.readAsDataURL(blob);
        return;
      }
    }
  };

  return (
    <div
      onPaste={handlePaste}
      className="p-3.5 rounded-lg bg-[#0B0F17] border border-slate-700 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold text-slate-100">
            Buscar Imagem Médica (Seus Materiais + Web)
          </h4>
          <p className="text-[11px] text-slate-400">
            Combina figuras extraídas dos seus PDFs/textos com busca clínica real (LITFL, Radiopaedia, Wikimedia). Ou pressione <kbd className="px-1 py-0.5 bg-slate-800 rounded font-mono text-slate-200">Ctrl+V</kbd>.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasAnyImage && (
            <button
              type="button"
              onClick={onRemoveCardImages}
              className="px-2 py-1 text-[11px] text-red-400 hover:text-red-300 border border-red-900/60 rounded cursor-pointer whitespace-nowrap"
            >
              Remover imagem
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar busca de imagens"
            className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(imageSearchTerm);
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={imageSearchTerm}
          onChange={(e) => onImageSearchTermChange(e.target.value)}
          placeholder="Ex.: apendicite aguda TC, IAM supra ST ECG, cardiotocografia desaceleração..."
          className="flex-1 px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={isSearchingImages}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 disabled:opacity-50 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Search className="w-3.5 h-3.5" />
          <span>{isSearchingImages ? 'Buscando...' : 'Buscar'}</span>
        </button>
      </form>

      {isSearchingImages && imageResults.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400">
          Buscando e validando imagens médicas reais...
        </div>
      ) : imageResults.length === 0 ? (
        <div className="py-5 px-4 rounded-lg border border-slate-800 bg-[#111827] text-center space-y-1">
          <p className="text-xs font-medium text-slate-300">
            Nenhuma imagem encontrada para &ldquo;{imageSearchTerm}&rdquo;.
          </p>
          <p className="text-[11px] text-slate-400">
            Tente termos do exame em inglês (ex.:{' '}
            <code className="font-mono text-sky-400">tension pneumothorax chest x-ray</code>) ou cole a URL abaixo.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-80 overflow-y-auto pr-1">
          {imageResults.map((img) => (
            <div
              key={img.id}
              className="flex flex-col justify-between p-2.5 rounded-lg bg-[#111827] border border-slate-800 gap-2"
            >
              <div className="space-y-1.5">
                <div className="h-28 w-full bg-slate-950 rounded overflow-hidden flex items-center justify-center border border-slate-800/80">
                  <img
                    src={img.thumbUrl}
                    alt={img.title}
                    loading="lazy"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <div className="flex items-center justify-between gap-1.5">
                  <div className="text-[11px] font-semibold text-slate-200 line-clamp-1">
                    {img.title}
                  </div>
                  <span
                    className={`text-[10px] font-mono shrink-0 ${
                      img.fromMaterial
                        ? 'px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-700/70 text-emerald-300'
                        : 'text-sky-400'
                    }`}
                  >
                    {img.fromMaterial
                      ? img.source?.includes('Markdown')
                        ? 'Material'
                        : `PDF p.${img.pageNumber ?? 1}`
                      : img.source.split(' ')[0]}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 line-clamp-2 leading-snug">
                  {img.description}
                </p>
              </div>

              <div className="flex items-center gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    onAttachImage(
                      img.thumbUrl,
                      img.defaultLegend,
                      'recognition',
                      img.suggestedFilename
                    )
                  }
                  className="flex-1 px-2 py-1 text-[10px] font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded text-center cursor-pointer whitespace-nowrap"
                >
                  + Na Pergunta
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onAttachImage(
                      img.thumbUrl,
                      img.defaultLegend,
                      'feedback',
                      img.suggestedFilename
                    )
                  }
                  className="px-2 py-1 text-[10px] font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-center cursor-pointer whitespace-nowrap"
                >
                  + No Verso
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pt-2 border-t border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <input
          type="url"
          value={customImageUrl}
          onChange={(e) => setCustomImageUrl(e.target.value)}
          placeholder="Ou cole a URL direta de uma imagem (https://...)"
          className="flex-1 px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500"
        />
        <input
          type="text"
          value={customImageLegend}
          onChange={(e) => setCustomImageLegend(e.target.value)}
          placeholder="Legenda clínica opcional"
          className="sm:w-56 px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500"
        />
        <button
          type="button"
          disabled={!customImageUrl.trim()}
          onClick={() => {
            onAttachImage(customImageUrl, customImageLegend, 'recognition');
            setCustomImageUrl('');
            setCustomImageLegend('');
          }}
          className="px-3 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-40 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
        >
          Embutir URL
        </button>
      </div>
    </div>
  );
};
