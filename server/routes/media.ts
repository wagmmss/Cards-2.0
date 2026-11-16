import express, { Request, Response } from 'express';
import {
  buildAnkiApkgBuffer,
  buildZipArchive,
  resolveDeckMediaFiles,
} from '../ankiExport';
import { getAiClient } from '../geminiClient';
import { searchMedicalImages } from '../mediaSearch';
import { isSafeExternalImageUrl, safeFetchWithRedirectValidation } from './gemini';

function sanitizeDeckKeyServer(raw: unknown): string {
  return (
    String(raw || 'internato_deck')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'internato_deck'
  );
}

function attachRequestAbort(req: Request, res: Response, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error('TimeoutError: Tempo limite da requisição de mídia excedido.'));
  }, timeoutMs);

  const onClose = () => {
    if (!res.writableFinished) {
      controller.abort(new DOMException('Conexão cancelada pelo cliente.', 'AbortError'));
    }
  };
  res.on('close', onClose);
  req.on('aborted', onClose);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      res.off('close', onClose);
      req.off('aborted', onClose);
    },
  };
}

export function createMediaRouter(): express.Router {
  const router = express.Router();

  // Buscar Imagens Médicas Fidedignas na Internet
  router.post('/media/search-medical-images', async (req, res) => {
    const { signal, cleanup } = attachRequestAbort(req, res, 28_000);
    try {
      const {
        query = '',
        topic = '',
        question = '',
        answer = '',
        hint = '',
        preferGoogleGrounding = true,
      } = req.body || {};

      const ai = getAiClient();
      const result = await searchMedicalImages(ai, {
        query: String(query || ''),
        topic: String(topic || ''),
        question: String(question || ''),
        answer: String(answer || ''),
        hint: String(hint || ''),
        preferGoogleGrounding: Boolean(preferGoogleGrounding),
        signal,
      });

      if (res.writableEnded) return;
      return res.json(result);
    } catch {
      if (res.writableEnded) return;
      return res.json({
        query: 'atlas_clinico',
        translatedQueries: [],
        images: [],
      });
    } finally {
      cleanup();
    }
  });

  // Proxy de imagem externa para permitir Tarja Anti-Spoiler via <canvas> sem erro de CORS
  router.get('/media/proxy-image', async (req, res) => {
    const { signal, cleanup } = attachRequestAbort(req, res, 6000);
    try {
      const targetUrl = String(req.query.url || '').trim();
      if (!isSafeExternalImageUrl(targetUrl)) {
        return res.status(400).send('Invalid or blocked image URL');
      }
      const upstream = await safeFetchWithRedirectValidation(targetUrl, {
        headers: {
          'User-Agent':
            'InternatoFirstCardArchitect/2.0 (https://aistudio.google.com; medical-education)',
        },
        signal,
      });
      if (!upstream.ok) {
        return res.status(upstream.status).send('Failed to fetch upstream image');
      }
      const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
      if (!contentType.startsWith('image/')) {
        return res.status(415).send('Upstream resource is not an image');
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (buffer.length < 64) {
        return res.status(502).send('Upstream image is empty or corrupted');
      }
      if (buffer.length > 10 * 1024 * 1024) {
        return res.status(413).send('Image exceeds 10MB limit');
      }
      if (res.writableEnded) return;
      res.setHeader('Content-Type', contentType);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(buffer);
    } catch {
      if (res.writableEnded) return;
      return res.status(502).send('Error proxying image');
    } finally {
      cleanup();
    }
  });

  // Exportar Pacote Anki Offline (.zip)
  router.post('/media/export-bundle', async (req, res) => {
    try {
      const {
        deckKey = 'internato_deck',
        notesJson = '[]',
        mediaManifest = [],
        mediaAssets = {},
        guidRegistry = {},
      } = req.body || {};

      const cleanDeckKey = sanitizeDeckKeyServer(deckKey);

      const { resolvedMedia, missingMedia } = await resolveDeckMediaFiles(
        mediaManifest,
        mediaAssets
      );

      const zipEntries: Array<{ name: string; data: Buffer }> = [];
      const jsonBuffer = Buffer.from(String(notesJson), 'utf8');

      zipEntries.push({
        name: `${cleanDeckKey}_notes.json`,
        data: jsonBuffer,
      });
      zipEntries.push({
        name: `01_Notas/${cleanDeckKey}_notes.json`,
        data: jsonBuffer,
      });

      for (const mediaItem of resolvedMedia) {
        zipEntries.push({
          name: `collection.media/${mediaItem.filename}`,
          data: mediaItem.data,
        });
        zipEntries.push({
          name: `04_Mídias/${cleanDeckKey}/${mediaItem.filename}`,
          data: mediaItem.data,
        });
      }

      if (guidRegistry && typeof guidRegistry === 'object') {
        zipEntries.push({
          name: 'data/registry/note_guid_registry.json',
          data: Buffer.from(
            JSON.stringify({ version: 1, entries: guidRegistry }, null, 2),
            'utf8'
          ),
        });
      }

      const mediaReport = {
        deckKey: cleanDeckKey,
        exportedAt: new Date().toISOString(),
        resolvedCount: resolvedMedia.length,
        missingCount: missingMedia.length,
        resolvedFiles: resolvedMedia.map((m) => m.filename),
        missingMedia,
      };

      zipEntries.push({
        name: 'RELATORIO_MIDIAS.json',
        data: Buffer.from(JSON.stringify(mediaReport, null, 2), 'utf8'),
      });

      const readmeText = [
        `PACOTE OFFLINE ANKI — ${cleanDeckKey.toUpperCase()}`,
        '==========================================================',
        `1. Arquivo de Notas JSON (com <img src="nome_arquivo_local"> sem links externos):`,
        `   - ${cleanDeckKey}_notes.json`,
        `   - 01_Notas/${cleanDeckKey}_notes.json`,
        '',
        `2. Auditoria de Mídias (${resolvedMedia.length} resolvida(s) / ${missingMedia.length} faltante(s)):`,
        '   - Pasta collection.media/ : copie os arquivos diretamente para a pasta collection.media do seu Anki.',
        `   - Pasta 04_Mídias/${cleanDeckKey}/ : pronta para o gerador desktop (uv run cards).`,
        ...(missingMedia.length > 0
          ? [
              '',
              '⚠️ ATENÇÃO — MÍDIAS AUSENTES NÃO INCLUÍDAS NO PACOTE:',
              ...missingMedia.map(
                (m) => `   - ${m.filename} (Card ID: ${m.cardId ?? '?'}) -> ${m.reason}`
              ),
            ]
          : ['   - Todas as mídias referenciadas foram embutidas com sucesso!']),
        '',
      ].join('\n');

      zipEntries.push({
        name: 'LEIA-ME_ANKI_OFFLINE.txt',
        data: Buffer.from(readmeText, 'utf8'),
      });

      const zipBuffer = buildZipArchive(zipEntries);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('X-Resolved-Media-Count', String(resolvedMedia.length));
      res.setHeader('X-Missing-Media-Count', String(missingMedia.length));
      res.setHeader(
        'X-Missing-Media',
        encodeURIComponent(JSON.stringify(missingMedia.map((m) => m.filename)))
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${cleanDeckKey}_anki_offline_bundle.zip"`
      );
      return res.send(zipBuffer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao montar pacote ZIP offline';
      return res.status(500).json({ error: msg });
    }
  });

  // Exportar diretamente para .apkg (SQLite collection.anki21 + mídias numeradas + preservação FSRS)
  router.post('/export/apkg', async (req, res) => {
    try {
      const {
        deckKey = 'internato_deck',
        deckName = '',
        deckId,
        notes = [],
        mediaManifest = [],
        mediaAssets = {},
        guidRegistry = {},
      } = req.body || {};

      const cleanDeckKey = sanitizeDeckKeyServer(deckKey);

      const { resolvedMedia, missingMedia } = await resolveDeckMediaFiles(
        mediaManifest,
        mediaAssets
      );

      const { apkgBuffer, updatedRegistry } = await buildAnkiApkgBuffer({
        deckKey: cleanDeckKey,
        deckName: deckName || cleanDeckKey.replace(/_/g, ' '),
        deckId: typeof deckId === 'number' ? deckId : undefined,
        notes: Array.isArray(notes) ? notes : [],
        resolvedMedia,
        guidRegistry:
          guidRegistry && typeof guidRegistry === 'object' ? guidRegistry : {},
      });

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Resolved-Media-Count', String(resolvedMedia.length));
      res.setHeader('X-Missing-Media-Count', String(missingMedia.length));
      res.setHeader(
        'X-Missing-Media',
        encodeURIComponent(JSON.stringify(missingMedia.map((m) => m.filename)))
      );
      res.setHeader(
        'X-Updated-Guid-Count',
        String(Object.keys(updatedRegistry).length)
      );
      const serializedRegistry = JSON.stringify(updatedRegistry);
      if (serializedRegistry.length <= 6000) {
        res.setHeader('X-Updated-Guid-Registry', encodeURIComponent(serializedRegistry));
      }
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${cleanDeckKey}.apkg"`
      );
      return res.send(apkgBuffer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao gerar arquivo .apkg';
      return res.status(500).json({ error: msg });
    }
  });

  return router;
}
