import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import initSqlJs from 'sql.js';
import {
  buildAnkiApkgBuffer,
  computeDeckIdFromKey,
  genankiGuidFor,
  sanitizeDeckKeyForAnki,
} from './ankiExport';
import { createGeminiRouter } from './routes/gemini';
import { createMediaRouter } from './routes/media';
import {
  computeDeterministicDeckId,
  resolveOrCreateNoteGuid,
} from '../src/utils/wozniakLinter';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, 'base64');

// Valid >256-byte PNG buffer (tEXt padding chunk) for endpoints checking minimum binary size
const VALID_RASTER_PNG_BUFFER = Buffer.concat([
  TINY_PNG_BUFFER,
  Buffer.alloc(300, 0x41),
]);

function extractZipEntries(zipBuf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= zipBuf.length && zipBuf.readUInt32LE(offset) === 0x04034b50) {
    const compressionMethod = zipBuf.readUInt16LE(offset + 8);
    assert.equal(compressionMethod, 0, 'Expected STORED ZIP entry');
    const compSize = zipBuf.readUInt32LE(offset + 18);
    const nameLen = zipBuf.readUInt16LE(offset + 26);
    const extraLen = zipBuf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const name = zipBuf.subarray(nameStart, nameStart + nameLen).toString('utf8');
    const data = zipBuf.subarray(dataStart, dataStart + compSize);
    entries.set(name, Buffer.from(data));
    offset = dataStart + compSize;
  }
  return entries;
}

function makeGeminiSseResponse(textPayload: string, finishReason = 'STOP'): globalThis.Response {
  const chunk = JSON.stringify({
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: textPayload }],
        },
        finishReason,
      },
    ],
  });
  return new Response(`data: ${chunk}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function startTestAppServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/gemini', createGeminiRouter());
  app.use('/api', createMediaRouter());

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

test('Client and server SHA-256 deck_id and FSRS note GUID generation match byte-for-byte including accented keys', () => {
  const deckKeys = [
    'assistencia_parto',
    'manobras_leopold',
    'Assistência ao Parto!',
    'Síndromes Hipertensivas — 2026',
    '   ',
  ];

  for (const rawKey of deckKeys) {
    const serverDeckId = computeDeckIdFromKey(rawKey);
    const clientDeckId = computeDeterministicDeckId(rawKey);
    assert.equal(serverDeckId, clientDeckId, `deck_id mismatch for key "${rawKey}"`);

    const noteIds = [1, 1792354533078, 171000105];
    for (const noteId of noteIds) {
      const serverGuid = genankiGuidFor(serverDeckId, rawKey, noteId);
      const clientRes = resolveOrCreateNoteGuid(rawKey, clientDeckId, noteId, {});
      assert.equal(
        serverGuid,
        clientRes.guid,
        `GUID mismatch for key "${rawKey}" noteId=${noteId}`
      );
    }
  }
  assert.equal(sanitizeDeckKeyForAnki('Assistência ao Parto!'), 'assistencia_ao_parto');
});

test('buildAnkiApkgBuffer extracts inline data:image URIs, strips missing media & orphan legends, writes valid SQLite + mobile med-table CSS', async () => {
  const notes = [
    {
      id: 1792354889340,
      type: 'basic' as const,
      topic: 'Distócia de Espáduas - Conduta Imediata',
      question:
        'Gestante com feto macrossômico apresenta sinal da tartaruga. Qual manobra inicial aplicar?',
      answer: 'Manobra de McRoberts associada à pressão suprapúbica.',
      hint: `<img src="data:image/png;base64,${TINY_PNG_BASE64}" data-anki-file="mcroberts_inline.png"><br><i>Ilustração da manobra de McRoberts com hiperflexão das coxas maternas.</i><br><br><b>Comentário:</b> A <b>hiperflexão das coxas</b> retifica o promontório, enquanto <b>Kristeller</b> é proscrito.`,
      tags: ['assistencia_parto'],
    },
    {
      id: 1,
      type: 'cloze' as const,
      topic: 'Exame Obstétrico - 1º Tempo',
      question:
        'O 1º tempo de Leopold delimita o fundo uterino para identificar a {{c1::situação}} fetal.<br><img src="leopold_1.png">',
      answer: '',
      hint: '<i>Ilustração do 1º tempo da palpação abdominal no fundo uterino.</i><br><br><b>Comentário:</b> Identifica qual polo ocupa o fundo uterino.',
      tags: ['manobras_leopold'],
    },
    {
      id: 999001,
      type: 'basic' as const,
      topic: 'Partograma - Referência Ausente',
      question: 'Qual achado na imagem?<br><img src="arquivo_que_faltou.png">',
      answer: 'Parada secundária da dilatação.',
      hint: '<i>Legenda visual órfã que não deve sobrar sem imagem no card.</i><br><br><b>Comentário:</b> Dilatação estacionária por ≥ 2h sob contrações eficazes, distinta da <b>fase ativa prolongada</b>.<table class="med-table"><thead><tr><th>Critério</th><th>Limite</th></tr></thead><tbody><tr><td>OMS</td><td>2 horas</td></tr></tbody></table>',
      tags: ['assistencia_parto'],
    },
  ];

  const { apkgBuffer, updatedRegistry } = await buildAnkiApkgBuffer({
    deckKey: 'Assistência ao Parto!',
    deckName: 'Obstetrícia::Assistência ao Parto',
    notes,
    resolvedMedia: [{ filename: 'leopold_1.png', data: TINY_PNG_BUFFER }],
    guidRegistry: {},
  });

  const zipFiles = extractZipEntries(apkgBuffer);
  assert.ok(zipFiles.has('collection.anki21'));
  assert.ok(zipFiles.has('collection.anki2'));
  assert.ok(zipFiles.has('media'));

  const mediaMap = JSON.parse(zipFiles.get('media')!.toString('utf8')) as Record<string, string>;
  const packedFilenames = Object.values(mediaMap).sort();
  assert.deepEqual(packedFilenames, ['leopold_1.png', 'mcroberts_inline.png']);

  for (const [numKey, fname] of Object.entries(mediaMap)) {
    const entryBytes = zipFiles.get(numKey);
    assert.ok(entryBytes && entryBytes.equals(TINY_PNG_BUFFER), `PNG bytes mismatch for ${fname}`);
  }

  // Inspect SQLite tables via sql.js
  const SQL = await initSqlJs();
  const db = new SQL.Database(zipFiles.get('collection.anki21')!);
  try {
    const colRows = db.exec('SELECT models, decks FROM col');
    const models = JSON.parse(String(colRows[0].values[0][0]));
    const decks = JSON.parse(String(colRows[0].values[0][1]));

    const expectedDeckId = computeDeckIdFromKey('Assistência ao Parto!');
    assert.ok(decks[String(expectedDeckId)], 'Expected deterministic deck_id in col.decks');

    const basicModel = models['1738331521912'];
    assert.ok(basicModel.css.includes('table.med-table'));
    assert.ok(basicModel.css.includes('@media (max-width: 600px)'));
    assert.ok(basicModel.css.includes('overflow-x: auto'));

    const noteRows = db.exec('SELECT id, guid, flds FROM notes ORDER BY id ASC')[0].values;
    assert.equal(noteRows.length, 3);

    const byId = new Map<number, { guid: string; flds: string }>();
    for (const row of noteRows) {
      byId.set(Number(row[0]), { guid: String(row[1]), flds: String(row[2]) });
    }

    assert.equal(
      byId.get(1)!.guid,
      genankiGuidFor(expectedDeckId, 'assistencia_ao_parto', 1)
    );
    assert.equal(
      updatedRegistry['assistencia_ao_parto:id:1'],
      byId.get(1)!.guid
    );

    const inlineFields = byId.get(1792354889340)!.flds.split('\x1f');
    assert.equal(inlineFields[3].includes('data:image/'), false);
    assert.equal(inlineFields[3].includes('<img src="mcroberts_inline.png">'), true);

    // Note 999001 had missing image -> both <img> AND orphan leading <i>...</i> must be stripped
    const orphanFields = byId.get(999001)!.flds.split('\x1f');
    assert.equal(/<img/i.test(orphanFields[0]), false);
    assert.equal(/Legenda visual órfã/i.test(orphanFields[3]), false);
    assert.equal(orphanFields[3].startsWith('<b>Comentário:</b>'), true);
    assert.equal(orphanFields[3].includes('<table class="med-table">'), true);

    const cardRows = db.exec('SELECT did, ord FROM cards')[0].values;
    assert.equal(cardRows.length, 3);
    for (const [did] of cardRows) {
      assert.equal(Number(did), expectedDeckId);
    }
  } finally {
    db.close();
  }
});

test('Express routes: /api/gemini MAX_TOKENS split stride, cross-key PDF upload/inline fallback, /validate-image strict boolean, and /proxy-image SSRF blocking', async (t) => {
  const prevKeys = process.env.GEMINI_API_KEYS;
  const prevKey = process.env.GEMINI_API_KEY;
  const originalFetch = globalThis.fetch;

  process.env.GEMINI_API_KEYS = 'mock-test-key-primary-0001,mock-test-key-secondary-0002';
  delete process.env.GEMINI_API_KEY;

  const { baseUrl, close } = await startTestAppServer();

  const seenGeminiAuthHeaders: string[] = [];
  const seenExternalUrls: string[] = [];
  let failKey1UploadCount = 0;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    // Pass local test server HTTP calls straight through to real fetch
    if (urlStr.startsWith(baseUrl)) {
      return originalFetch(input, init);
    }

    seenExternalUrls.push(urlStr);

    // Mock Gemini Files API resumable upload (matches v1 or v1beta)
    if (urlStr.includes('generativelanguage.googleapis.com/upload/')) {
      const apiKey = new URL(urlStr).searchParams.get('key') ||
        (init?.headers instanceof Headers
          ? init.headers.get('x-goog-api-key') || ''
          : (init?.headers as Record<string, string> | undefined)?.['x-goog-api-key'] || '');

      if (urlStr.includes('mock-session-key2')) {
        return new Response(
          JSON.stringify({
            file: {
              name: 'files/doc_key2_ok',
              uri: 'https://generativelanguage.googleapis.com/v1beta/files/doc_key2_ok',
              mimeType: 'application/pdf',
              state: 'ACTIVE',
            },
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-goog-upload-status': 'final',
            },
          }
        );
      }

      // First key forced to fail upload cleanly with 400 so inlineData fallback is exercised on Key 1
      if (apiKey.includes('primary-0001')) {
        failKey1UploadCount++;
        return new Response(JSON.stringify({ error: { code: 400, message: 'Bad file upload on key1' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/v1beta/files/mock-session-key2',
        },
      });
    }

    // Mock Gemini streamGenerateContent SSE endpoint (matches v1 or v1beta)
    if (urlStr.includes('generativelanguage.googleapis.com/') && urlStr.includes(':streamGenerateContent')) {
      const headersObj =
        init?.headers instanceof Headers
          ? Object.fromEntries(init.headers.entries())
          : ((init?.headers || {}) as Record<string, string>);
      const keyUsed = headersObj['x-goog-api-key'] || new URL(urlStr).searchParams.get('key') || '';
      seenGeminiAuthHeaders.push(keyUsed);

      const bodyRaw = typeof init?.body === 'string' ? init.body : '';
      const parsedBody = bodyRaw ? JSON.parse(bodyRaw) : {};
      const contentsStr = JSON.stringify(parsedBody.contents || {});

      // Cross-key PDF rotation scenario
      if (contentsStr.includes('partograma_rotate_test')) {
        if (keyUsed.includes('primary-0001')) {
          // Non-retryable 403 -> immediate key rotation to secondary key without sleep!
          return new Response(
            JSON.stringify({
              error: { code: 403, message: 'PERMISSION_DENIED: key1 suspended', status: 'PERMISSION_DENIED' },
            }),
            { status: 403, headers: { 'content-type': 'application/json' } }
          );
        }
        // Secondary key MUST receive the re-uploaded Key 2 fileUri in contents!
        assert.equal(
          contentsStr.includes('files/doc_key2_ok'),
          true,
          `Expected secondary key to receive newly uploaded Key-2 fileUri, got: ${contentsStr.slice(0, 300)}`
        );
        return makeGeminiSseResponse(
          JSON.stringify({
            themeTitle: 'Partograma Rotated',
            specialty: 'GO',
            deckKey: 'partograma_rotate_test',
            profile: 'emergencia',
            guidelineUpdates: ['[OMS]: Linha de ação 4h à direita.'],
            items: [
              {
                id: 'p1-1',
                priority: 'P1',
                subtopic: 'Parada Secundária',
                concept: 'Critério de parada secundária',
                guidelineNote: 'ACOG 2024',
                targetCardType: 'basic',
                checked: true,
              },
            ],
          })
        );
      }

      // inlineData fallback scenario (single key where upload returned 400 -> inlineData attached)
      if (contentsStr.includes('partograma_inline_test')) {
        assert.equal(contentsStr.includes('"inlineData"'), true, 'Expected inlineData PDF part after upload 400');
        return makeGeminiSseResponse(
          JSON.stringify({
            themeTitle: 'Partograma Inline Fallback',
            specialty: 'GO',
            deckKey: 'partograma_inline_test',
            profile: 'emergencia',
            guidelineUpdates: ['[OMS]: Fallback inline funcionou.'],
            items: [],
          })
        );
      }

      // generate-deck MAX_TOKENS recovery & non-colliding stride scenario (6 cards -> splits 3 + 3)
      if (contentsStr.includes('MODO DE RECONSTRUÇÃO PROFUNDA EM LOTE')) {
        if (contentsStr.includes('6 cards neste lote')) {
          return makeGeminiSseResponse(
            '{"deck_key":"parto","notes":[{"id":101,"type":"basic","topic":"T - S1","question":"Q1?","answer":"A1.","hint":"<b>Comentário:</b> Ok."}',
            'MAX_TOKENS'
          );
        }
        const reservedMatch = contentsStr.match(/Primeiro novo ID exclusivo reservado para este lote[^:]*:\s*(\d+)/);
        const startId = reservedMatch ? Number(reservedMatch[1]) : 999;
        const cardIds = Array.from(contentsStr.matchAll(/- ID:(\d+)/g)).map((m) => Number(m[1]));
        const outNotes = [
          ...cardIds.map((cid) => ({
            id: cid,
            type: 'cloze',
            topic: `Parto - Subtema ${cid}`,
            question: `Conduta crítica no cenário ${cid} usa {{c1::ocitocina}} na dose correta.`,
            answer: 'should_be_cleared_on_cloze',
            hint: '<b>Comentário:</b> Resposta objetiva para o cenário clínico analisado, contrastando com alternativa incorreta.',
            sources: [{ file: 'drop.pdf', page: 1 }],
          })),
          {
            id: startId,
            type: 'basic',
            topic: `Parto - Desmembrado ${startId}`,
            question: `Qual o próximo passo imediato após falha inicial no bloco ${startId}?`,
            answer: `Conduta desmembrada ${startId}.`,
            hint: '<b>Comentário:</b> Garante atomicidade clínica com <b>ID exclusivo sem colisão</b> entre sublotes.',
          },
        ];
        return makeGeminiSseResponse(JSON.stringify({ deck_key: 'parto', notes: outNotes }));
      }

      // validate-image Vision scenarios
      if (contentsStr.includes('auditando visualmente uma imagem candidata')) {
        if (contentsStr.includes('Card Conflitante')) {
          return makeGeminiSseResponse(
            JSON.stringify({
              detectedModality: 'videolaparoscopia',
              isCompatible: false,
              conflictReason: 'O card solicita ultrassonografia, mas a imagem mostra laparoscopia.',
              visualLegend: 'Videolaparoscopia pélvica evidenciando aderências tubárias.',
            })
          );
        }
        if (contentsStr.includes('Card String False Bug')) {
          return makeGeminiSseResponse(
            JSON.stringify({
              detectedModality: 'ecg',
              isCompatible: 'false',
              conflictReason: 'Incompatível.',
              visualLegend: 'Traçado eletrocardiográfico sem supradesnivelamento.',
            })
          );
        }
        return makeGeminiSseResponse(
          JSON.stringify({
            detectedModality: 'ctg',
            isCompatible: true,
            conflictReason: '',
            visualLegend: 'Legenda visual: Cardiotocografia evidenciando desaceleração tardia repetida após contração.',
          })
        );
      }

      return makeGeminiSseResponse('{}');
    }

    // Mock external image fetches for /validate-image and /proxy-image SSRF test
    if (urlStr === 'https://img.example.org/broken.png') {
      return new Response('Not found', { status: 404 });
    }
    if (urlStr === 'https://img.example.org/vector.svg') {
      const svgBody = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">' + '<rect width="10" height="10"/>'.repeat(8) + '</svg>';
      return new Response(svgBody, { status: 200, headers: { 'content-type': 'image/svg+xml' } });
    }
    if (urlStr === 'https://img.example.org/valid.png') {
      return new Response(VALID_RASTER_PNG_BUFFER, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }
    if (urlStr === 'https://img.example.org/redirect-ssrf.png') {
      return new Response('', {
        status: 302,
        headers: { location: 'http://127.0.0.1:9999/internal-secret.png' },
      });
    }

    throw new Error(`Unexpected external fetch in test: ${urlStr}`);
  };

  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (prevKeys === undefined) delete process.env.GEMINI_API_KEYS;
    else process.env.GEMINI_API_KEYS = prevKeys;
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
    await close();
  });

  // 1) /api/gemini/generate-deck MAX_TOKENS split + non-colliding stride + cloze answer clear + sources strip
  const batchResp = await originalFetch(`${baseUrl}/api/gemini/generate-deck`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deckKey: 'assistencia_parto',
      nextNewIdStart: 171000500,
      batchCards: [1, 2, 3, 4, 5, 6].map((id) => ({
        id,
        type: 'basic',
        topic: `T${id} - Sub`,
        question: `Q${id}?`,
        answer: `A${id}.`,
        hint: '<b>Comentário:</b> H.',
      })),
    }),
  });
  const batchData = (await batchResp.json()) as { notes?: Array<Record<string, unknown>>; error?: string };
  assert.ok(Array.isArray(batchData.notes), `Expected notes array, got: ${JSON.stringify(batchData)}`);
  assert.equal(batchData.notes.length, 8); // 6 rewritten + 2 split cards (left + right halves)
  const splitIds = batchData.notes.map((n) => Number(n.id)).filter((id) => id >= 171000500);
  assert.deepEqual(splitIds, [171000500, 171000550]); // Stride=100 -> halfStride=50 -> zero collision!
  const clozeNote = batchData.notes.find((n) => n.type === 'cloze');
  assert.ok(clozeNote);
  assert.equal(clozeNote.answer, '');
  assert.equal('sources' in clozeNote, false);

  // 2) Cross-key PDF rotation + re-upload on Key 2 + inlineData fallback when single key upload fails
  const rotateResp = await originalFetch(`${baseUrl}/api/gemini/clinical-map`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deckKey: 'partograma_rotate_test',
      useGoogleSearch: false,
      pdfs: [
        {
          name: 'cross_key_rotate_test.pdf',
          mimeType: 'application/pdf',
          base64Data: Buffer.from('%PDF-1.4 rotate').toString('base64'),
          fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/old_key0_doc',
          keyFingerprint: 'foreign_key_fp',
        },
      ],
    }),
  });
  const rotateJson = (await rotateResp.json()) as { themeTitle?: string; error?: string };
  assert.equal(rotateJson.themeTitle, 'Partograma Rotated', `Unexpected response: ${JSON.stringify(rotateJson)}`);
  assert.ok(seenGeminiAuthHeaders.some((k) => k.includes('secondary-0002')));
  assert.ok(failKey1UploadCount >= 1);

  process.env.GEMINI_API_KEYS = 'mock-test-key-primary-0001';
  const inlineResp = await originalFetch(`${baseUrl}/api/gemini/clinical-map`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deckKey: 'partograma_inline_test',
      useGoogleSearch: false,
      pdfs: [
        {
          name: 'inline_fallback_test.pdf',
          mimeType: 'application/pdf',
          base64Data: Buffer.from('%PDF-1.4 inline').toString('base64'),
          fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/old_doc',
          keyFingerprint: 'another_key_fp',
        },
      ],
    }),
  });
  const inlineJson = (await inlineResp.json()) as { themeTitle?: string; error?: string };
  assert.equal(inlineJson.themeTitle, 'Partograma Inline Fallback', `Unexpected response: ${JSON.stringify(inlineJson)}`);

  // 3) /api/gemini/validate-image reachability, SVG, strict boolean isCompatible, legend prefix trim, and fallback without key
  const brokenVal = (await (
    await originalFetch(`${baseUrl}/api/gemini/validate-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageSource: 'https://img.example.org/broken.png' }),
    })
  ).json()) as Record<string, unknown>;
  assert.equal(brokenVal.validated, true);
  assert.equal(brokenVal.reachable, false);
  assert.equal(brokenVal.isCompatible, false);

  const svgVal = (await (
    await originalFetch(`${baseUrl}/api/gemini/validate-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageSource: 'https://img.example.org/vector.svg' }),
    })
  ).json()) as Record<string, unknown>;
  assert.equal(svgVal.validated, false);
  assert.equal(svgVal.fallback, true);
  assert.equal(svgVal.reachable, true);
  assert.equal(svgVal.isSvg, true);

  const compatibleVal = (await (
    await originalFetch(`${baseUrl}/api/gemini/validate-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        imageSource: 'https://img.example.org/valid.png',
        cardQuestion: 'Card Compatível CTG',
      }),
    })
  ).json()) as Record<string, unknown>;
  assert.equal(compatibleVal.validated, true);
  assert.equal(compatibleVal.isCompatible, true);
  assert.equal(compatibleVal.detectedModality, 'ctg');
  assert.equal(String(compatibleVal.visualLegend).startsWith('Legenda visual:'), false);

  const incompatibleVal = (await (
    await originalFetch(`${baseUrl}/api/gemini/validate-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        imageSource: 'https://img.example.org/valid.png',
        cardQuestion: 'Card Conflitante USG',
      }),
    })
  ).json()) as Record<string, unknown>;
  assert.equal(incompatibleVal.validated, true);
  assert.equal(incompatibleVal.isCompatible, false);

  const stringFalseVal = (await (
    await originalFetch(`${baseUrl}/api/gemini/validate-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        imageSource: 'https://img.example.org/valid.png',
        cardQuestion: 'Card String False Bug',
      }),
    })
  ).json()) as Record<string, unknown>;
  assert.strictEqual(stringFalseVal.isCompatible, false);

  delete process.env.GEMINI_API_KEYS;
  const noKeyVal = (await (
    await originalFetch(`${baseUrl}/api/gemini/validate-image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        imageSource: 'https://img.example.org/valid.png',
        cardQuestion: 'Sem Chave',
      }),
    })
  ).json()) as Record<string, unknown>;
  assert.equal(noKeyVal.validated, false);
  assert.equal(noKeyVal.fallback, true);
  assert.equal(noKeyVal.reachable, true);
  assert.equal(noKeyVal.detectedModality, 'unverified');

  // 4) /api/media/proxy-image SSRF protection (direct localhost/private IPs + 302 redirect to 127.0.0.1)
  for (const ssrfUrl of [
    'http://127.0.0.1:8080/secret.png',
    'http://localhost/admin.png',
    'http://169.254.169.254/latest/meta-data',
    'http://192.168.1.50/nas.png',
  ]) {
    const resp = await originalFetch(
      `${baseUrl}/api/media/proxy-image?url=${encodeURIComponent(ssrfUrl)}`
    );
    assert.equal(resp.status, 400, `Expected 400 SSRF block for ${ssrfUrl}`);
  }

  const redirectResp = await originalFetch(
    `${baseUrl}/api/media/proxy-image?url=${encodeURIComponent('https://img.example.org/redirect-ssrf.png')}`
  );
  assert.equal(redirectResp.status >= 400, true);
  assert.equal(
    seenExternalUrls.some((u) => u.includes('127.0.0.1:9999')),
    false,
    'Redirect SSRF target 127.0.0.1 must never be fetched'
  );
});

test('Deleted legacy component DeckToolbar.tsx does not exist on disk', () => {
  const legacyPath = path.resolve(process.cwd(), 'src/components/deck/DeckToolbar.tsx');
  assert.equal(fs.existsSync(legacyPath), false);
});

test('parseOrRecoverClinicalMapJson recovers valid items from truncated /clinical-map JSON and resolveLocalMediaFilename normalizes NFD on external URLs', async () => {
  const { parseOrRecoverClinicalMapJson, isModelOverloadOrQuotaError } = await import('./geminiClient');
  const { resolveLocalMediaFilename } = await import('../src/utils/wozniakLinter');

  const truncatedJson = `{"themeTitle":"Assistência ao Parto e Partograma","specialty":"Obstetrícia","deckKey":"assistencia_parto","profile":"emergencia","guidelineUpdates":["[OMS 2024]: Linha de alerta 1cm/h."],"items":[{"id":"p1-1","priority":"P1","subtopic":"Fase Ativa","concept":"Dilatação >= 5 cm com contrações regulares","guidelineNote":"FEBRASGO","targetCardType":"basic","checked":true},{"id":"p2-1","priority":"P2","subtopic":"Parada Secundária","concept":"Dilatação mantida por 2h`;

  const recovered = parseOrRecoverClinicalMapJson(truncatedJson, 'fallback_deck');
  const guidelineUpdates = recovered.guidelineUpdates as string[];
  const items = recovered.items as Array<Record<string, unknown>>;

  assert.equal(recovered.themeTitle, 'Assistência ao Parto e Partograma');
  assert.equal(recovered.deckKey, 'assistencia_parto');
  assert.equal(guidelineUpdates.length, 1);
  assert.equal(guidelineUpdates[0], '[OMS 2024]: Linha de alerta 1cm/h.');
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'p1-1');

  // 404 / NOT_FOUND / not supported triggers fallback model
  assert.equal(
    isModelOverloadOrQuotaError(new Error('404 NOT_FOUND: models/gemini-4-hydrogen is not found for API version v1beta')),
    true
  );

  // External URL with diacritics -> clean ASCII filename via NFD
  assert.equal(
    resolveLocalMediaFilename(
      '<img src="https://example.org/Diretriz_Pré-Eclâmpsia_Grave.jpg">',
      'https://example.org/Diretriz_Pré-Eclâmpsia_Grave.jpg',
      10,
      0,
      'obstetricia'
    ),
    'diretriz_pre-eclampsia_grave.jpg'
  );
  // Existing local filename with accents -> preserved byte-for-byte for wagmms/Cards compatibility
  assert.equal(
    resolveLocalMediaFilename(
      '<img src="Ficha_Resumo_-_Pré-Natal_p8_fig1.png">',
      'Ficha_Resumo_-_Pré-Natal_p8_fig1.png',
      10,
      0,
      'obstetricia'
    ),
    'Ficha_Resumo_-_Pré-Natal_p8_fig1.png'
  );
});

