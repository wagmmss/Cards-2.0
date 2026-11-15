import { UploadedPdfFile } from '../types/deck';

export function inferDocRole(filename: string): UploadedPdfFile['docRole'] {
  const lower = filename.toLowerCase();
  if (/diretriz|consenso|guideline|protocolo|febrasgo|sbc|sbp|ms\b/.test(lower)) {
    return 'diretriz';
  }
  if (/quest|prova|simulado|revalida|usp|unicamp|enare|sus/.test(lower)) {
    return 'questoes';
  }
  if (/resumo|apostila|aula|caderno|ficha/.test(lower)) {
    return 'resumo';
  }
  return 'documento';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

async function readFileAsBase64(file: File): Promise<string> {
  if (typeof file.arrayBuffer === 'function') {
    const buffer = await file.arrayBuffer();
    return arrayBufferToBase64(buffer);
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      resolve(res.includes(',') ? res.split(',')[1] : res);
    };
    reader.onerror = () => reject(reader.error || new Error(`Falha ao ler ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Converte imediatamente a FileList viva do navegador para um array estático
 * antes de qualquer `await`, garantindo que `input.value = ''` nunca descarte
 * os demais arquivos selecionados em lote.
 */
export async function readMultipleDocumentFiles(
  fileList: ArrayLike<File> | File[] | null | undefined
): Promise<UploadedPdfFile[]> {
  if (!fileList || fileList.length === 0) return [];
  const staticFiles = Array.isArray(fileList) ? fileList.slice() : Array.from(fileList);

  const settled = await Promise.all(
    staticFiles.map(async (file): Promise<UploadedPdfFile | null> => {
      const lower = file.name.toLowerCase();
      const isPdf = file.type === 'application/pdf' || lower.endsWith('.pdf');
      const isTextDoc =
        lower.endsWith('.txt') ||
        lower.endsWith('.md') ||
        file.type === 'text/plain' ||
        file.type === 'text/markdown';

      if (isPdf) {
        const base64Data = await readFileAsBase64(file);
        return {
          name: file.name,
          size: file.size,
          mimeType: 'application/pdf',
          base64Data,
          docRole: inferDocRole(file.name),
        };
      }

      if (isTextDoc) {
        const textContent = await file.text();
        return {
          name: file.name,
          size: file.size,
          mimeType: 'text/plain',
          base64Data: '',
          textContent,
          docRole: inferDocRole(file.name),
        };
      }

      return null;
    })
  );

  return settled.filter((doc): doc is UploadedPdfFile => doc !== null);
}
