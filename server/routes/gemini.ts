import fs from 'fs';
import express, { Request, Response } from 'express';
import { resolveSafeLocalMediaPath } from '../localMediaIndex';
import type { Part } from '@google/genai';
import { ThinkingLevel, Type } from '@google/genai';
import type { CanonicalCard, DomainProfile } from '../../src/types/deck';
import { formatProfilePromptBlock, inferDomainProfile } from '../../src/utils/domainProfiles';
import { lintCard } from '../../src/utils/wozniakLinter';
import {
  buildFullCardsDigest,
  extractErrorDetails,
  extractJsonBlock,
  FALLBACK_GEMINI_MODEL,
  formatGeminiError,
  generateContentWithRetry,
  INTERNATO_SYSTEM_INSTRUCTION,
  isRetryableGeminiError,
  parseGeminiApiKeys,
  parseOrRecoverClinicalMapJson,
  parseOrRecoverJsonArrayField,
  parseOrRecoverNotesJsonWithMeta,
  PRIMARY_GEMINI_MODEL,
  resolveDocumentPartsForGemini,
  resolveGeminiModel,
  sanitizeCardTextForPrompt,
  uploadSinglePdfToGeminiFiles,
  withGeminiKeyRotation,
} from '../geminiClient';

function createRequestAbortSignal(req: Request, res: Response, maxMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`TimeoutError: Tempo limite da rota excedido (${Math.round(maxMs / 1000)}s)`));
  }, maxMs);

  const onClose = () => {
    if (!res.writableFinished) {
      controller.abort(new DOMException('Conexão encerrada pelo cliente.', 'AbortError'));
    }
  };
  res.on('close', onClose);
  req.on('aborted', onClose);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      res.off('close', onClose);
      req.off('aborted', onClose);
    },
  };
}

export function isSafeExternalImageUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      host === 'localhost' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return false;
    }
    if (/^(127\.|10\.|169\.254\.|192\.168\.|0\.)/.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
    if (/^(?:fc00:|fd[0-9a-f]{2}:|fe80:)/i.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function safeFetchWithRedirectValidation(
  rawUrl: string,
  init: RequestInit,
  maxRedirects = 3
): Promise<globalThis.Response> {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isSafeExternalImageUrl(currentUrl)) {
      throw new Error('URL externa inválida ou bloqueada por política SSRF.');
    }
    const resp = await fetch(currentUrl, {
      ...init,
      redirect: 'manual',
    });
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location');
      if (!location || hop === maxRedirects) {
        throw new Error('Redirecionamento excessivo ou inválido ao buscar URL externa.');
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return resp;
  }
  throw new Error('Falha ao seguir redirecionamento seguro.');
}

type FetchedImageResult =
  | { status: 'ok'; mimeType: string; data: string }
  | { status: 'svg' }
  | { status: 'broken'; reason: string }
  | { status: 'fetch_error'; reason: string };

async function resolveImageForMultimodalValidation(
  imageSource: string,
  parentSignal: AbortSignal
): Promise<FetchedImageResult> {
  const src = (imageSource || '').trim();
  if (!src) return { status: 'broken', reason: 'Fonte de imagem vazia.' };

  if (src.startsWith('/api/media/local-file?')) {
    try {
      const parsed = new URL(src, 'http://localhost');
      const rel = parsed.searchParams.get('rel') || '';
      const absPath = resolveSafeLocalMediaPath(rel);
      if (!absPath) return { status: 'broken', reason: 'Arquivo local não encontrado.' };
      const buf = fs.readFileSync(absPath);
      const lower = absPath.toLowerCase();
      const mimeType = lower.endsWith('.png')
        ? 'image/png'
        : lower.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
      return { status: 'ok', mimeType, data: buf.toString('base64') };
    } catch {
      return { status: 'broken', reason: 'Falha ao ler arquivo local.' };
    }
  }

  if (/^data:image\//i.test(src)) {
    const commaIdx = src.indexOf(',');
    if (commaIdx === -1) {
      return { status: 'broken', reason: 'Data URI de imagem inválido.' };
    }
    const header = src.slice(5, commaIdx);
    const body = src.slice(commaIdx + 1);
    const isBase64 = /;base64(?:;|$)/i.test(header);
    let mimeType = header.split(';')[0].trim().toLowerCase();
    if (!mimeType.startsWith('image/')) {
      return { status: 'broken', reason: 'Data URI não possui MIME image/*.' };
    }
    if (mimeType === 'image/jpg') mimeType = 'image/jpeg';

    if (mimeType.includes('svg')) {
      let decoded: Buffer;
      try {
        if (isBase64) {
          const cleanB64 = body.replace(/\s+/g, '');
          if (!cleanB64) return { status: 'broken', reason: 'SVG data URI vazio.' };
          decoded = Buffer.from(cleanB64, 'base64');
        } else {
          decoded = Buffer.from(decodeURIComponent(body), 'utf8');
        }
      } catch {
        return { status: 'broken', reason: 'Data URI SVG malformado.' };
      }
      if (decoded.length < 64) {
        return { status: 'broken', reason: 'SVG embutido vazio ou corrompido.' };
      }
      if (decoded.length > 6 * 1024 * 1024) {
        return { status: 'fetch_error', reason: 'SVG embutido excede limite de 6MB.' };
      }
      return { status: 'svg' };
    }

    if (!isBase64) {
      return { status: 'broken', reason: 'Data URI raster precisa estar em base64.' };
    }
    if (!/^image\/(?:jpeg|png|webp|gif)$/.test(mimeType)) {
      return { status: 'fetch_error', reason: `MIME não suportado para visão: ${mimeType}` };
    }
    const base64Body = body.replace(/\s+/g, '');
    if (base64Body.length < 16) {
      return { status: 'broken', reason: 'Imagem base64 vazia ou corrompida.' };
    }
    if (base64Body.length > 8_200_000) {
      return { status: 'fetch_error', reason: 'Imagem base64 excede limite de 6MB.' };
    }
    const decodedRaster = Buffer.from(base64Body, 'base64');
    if (decodedRaster.length < 64) {
      return { status: 'broken', reason: 'Imagem base64 truncada ou corrompida.' };
    }
    return { status: 'ok', mimeType, data: base64Body };
  }

  if (!isSafeExternalImageUrl(src)) {
    return { status: 'broken', reason: 'URL de imagem externa inválida ou bloqueada.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Image fetch timeout')), 8500);
  const onParentAbort = () => controller.abort(parentSignal.reason);
  if (parentSignal.aborted) {
    clearTimeout(timer);
    return { status: 'fetch_error', reason: 'Requisição abortada.' };
  }
  parentSignal.addEventListener('abort', onParentAbort, { once: true });

  try {
    const upstream = await safeFetchWithRedirectValidation(src, {
      headers: {
        'User-Agent':
          'InternatoFirstCardArchitect/2.0 (https://aistudio.google.com; medical-education)',
        Accept: 'image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/*;q=0.8',
      },
      signal: controller.signal,
    });

    if (upstream.status === 404 || upstream.status === 410) {
      return { status: 'broken', reason: `URL retornou HTTP ${upstream.status}.` };
    }
    if (!upstream.ok) {
      return {
        status: 'fetch_error',
        reason: `Falha temporária ao baixar imagem (HTTP ${upstream.status}).`,
      };
    }

    let contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType === 'image/jpg') contentType = 'image/jpeg';

    if (contentType.includes('svg')) {
      const svgBuf = Buffer.from(await upstream.arrayBuffer());
      if (svgBuf.length < 128) {
        return { status: 'broken', reason: 'Arquivo SVG vazio ou corrompido.' };
      }
      if (svgBuf.length > 6 * 1024 * 1024) {
        return { status: 'fetch_error', reason: 'SVG externo excede 6MB.' };
      }
      const head = svgBuf.subarray(0, 512).toString('utf8').toLowerCase();
      if (head.includes('<!doctype html') || head.includes('<html')) {
        return { status: 'broken', reason: 'URL retornou página HTML em vez de SVG.' };
      }
      return { status: 'svg' };
    }

    if (!contentType.startsWith('image/')) {
      if (contentType.includes('text/html') || contentType.includes('application/json')) {
        return { status: 'broken', reason: `URL retornou ${contentType} em vez de imagem.` };
      }
      if (/\.png(?:\?|$)/i.test(src)) contentType = 'image/png';
      else if (/\.webp(?:\?|$)/i.test(src)) contentType = 'image/webp';
      else if (/\.gif(?:\?|$)/i.test(src)) contentType = 'image/gif';
      else if (/\.jpe?g(?:\?|$)/i.test(src)) contentType = 'image/jpeg';
      else return { status: 'broken', reason: 'Conteúdo retornado não é imagem raster.' };
    }

    if (!/^image\/(?:jpeg|png|webp|gif)$/.test(contentType)) {
      return { status: 'fetch_error', reason: `Formato de imagem não suportado: ${contentType}` };
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length < 256) {
      return { status: 'broken', reason: 'Arquivo de imagem vazio ou corrompido.' };
    }
    if (buf.length > 6 * 1024 * 1024) {
      return { status: 'fetch_error', reason: 'Imagem externa excede 6MB.' };
    }
    return { status: 'ok', mimeType: contentType, data: buf.toString('base64') };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro ao baixar imagem externa.';
    if (/política SSRF|Redirecionamento/i.test(msg)) {
      return { status: 'broken', reason: msg };
    }
    return { status: 'fetch_error', reason: msg };
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener('abort', onParentAbort);
  }
}

function resolveEffectiveDomainProfile(
  requestedProfile: unknown,
  deckKey: string,
  textHint = ''
): DomainProfile {
  const validProfiles: DomainProfile[] = [
    'emergencia',
    'ambulatorio',
    'cirurgico',
    'preventiva_normativo',
  ];
  if (
    typeof requestedProfile === 'string' &&
    validProfiles.includes(requestedProfile as DomainProfile)
  ) {
    return requestedProfile as DomainProfile;
  }
  return inferDomainProfile(deckKey, textHint);
}

function formatPdfImagesCatalogBlock(pdfImagesCatalog: unknown): string {
  if (!Array.isArray(pdfImagesCatalog) || pdfImagesCatalog.length === 0) {
    return '';
  }
  const lines = pdfImagesCatalog
    .slice(0, 120)
    .map((item) => {
      const rec = (item || {}) as Record<string, unknown>;
      const id = sanitizeCardTextForPrompt(rec.id, 60);
      if (!id) return null;
      const pdfName = sanitizeCardTextForPrompt(rec.pdfName, 50) || 'material.pdf';
      const pageNum = Number(rec.pageNumber) || 1;
      const caption = sanitizeCardTextForPrompt(rec.captionHint, 90);
      const snippet = sanitizeCardTextForPrompt(rec.pageTextSnippet, 140);
      const desc = [caption, snippet].filter(Boolean).join(' — ');
      return `  * pdfimg:${id} | ${pdfName} (Pág. ${pageNum})${desc ? ` | Contexto: ${desc}` : ''}`;
    })
    .filter(Boolean);

  if (lines.length === 0) return '';
  return `\nCATÁLOGO DE IMAGENS EXTRAÍDAS DOS MATERIAIS ANEXADOS (prefira <img src="pdfimg:ID_EXATO"> quando houver correspondência clínica; caso contrário use <img src="buscar_imagem: termo clínico">):\n${lines.join('\n')}\n`;
}

function formatVerifiedGuidelinesBlock(clinicalMap: unknown): string {
  const mapRec = (clinicalMap || {}) as { guidelineUpdates?: unknown };
  const updates = Array.isArray(mapRec.guidelineUpdates)
    ? mapRec.guidelineUpdates
        .map((u) => sanitizeCardTextForPrompt(u, 280))
        .filter(Boolean)
        .slice(0, 15)
    : [];
  if (updates.length === 0) return '';
  return `\nDIRETRIZES ATUALIZADAS VERIFICADAS (FONTE DE VERDADE CLÍNICA — aplique estas doses, esquemas e prazos nos cards):\n${updates
    .map((u) => `- ${u}`)
    .join('\n')}\n`;
}

function sanitizeReturnedNotes(
  notes: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return (Array.isArray(notes) ? notes : [])
    .filter((n) => n && typeof n === 'object')
    .map((n) => {
      const copy: Record<string, unknown> = { ...n };
      delete copy.sources;
      const rawType = String(copy.type || 'basic').trim().toLowerCase();
      const qStr = String(copy.question || '');
      const aStr = String(copy.answer || '').trim();
      const hasSilentCloze = /\{\{c\d+::[\s\S]+?\}\}/.test(qStr) && !aStr;
      copy.type = rawType === 'cloze' || hasSilentCloze ? 'cloze' : 'basic';
      if (copy.type === 'cloze') {
        copy.answer = '';
      }
      return copy;
    });
}

export interface NormalizedAuditVerdictItem {
  cardId: number;
  verdict: 'keep' | 'rebuild' | 'split' | 'prune';
  score: number;
  reason: string;
  clinicalIssue?: string;
  targetConcept: string;
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  suggestedType: 'basic' | 'cloze';
}

export function applyDeterministicAuditGuard(
  c: Record<string, unknown>,
  existing?: NormalizedAuditVerdictItem
): NormalizedAuditVerdictItem {
  const cid = Number(c.id);
  const plainQ = String(c.question || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const plainA = String(c.answer || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const plainHint = String(c.hint || '')
    .replace(/<table[\s\S]*?<\/table>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/Coment[áa]rio:/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const hasVaguePrompt =
    !/\b(?:imediata|imediato|inicial|primeira\s+(?:escolha|linha)|1[ªa]\s+(?:escolha|linha)|definitiv[ao]|ambulatorial|de\s+minuto\s+zero|diagn[oó]stic[ao])\b/i.test(plainQ) &&
    /(?:\bqual\s+(?:é\s+)?(?:a\s+conduta|o\s+manejo|o\s+pr[oó]ximo\s+passo|o\s+tratamento)|como\s+conduzir|o\s+que\s+fazer)\s*\?\s*$/i.test(plainQ);
  const isPassivePrompt = /^\s*(?:o\s+que\s+[eé]\s+|defina\s+|fale\s+sobre\s+)/i.test(plainQ);
  const hasOrphanDeixis =
    !/<img\b/i.test(`${String(c.question || '')} ${String(c.hint || '')}`) &&
    /\b(?:ecg|tra[çc]ado|exame|imagem|rx|usg|tc|ctg)\s+(?:abaixo|acima|em\s+anexo)\b/i.test(plainQ);
  const hasMissingBasicAnswer = String(c.type || 'basic').toLowerCase() === 'basic' && !plainA;
  const hasShortComment = plainHint.length < 100;

  const rawQ = String(c.question || '');
  const rawHint = String(c.hint || '');
  const cardForLint: CanonicalCard = {
    id: Number.isFinite(cid) ? cid : 0,
    type: String(c.type || '').toLowerCase() === 'cloze' || /\{\{c\d+::/.test(rawQ) ? 'cloze' : 'basic',
    topic: String(c.topic || ''),
    question: rawQ,
    answer: String(c.answer || ''),
    hint: rawHint,
    image_mode:
      c.image_mode === 'recognition' || c.image_mode === 'feedback' ? c.image_mode : undefined,
  };
  const lintResult = lintCard(cardForLint);
  const hasFragmentedSeriesTopic = /\(\s*\d+\s*\/\s*\d+\s*\)\s*$/.test(String(c.topic || '').trim());
  const splitCodes = new Set(['CLOZE_COUNT_INVALID', 'COMPOUND_QUESTION', 'ANSWER_HAS_SEMICOLON']);
  const rebuildCodes = new Set([
    'TOPIC_SPOILER',
    'CLOZE_HAS_HINT',
    'ANSWER_TOO_LONG',
    'LEGACY_MARKERS',
    'COMMENT_TOO_LONG',
    'QUESTION_PAREN_SPOILER',
    'NIELSEN_PASSIVE_OR_BINARY',
    'ORPHAN_VISUAL_REFERENCE',
    'REDUNDANT_VISUAL_DESCRIPTION',
  ]);
  const splitIssue = lintResult.warnings.find((iss) => splitCodes.has(iss.code));
  const rebuildIssue = lintResult.warnings.find((iss) => rebuildCodes.has(iss.code));

  const deterministicSplitReason = splitIssue ? splitIssue.message : '';

  const deterministicRebuildReason = hasOrphanDeixis
    ? 'Referência visual ("abaixo"/"em anexo") sem imagem anexada.'
    : hasMissingBasicAnswer
    ? 'Card basic com resposta vazia.'
    : hasVaguePrompt
    ? 'Comando vago sem janela temporal ou linha terapêutica.'
    : isPassivePrompt
    ? 'Definição passiva sem vinheta ou decisão clínica.'
    : hasFragmentedSeriesTopic
    ? 'Série fragmentada artificialmente (1/3, 2/3, 3/3) — consolidar ou podar redundâncias.'
    : rebuildIssue
    ? rebuildIssue.message
    : hasShortComment
    ? `Comentário muito curto (${plainHint.length} chars) sem contraste diferencial adequado.`
    : '';

  if (existing) {
    if (existing.verdict === 'keep' && deterministicSplitReason) {
      return {
        ...existing,
        verdict: 'split',
        score: Math.min(existing.score, 5),
        reason: `${deterministicSplitReason} Desmembrar em cards atômicos.`,
      };
    }
    if (existing.verdict === 'keep' && deterministicRebuildReason) {
      return {
        ...existing,
        verdict: 'rebuild',
        score: Math.min(existing.score, 5),
        reason: `${deterministicRebuildReason} Refazer do zero segundo Matuschak & Nielsen.`,
      };
    }
    return existing;
  }
  const validPriorities = new Set(['P1', 'P2', 'P3', 'P4']);
  const fallbackVerdict = deterministicSplitReason
    ? 'split'
    : deterministicRebuildReason
    ? 'rebuild'
    : 'keep';
  return {
    cardId: cid,
    verdict: fallbackVerdict,
    score: fallbackVerdict === 'keep' ? 8 : 5,
    reason: deterministicSplitReason
      ? `${deterministicSplitReason} Desmembrar em cards atômicos.`
      : deterministicRebuildReason
      ? `${deterministicRebuildReason} Refazer do zero segundo Matuschak & Nielsen.`
      : 'Mantido após auditoria geral.',
    targetConcept: sanitizeCardTextForPrompt(c.topic, 140) || 'Conceito clínico do card.',
    priority: (validPriorities.has(String(c.priority || '').toUpperCase())
      ? String(c.priority).toUpperCase()
      : 'P2') as 'P1' | 'P2' | 'P3' | 'P4',
    suggestedType: (c.type === 'cloze' ? 'cloze' : 'basic') as 'basic' | 'cloze',
  };
}

export function createGeminiRouter(): express.Router {
  const router = express.Router();

  // Pré-upload individual de PDF para a Gemini Files API
  router.post('/upload-file', async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 90_000);
    try {
      const { name = 'documento.pdf', mimeType = 'application/pdf', base64Data = '' } = req.body || {};
      if (!base64Data || typeof base64Data !== 'string') {
        return res.status(400).json({ error: 'Arquivo base64Data ausente.' });
      }
      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error:
            'Chave GEMINI_API_KEY não configurada no ambiente. Configure sua chave no painel Settings > Secrets.',
        });
      }
      const uploaded = await withGeminiKeyRotation(
        (ai, keyFp) =>
          uploadSinglePdfToGeminiFiles(
            ai,
            { name, mimeType, base64Data },
            signal,
            keyFp
          ),
        signal
      );
      if (res.writableEnded) return;
      return res.json({
        fileUri: uploaded.uri,
        fileName: uploaded.name,
        mimeType: uploaded.mimeType,
        fileSha256: uploaded.fileSha256,
        keyFingerprint: uploaded.keyFingerprint,
      });
    } catch (error: unknown) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, 'Erro ao enviar PDF para a Gemini Files API.'),
      });
    } finally {
      cleanup();
    }
  });

  // Passo 1 — Gerar Mapa Clínico (P1 a P4) + Atualizações de Diretrizes
  router.post('/clinical-map', async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 210_000);
    try {
      const {
        deckKey = 'tema_clinico_internato',
        profile = 'auto',
        pdfs = [],
        existingJsonSummary = '',
        useGoogleSearch = true,
        model: requestedModel,
      } = req.body || {};
      const activeModel = resolveGeminiModel(requestedModel);

      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error:
            'Chave GEMINI_API_KEY não configurada no ambiente. Configure sua chave no painel Settings > Secrets.',
        });
      }

      const effectiveProfile = resolveEffectiveDomainProfile(
        profile,
        deckKey,
        existingJsonSummary
      );
      const profilePromptBlock = formatProfilePromptBlock(effectiveProfile);

      // Estágio 1: Pesquisa Clínica Multi-Eixo dedicada via Google Search Grounding (sem disputa com JSON)
      let groundedDossierText = '';
      let groundedSources: Array<{ title: string; uri: string }> = [];
      let groundedSearchQueries: string[] = [];
      let googleSearchUsed = false;

      if (useGoogleSearch) {
        const searchPrompt = `Realize múltiplas consultas no Google Search para levantar um dossiê clínico COMPLETO e ATUALIZADO (2023–2026) sobre o tema "${deckKey}" (perfil de domínio: ${effectiveProfile}).
${existingJsonSummary ? `Contexto resumido dos cards já existentes no baralho:\n${existingJsonSummary}\n` : ''}
PESQUISE OBRIGATORIAMENTE OS 6 EIXOS ABAIXO (use várias buscas específicas por fonte brasileira e internacional — Ministério da Saúde / PCDT, FEBRASGO, SBC, SBP, SBGG, AMB, CFM, CDC, WHO):
1. Diagnóstico, critérios classificatórios, estadiamento e pontos de corte laboratoriais/imagem atualizados.
2. Tratamento de 1ª linha (drogas, doses exatas, via, intervalo e duração) e critérios claros de internação vs. manejo ambulatorial.
3. Regimes alternativos e populações especiais (gestantes, lactantes, alergia a beta-lactâmicos/fármaco-chave, disfunção renal/hepática, pediatria/idoso).
4. Profilaxias (PEP/PrEP/antibioticoprofilaxia/imunização), rastreamento e manejo de parcerias sexuais ou contactantes (janelas e prazos).
5. Sinais de alarme, complicações graves, falha terapêutica, tempo-dependência e critérios de retorno/seguimento.
6. Normas éticas, legais e vigilância epidemiológica (notificação compulsória imediata vs. semanal, prazos, sigilo, B.O./autorização judicial quando aplicável).

Organize a resposta em tópicos objetivos por eixo, sempre citando a fonte e o ano da diretriz encontrada, doses completas e mudanças recentes de protocolo.`;

        try {
          const searchResult = await withGeminiKeyRotation(
            (ai) =>
              generateContentWithRetry(
                ai,
                {
                  model: activeModel,
                  contents: searchPrompt,
                  config: {
                    maxOutputTokens: 16384,
                    thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
                    tools: [{ googleSearch: {} }],
                  },
                },
                { signal, timeoutMs: 85_000, enableModelFallback: true }
              ),
            signal
          );
          groundedDossierText = (searchResult.text || '').trim();
          groundedSources = searchResult.groundingSources || [];
          groundedSearchQueries = searchResult.searchQueries || [];
          googleSearchUsed =
            groundedSources.length > 0 ||
            groundedSearchQueries.length > 0 ||
            groundedDossierText.length > 120;
        } catch (searchErr) {
          if (signal.aborted) {
            throw searchErr;
          }
          console.warn(
            '[clinical-map] Stage 1 googleSearch failed, falling back gracefully to Stage 2 (PDFs + internal knowledge):',
            extractErrorDetails(searchErr)
          );
          googleSearchUsed = false;
        }
      }

      const dossierBlock = groundedDossierText
        ? `\nDOSSIÊ CLÍNICO OBTIDO VIA GOOGLE SEARCH GROUNDING (USE ESTES DADOS E FONTES COMO BASE):\n${groundedDossierText.slice(0, 14000)}\n`
        : '';

      const prompt = `Analise os documentos PDF anexados (se houver), o dossiê de diretrizes pesquisado e o tema médico indicado pela Deck Key "${deckKey}".
${existingJsonSummary ? `Resumo do deck atual enviado pelo usuário:\n${existingJsonSummary}\n` : ''}${dossierBlock}
${profilePromptBlock}

Gere um Mapa Clínico estruturado segundo a Doutrina Internato-First (P1 a P4) ADAPTADA ESTRITAMENTE AO PERFIL DE DOMÍNIO "${effectiveProfile}" acima para guiar a criação/recriação do deck.
- Não force cenário de "Sala Vermelha" nem viés obstétrico/de emergência se o tema pertencer a outro perfil!
- Inclua em P2 conceitos de Reconhecimento Visual de exames/imagens reais da internet APENAS quando exames complementares visuais fizerem sentido para o tema (ex.: ECG, RX, TC, USG, CTG, dermoscopia, fundoscopia, lâminas). Para temas normativos/ética/legais sem exame de imagem típico, foque P2 em documentação, prazos e interpretação de medidas/indicadores.
- Aplique o Filtro Negativo: exclua genética de bancada, história da medicina e epidemiologia percentual que não mude conduta.

REQUISITO DE PROFUNDIDADE PARA "guidelineUpdates":
- Retorne entre **7 e 12 pontos clínicos detalhados, densos e acionáveis** (NUNCA retorne apenas 2 ou 3 resumos genéricos!).
- Cubra múltiplos eixos do tema: diagnóstico/pontos de corte, 1ª linha com doses e duração exatas, critérios de internação/gravidade, regimes alternativos (gestante/alergia/disfunção orgânica), profilaxias/parcerias/vacinas, complicações/seguimento e normas ético-legais/notificação quando pertinente.
- Formate cada item iniciando com "[Eixo · Fonte/Ano]: ..." (ex.: "[1ª Linha · PCDT IST/MS 2025]: ...").

Retorne EXCLUSIVAMENTE um objeto JSON válido (sem comentários fora do JSON) no seguinte formato exato:
{
  "themeTitle": "Nome Completo do Tema Médico",
  "specialty": "Especialidade (Clínica / Cirurgia / GO / Pediatria / Preventiva / Ética)",
  "deckKey": "${deckKey}",
  "profile": "${effectiveProfile}",
  "guidelineUpdates": [
    "[Diagnóstico · Fonte/Ano]: Critério objetivo, escore ou ponto de corte que muda conduta...",
    "[1ª Linha · Fonte/Ano]: Esquema completo com droga, dose, via, intervalo e duração...",
    "[Alternativa/Gestante · Fonte/Ano]: Opção segura ou ajuste na alergia/gestação/disfunção...",
    "[Profilaxia/Parcerias · Fonte/Ano]: Janela temporal, vacina/imunoglobulina ou tratamento de contactantes...",
    "[Internação/Alarme · Fonte/Ano]: Critérios objetivos de internação, falha terapêutica ou gravidade...",
    "[Vigilância/Norma · Fonte/Ano]: Notificação compulsória, prazo, sigilo ou fluxo legal aplicável..."
  ],
  "items": [
    {
      "id": "p1-1",
      "priority": "P1",
      "subtopic": "Subtema clínico sem spoiler",
      "concept": "Conceito P1 adequado ao perfil ativo (decisão de maior impacto, critério crítico ou norma/sigilo obrigatório)",
      "guidelineNote": "Referência ou destaque USP/Unicamp/Diretriz/Lei",
      "targetCardType": "basic",
      "checked": true
    }
  ]
}
Gere entre ${Array.isArray(pdfs) && pdfs.length > 0 || String(existingJsonSummary || '').trim() ? '12 e 20' : '10 e 16'} itens distribuídos em P1, P2, P3 e P4 de acordo com o perfil "${effectiveProfile}", cobrindo integralmente os sub-eixos clínicos e de exames complementares do tema (ex.: se cardiologia/ECG, cubra paredes do IAM, supra vs infra, TPSV, FA/Flutter, BAVs, BRD/BRE, WPW/Brugada e emergências metabólicas) e escolhendo fluidamente targetCardType ("basic" para decisão clínica/diferencial/mecanismo/imagem e "cloze" para critérios numéricos/limiares/doses em âncora), sem cota percentual rígida.`;

      const result = await withGeminiKeyRotation(async (ai, keyFp) => {
        const parts: Part[] = await resolveDocumentPartsForGemini(ai, pdfs, signal, keyFp);
        parts.push({ text: prompt });
        return generateContentWithRetry(
          ai,
          {
            model: activeModel,
            contents: { parts },
            config: {
              systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
              maxOutputTokens: 32768,
              responseMimeType: 'application/json',
              thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
            },
          },
          { signal, timeoutMs: 120_000, enableModelFallback: true }
        );
      }, signal);

      if (res.writableEnded) return;
      const rawText = result.text || '{}';
      const parsed = parseOrRecoverClinicalMapJson(rawText, deckKey);

      const mergedSources =
        groundedSources.length > 0
          ? groundedSources
          : result.groundingSources.length > 0
          ? result.groundingSources
          : parsed.groundingSources || [];

      return res.json({
        ...parsed,
        deckKey: parsed.deckKey || deckKey,
        profile: resolveEffectiveDomainProfile(
          parsed.profile || profile,
          deckKey,
          existingJsonSummary
        ),
        modelUsed: result.modelUsed,
        groundingSources: mergedSources,
        searchQueries:
          groundedSearchQueries.length > 0
            ? groundedSearchQueries
            : result.searchQueries || [],
        googleSearchUsed,
      });
    } catch (error: unknown) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, 'Erro ao gerar o Mapa Clínico com Gemini.'),
      });
    } finally {
      cleanup();
    }
  });

  // Passo 1b — Aprofundar Diretrizes via Google Search Grounding (expande pontos e fontes sob demanda)
  router.post('/deepen-guidelines', async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 120_000);
    try {
      const {
        deckKey = 'tema_clinico_internato',
        themeTitle = '',
        profile = 'auto',
        focusQuery = '',
        existingUpdates = [],
        model: requestedModel,
      } = req.body || {};
      const activeModel = resolveGeminiModel(requestedModel);

      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error:
            'Chave GEMINI_API_KEY não configurada no ambiente. Configure sua chave no painel Settings > Secrets.',
        });
      }

      const effectiveProfile = resolveEffectiveDomainProfile(profile, deckKey, themeTitle);
      const cleanExisting = Array.isArray(existingUpdates)
        ? existingUpdates.map((u) => sanitizeCardTextForPrompt(u, 220)).filter(Boolean).slice(0, 20)
        : [];
      const cleanFocus = sanitizeCardTextForPrompt(focusQuery, 180);

      const searchPrompt = `Você é um preceptor médico brasileiro atualizando diretrizes para prova de Residência (USP/Unicamp) e Internato via Google Search.
Tema: "${themeTitle || deckKey}" (perfil: ${effectiveProfile}).
${cleanFocus ? `FOCO SOLICITADO PELO USUÁRIO: "${cleanFocus}".` : 'FOCO: Expanda subtópicos críticos ainda NÃO detalhados abaixo (ex.: esquemas de 2ª linha, gestantes/alergias, doses pediátricas/ajuste renal, critérios de internação/alta, vacinas/rastreamento, complicações e atualizações recentes 2024–2026).'}

PONTOS JÁ COBERTOS (NÃO REPITA ESTES):
${cleanExisting.length > 0 ? cleanExisting.map((u) => `- ${u}`).join('\n') : '(nenhum ainda)'}

Pesquise no Google Search diretrizes oficiais (MS/PCDT, FEBRASGO, SBC, SBP, AMB, CFM, CDC, WHO) e traga de 5 a 8 NOVOS achados clínicos objetivos com fonte, ano, doses exatas, pontos de corte e condutas específicas.`;

      const searchResult = await withGeminiKeyRotation(
        (ai) =>
          generateContentWithRetry(
            ai,
            {
              model: activeModel,
              contents: searchPrompt,
              config: {
                maxOutputTokens: 12288,
                thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
                tools: [{ googleSearch: {} }],
              },
            },
            { signal, timeoutMs: 75_000, enableModelFallback: true }
          ),
        signal
      );

      if (signal.aborted || res.writableEnded) return;

      const synthPrompt = `Extraia do dossiê pesquisado abaixo entre 5 e 8 NOVOS pontos clínicos concisos e de alto rendimento para o tema "${themeTitle || deckKey}", sem repetir nenhum dos pontos já cobertos.
Cada string deve seguir o padrão "[Eixo · Fonte/Ano]: recomendação exata com doses, cortes ou prazos".

PONTOS JÁ COBERTOS:
${cleanExisting.map((u) => `- ${u}`).join('\n')}

DOSSIÊ PESQUISADO:
${(searchResult.text || '').slice(0, 12000)}

Retorne EXCLUSIVAMENTE um JSON válido:
{
  "newUpdates": [
    "[Eixo · Fonte/Ano]: ..."
  ]
}`;

      const synthResult = await withGeminiKeyRotation(
        (ai) =>
          generateContentWithRetry(
            ai,
            {
              model: activeModel,
              contents: synthPrompt,
              config: {
                responseMimeType: 'application/json',
                maxOutputTokens: 4096,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              },
            },
            { signal, timeoutMs: 40_000, enableModelFallback: true }
          ),
        signal
      );

      if (res.writableEnded) return;
      const parsed = JSON.parse(extractJsonBlock(synthResult.text || '{}')) as {
        newUpdates?: unknown[];
      };
      const newUpdates = Array.isArray(parsed?.newUpdates)
        ? parsed.newUpdates.map((u) => String(u || '').trim()).filter(Boolean)
        : [];

      return res.json({
        newUpdates,
        groundingSources: searchResult.groundingSources || [],
        searchQueries: searchResult.searchQueries || [],
        modelUsed: searchResult.modelUsed,
      });
    } catch (error: unknown) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, 'Erro ao aprofundar pesquisa de diretrizes no Google.'),
      });
    } finally {
      cleanup();
    }
  });

  // Passo 1c — Auditoria Card-a-Card de Baralho Antigo (Keep / Rebuild / Split / Prune)
  router.post('/audit-deck', async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 180_000);
    try {
      const {
        deckKey = 'tema_clinico_internato',
        cards = [],
        clinicalMap = null,
        pdfs = [],
        model: requestedModel,
      } = req.body || {};
      const activeModel = resolveGeminiModel(requestedModel);

      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error:
            'Chave GEMINI_API_KEY não configurada no ambiente. Configure sua chave no painel Settings > Secrets.',
        });
      }

      const inputCards = Array.isArray(cards) ? cards : [];
      if (inputCards.length === 0) {
        return res.json({
          deckKey,
          overallSummary: 'Nenhum card prévio enviado para auditoria.',
          counts: { keep: 0, rebuild: 0, split: 0, prune: 0 },
          items: [],
        });
      }

      const effectiveProfile = resolveEffectiveDomainProfile(
        clinicalMap?.profile,
        deckKey,
        `${clinicalMap?.themeTitle || ''} ${clinicalMap?.specialty || ''}`
      );
      const profilePromptBlock = formatProfilePromptBlock(effectiveProfile);
      const guidelinesBlock = formatVerifiedGuidelinesBlock(clinicalMap);
      const checkedMapItems = Array.isArray(clinicalMap?.items)
        ? clinicalMap.items.filter((i: { checked?: boolean }) => i.checked !== false)
        : [];
      const AUDIT_CHUNK_SIZE = 120;
      const chunks: Array<Array<Record<string, unknown>>> = [];
      for (let i = 0; i < inputCards.length; i += AUDIT_CHUNK_SIZE) {
        chunks.push(inputCards.slice(i, i + AUDIT_CHUNK_SIZE));
      }

      const allRawItems: Array<Record<string, unknown>> = [];
      let overallSummary = '';
      let lastModelUsed = activeModel;

      for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        const chunk = chunks[chunkIdx];
        const cardsDigest = buildFullCardsDigest(
          chunk.map((c: Record<string, unknown>) => ({
            id: c.id,
            type: c.type,
            priority: c.priority,
            topic: c.topic,
            question: c.question,
            answer: c.answer,
            hint: c.hint,
          }))
        );

        const prompt = `Você é o Auditor Chefe de Qualidade Clínica e Pedagógica (Matuschak & Nielsen + Diretrizes Médicas Brasileiras) avaliando UM BARALHO EXISTENTE para o tema "${deckKey}"${chunks.length > 1 ? ` (Lote ${chunkIdx + 1}/${chunks.length})` : ''}.
Analise cada card abaixo individualmente comparando-o com os PDFs anexados, o Mapa Clínico P1–P4 e as diretrizes atualizadas.

${profilePromptBlock}${guidelinesBlock}
MAPA CLÍNICO P1–P4 DE REFERÊNCIA:
${checkedMapItems.length > 0 ? JSON.stringify(checkedMapItems, null, 2) : 'Avalie conforme matriz P1–P4 do tema.'}

CARDS EXISTENTES PARA JULGAMENTO (JULGUE TODOS OS ${chunk.length} CARDS DESTE LOTE):
${cardsDigest}

CRITÉRIOS DE VEREDITO POR CARD ("verdict"):
- "keep": Card já está excelente (nota >= 8/10): decisão atômica clara, clinicamente atualizada e correta segundo os PDFs/diretrizes, sem spoiler, sem lista disfarçada, "hint" com ≥ 120 chars visíveis e contraste diferencial, E com tag <img ...> caso o tópico exija reconhecimento visual (ECG/RX/USG/TC/CTG/lesão). NUNCA atribua "keep" a pergunta vaga ("Qual a conduta?", "Qual o manejo?", "O que fazer?"), definição passiva ("O que é X?"), card sem imagem em reconhecimento visual ou comentário raso (< 110 chars).
- "rebuild": Card cobre um conceito clínico útil/importante, PORÉM está fraco (pergunta vaga como "Qual a conduta?", "Qual o manejo?", "O que fazer?", definição passiva "O que é...", resposta longa/lista, spoiler no enunciado/tópico, dose ou critério desatualizado/impreciso, comentário raso ou exame visual sem <img>). DEVE SER REFEITO DO ZERO!
- "split": Card mistura 2 ou mais decisões clínicas diferentes no mesmo card (ex.: diagnóstico + tratamento, parede + artéria, achado + antiarrítmico, ou múltiplos esquemas/critérios) e precisa ser desdobrado em cards atômicos separados.
- "prune": Card DEVE ser excluído (poda rigorosa Internato-First) se for: (1) duplicata semântica ou redundância conceitual cruzada (mesmo sinal/epônimo/critério já cobrado em outro card mais completo do deck); (2) fisiologia/anatomia teórica pura, medidas anatômicas estáticas sem impacto na conduta, detalhes técnicos de subespecialista fora da alçada do interno, propedêutica passiva substituída por conduta padrão atual, modelo/escore obsoleto substituído por diretriz vigente ou epônimo raro sem impacto à beira-leito; (3) preenchimento trivial sem alavanca clínica real; ou (4) reprovado pelo Filtro Negativo (história da medicina, datas, genética/biologia molecular de bancada sem conduta).

Retorne EXCLUSIVAMENTE um objeto JSON válido:
{
  "overallSummary": "Resumo executivo de 1 a 2 frases sobre a qualidade atual do deck e o que precisa ser reconstruído.",
  "items": [
    {
      "cardId": 171000101,
      "verdict": "rebuild",
      "score": 4,
      "reason": "Pergunta vaga e cloze longo; misturando 1ª linha e dose em lista.",
      "clinicalIssue": "Esquema ou critério desatualizado/impreciso (opcional se não houver erro clínico).",
      "targetConcept": "Conduta ou critério exato que este card deveria testar (1 frase clara).",
      "priority": "P1",
      "suggestedType": "basic"
    }
  ]
}`;

        const response = await withGeminiKeyRotation(async (ai, keyFp) => {
          const parts: Part[] = await resolveDocumentPartsForGemini(ai, pdfs, signal, keyFp);
          parts.push({ text: prompt });
          return generateContentWithRetry(
            ai,
            {
              model: activeModel,
              contents: { parts },
              config: {
                systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
                responseMimeType: 'application/json',
                maxOutputTokens: 32768,
                thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
              },
            },
            { signal, timeoutMs: 140_000, enableModelFallback: true }
          );
        }, signal);

        if (res.writableEnded) return;
        lastModelUsed = response.modelUsed || lastModelUsed;
        const rawText = response.text || '{}';
        const { items: chunkItems } = parseOrRecoverJsonArrayField(rawText, 'items', [
          'cardId',
          'verdict',
        ]);
        allRawItems.push(...chunkItems);

        if (!overallSummary) {
          try {
            const full = JSON.parse(extractJsonBlock(rawText)) as { overallSummary?: unknown };
            overallSummary = String(full?.overallSummary || '').trim();
          } catch {
            const sumMatch = rawText.match(/"overallSummary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            if (sumMatch?.[1]) {
              try {
                overallSummary = JSON.parse(`"${sumMatch[1]}"`);
              } catch {
                overallSummary = sumMatch[1];
              }
            }
          }
        }
      }

      const rawItems = allRawItems;

      const validVerdicts = new Set(['keep', 'rebuild', 'split', 'prune']);
      const validPriorities = new Set(['P1', 'P2', 'P3', 'P4']);
      const itemMap = new Map<number, {
        cardId: number;
        verdict: 'keep' | 'rebuild' | 'split' | 'prune';
        score: number;
        reason: string;
        clinicalIssue?: string;
        targetConcept: string;
        priority: 'P1' | 'P2' | 'P3' | 'P4';
        suggestedType: 'basic' | 'cloze';
      }>();

      for (const raw of rawItems) {
        const cardId = Number(raw.cardId);
        if (!Number.isFinite(cardId)) continue;
        const vRaw = String(raw.verdict || 'rebuild').toLowerCase().trim();
        const verdict = (validVerdicts.has(vRaw) ? vRaw : 'rebuild') as
          | 'keep'
          | 'rebuild'
          | 'split'
          | 'prune';
        const pRaw = String(raw.priority || 'P2').toUpperCase().trim();
        const priority = (validPriorities.has(pRaw) ? pRaw : 'P2') as 'P1' | 'P2' | 'P3' | 'P4';
        const scoreNum = Number(raw.score);
        const score = Number.isFinite(scoreNum)
          ? Math.max(0, Math.min(10, Math.round(scoreNum)))
          : verdict === 'keep'
            ? 8
            : 5;
        itemMap.set(cardId, {
          cardId,
          verdict,
          score,
          reason: sanitizeCardTextForPrompt(raw.reason, 220) || 'Avaliado pela auditoria clínica.',
          ...(raw.clinicalIssue
            ? { clinicalIssue: sanitizeCardTextForPrompt(raw.clinicalIssue, 180) }
            : {}),
          targetConcept:
            sanitizeCardTextForPrompt(raw.targetConcept, 200) ||
            'Conceito clínico central do card.',
          priority,
          suggestedType: raw.suggestedType === 'cloze' ? 'cloze' : 'basic',
        });
      }

      const normalizedItems = inputCards.map((c: Record<string, unknown>) =>
        applyDeterministicAuditGuard(c, itemMap.get(Number(c.id)))
      );

      const counts = { keep: 0, rebuild: 0, split: 0, prune: 0 };
      for (const it of normalizedItems) {
        counts[it.verdict]++;
      }

      return res.json({
        deckKey,
        overallSummary:
          overallSummary ||
          `Auditoria concluída: ${counts.keep} mantido(s), ${counts.rebuild} para refazer do zero, ${counts.split} para desmembrar e ${counts.prune} para podar.`,
        counts,
        items: normalizedItems,
        modelUsed: lastModelUsed,
      });
    } catch (error: unknown) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, 'Erro ao auditar qualidade dos cards existentes.'),
      });
    } finally {
      cleanup();
    }
  });

  // Passo 2 — Recriar Deck JSON Canônico em Lotes (Preservando IDs FSRS e Reconstruindo do Zero)
  router.post('/generate-deck', async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 300_000);
    try {
      const {
        deckKey = 'tema_clinico_internato',
        pdfs = [],
        pdfImagesCatalog = [],
        clinicalMap = null,
        existingMetadata = null,
        batchCards = null,
        batchIndex = 0,
        totalBatches = 1,
        nextNewIdStart = null,
        deckOutline = null,
        model: requestedModel,
      } = req.body || {};
      const activeModel = resolveGeminiModel(requestedModel);

      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error:
            'Chave GEMINI_API_KEY não configurada no ambiente. Configure sua chave no painel Settings > Secrets.',
        });
      }

      const existingIds: number[] = existingMetadata?.existingIds || [];
      const maxExistingId =
        existingIds.length > 0 ? Math.max(...existingIds) : 171000100;
      const effectiveNewIdStart =
        typeof nextNewIdStart === 'number' && nextNewIdStart > maxExistingId
          ? nextNewIdStart
          : maxExistingId + 1;
      const mediaTags: string[] = existingMetadata?.mediaTags || [];

      const isBatchMode = Array.isArray(batchCards) && batchCards.length > 0;
      const cardsForPrompt = isBatchMode
        ? batchCards
        : Array.isArray(existingMetadata?.rawCards)
          ? existingMetadata.rawCards
          : [];
      const checkedMapItems = Array.isArray(clinicalMap?.items)
        ? clinicalMap.items.filter((i: { checked?: boolean }) => i.checked !== false)
        : [];
      const effectiveProfile = resolveEffectiveDomainProfile(
        clinicalMap?.profile,
        deckKey,
        `${clinicalMap?.themeTitle || ''} ${clinicalMap?.specialty || ''}`
      );
      const profilePromptBlock = formatProfilePromptBlock(effectiveProfile);

      const outlineText =
        Array.isArray(deckOutline) && deckOutline.length > 0
          ? deckOutline
              .slice(0, 140)
              .map(
                (item: { id?: unknown; summary?: unknown; batch?: unknown }) =>
                  `  * Lote ${item.batch ?? '?'} | ID:${item.id ?? '?'} — ${sanitizeCardTextForPrompt(item.summary, 95)}`
              )
              .join('\n')
          : '';

      let lastModelUsed = activeModel;

      const runDeckBatch = async (
        subsetCards: Array<Record<string, unknown>>,
        subsetNewIdStart: number,
        depth = 0,
        stride = 100
      ): Promise<Array<Record<string, unknown>>> => {
        if (signal.aborted) {
          throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
        }
        const rawCardsSummary = buildFullCardsDigest(subsetCards);
        const hasAuditedRebuilds = subsetCards.some(
          (c) => c.auditVerdict === 'rebuild' || c.auditVerdict === 'split'
        );
        const auditedRebuildRule = hasAuditedRebuilds
          ? `\n- REGRA DE RECONSTRUÇÃO DO ZERO (AUDITORIA ATIVA): Para os cards marcados com [AUDITORIA: rebuild/split → REFAZER DO ZERO], o texto antigo foi intencionalmente ocultado para evitar paráfrase viciada. Crie um flashcard 100% NOVO a partir dos PDFs anexados, das Diretrizes Verificadas e do "Conceito-Alvo", preservando o "id" FSRS original (e usando novo ID >= ${subsetNewIdStart} apenas se "split" exigir desdobramento em 2 decisões distintas).`
          : '';

        const batchInstruction = isBatchMode
          ? `MODO DE RECONSTRUÇÃO PROFUNDA EM LOTE (${batchIndex + 1}/${totalBatches} — ${subsetCards.length} cards neste lote):
- PROIBIDO PARÁFRASE COSMÉTICA DE CLOZES FRACOS: Reconstrua cada conceito válido **DO ZERO** segundo Andy Matuschak & Michael Nielsen (esforço real de recuperação, anti-pattern-matching, raciocínio causal "por que / como", precisão clínica).${auditedRebuildRule}
- ESCOPO ESTRITO DO LOTE (ZERO COLISÃO ENTRE LOTES PARALELOS):
  * Trabalhe EXCLUSIVAMENTE sobre os conceitos presentes nos ${subsetCards.length} cards originais DESTE lote. **PROIBIDO criar cards novos para lacunas globais do Mapa Clínico P1–P4 ausentes deste lote** — a auditoria global pós-lotes adicionará automaticamente todas as lacunas do Mapa Clínico após a convergência dos lotes, evitando duplicatas entre lotes paralelos!
  * Só crie ID novo (a partir de ${subsetNewIdStart}) se um único card complexo DESTE lote precisar ser desmembrado em 2 decisões clínicas distintas.
- TRANSFORMAR LISTAS DISFARÇADAS, DEFINIÇÕES PASSIVAS E ESQUEMAS "ENTREGUES":
  1) NUNCA deixe um card listar 4–6 critérios no enunciado apenas para fechar uma única palavra/prazo óbvio no fim. Reconstrua como caso clínico ou decisão específica mantendo o "id" original.
  2) Em esquemas antimicrobianos combinados, evite entregar 2 drogas com doses completas no enunciado para fechar apenas a 3ª droga ou apenas o número de dias: prefira pergunta "basic" cobrando a decisão/associação terapêutica ou mecanismo (mantendo o "id" original).
  3) NUNCA transforme um conceito clínico próprio deste lote no cenário de outro card já existente no baralho (ex.: NUNCA mude um card de abscesso íntegro estável/Monif 3 para abscesso roto/choque/Monif 4 quando já houver card de rotura/Monif 4 no Índice Global — preserve a distinção clínica entre manejo conservador vs. falha/drenagem do abscesso íntegro e cirurgia imediata da rotura!).
  4) Em estadiamentos clínicos (ex.: Monif 2), NÃO pergunte "qual achado ao exame físico" para responder com categoria ampla ("peritonite"): apresente a vinheta com o sinal semiológico à beira-leito (ex.: descompressão brusca dolorosa) cobrando o estádio/conduta, ou cobre explicitamente o sinal semiológico esperado.
- EQUILÍBRIO ENTRE PRESERVAR CONCEITOS E PODAR DUPLICATAS REAIS:
  * Mantenha com seu "id" FSRS original todos os conceitos clínicos verdadeiramente distintos de P1–P4.
  * PODA ATIVA DE DUPLICATAS: Se dois cards neste lote ou no ÍNDICE GLOBAL DE TODOS OS LOTES testarem exatamente a MESMA conduta/alvo redundante (ex.: múltiplos cards fechando "{{c1::48 a 72 horas}}" para retorno, ou dois cards distintos cobrando a mesma prescrição de alta de autoinjetor de adrenalina), **EXCLUA o ID duplicado** neste lote ou diferencie explicitamente o alvo clínico. Também exclua cards reprovados pelo Filtro Negativo.`
          : `MODO DE GERAÇÃO INTEGRAL DO BARALHO (${subsetCards.length} cards originais fornecidos):
- Reconstrua o baralho com rigor Matuschak & Nielsen preservando os IDs FSRS dos conceitos clínicos distintos, podando duplicatas reais e criando novos IDs a partir de ${subsetNewIdStart} para cobrir integralmente o Mapa Clínico P1–P4.${auditedRebuildRule}`;

        const pdfCatalogBlock = formatPdfImagesCatalogBlock(pdfImagesCatalog);
        const guidelinesBlock = formatVerifiedGuidelinesBlock(clinicalMap);

        const prompt = `Reconstrua profundamente e lapide o baralho canônico para o tema "${deckKey}".

${profilePromptBlock}

${batchInstruction}

DADOS DO BARALHO ANTIGO (COMPLETO COM PERGUNTA, RESPOSTA E COMENTÁRIO ORIGINAL):
- Total de cards no baralho original: ${existingIds.length}
- Primeiro novo ID exclusivo reservado para este lote (se precisar desmembrar algum card deste lote): ${subsetNewIdStart}
- Tags de Mídia Originais: ${JSON.stringify(mediaTags)}
${pdfCatalogBlock}${guidelinesBlock}${outlineText ? `- ÍNDICE GLOBAL DE TODOS OS LOTES (use para não duplicar outros lotes nem transformar um card deste lote no tema de outro lote):\n${outlineText}\n` : ''}- Cards Originais DESTE LOTE para Reconstrução Profunda:
${rawCardsSummary}

${isBatchMode ? 'DIRETRIZES CLÍNICAS DE REFERÊNCIA DO TEMA (apenas referência clínica — NÃO gere cards para itens que não estão nos Cards Originais deste lote; lacunas serão preenchidas após os lotes):' : 'MAPA CLÍNICO APROVADO (P1 a P4):'}
${checkedMapItems.length > 0 ? JSON.stringify(checkedMapItems, null, 2) : 'Mapear integralmente P1, P2, P3 e P4 do tema.'}

CHECKLIST DE VALIDAÇÃO ANTES DE GERAR CADA CARD:
1. QUANTIDADE E FORMATO FLUIDOS (SEM COTA FIXA): Escolha "basic" (condutas, diferenciais, imagens e perguntas causais "por que / como") ou "cloze" (limiares, critérios numéricos, doses críticas e fatos atômicos em âncora) livremente pelo encaixe cognitivo de cada card — sem forçar 50/50.
2. Se "basic":
   - "question": no máximo 45 a 50 palavras. Para casos clínicos, use cenário concreto + clínica/exame + pergunta precisa (minuto zero / exame inicial vs padrão-ouro / 1ª escolha / 2ª linha após falha); para compreensão profunda (Nielsen & Matuschak), crie também prompts causais/mecanísticos e de contraste diferencial ("Por que X ocorre...", "Como diferenciar A de B..."). PROIBIDO perguntas vagas ("Qual a conduta?", "O que fazer?"), definições passivas ("O que é X?") ou respostas binárias ("Sim/Não").
   - "answer": 1 a 12 palavras (MÁXIMO ESTRITO 15 palavras e <= 110 caracteres), terminado em ponto final (.), SEM ponto-e-vírgula (;) e SEM tag <b> externo envolvendo toda a resposta. Para esquemas combinados (ex.: 3 fármacos), seja compacto (<= 14 palavras, deixando intervalos 12/12h e dias no hint) e NUNCA deixe dose numérica sem unidade (mg/g/mL).
3. Se "cloze":
   - "question": contém ESTRITAMENTE UMA lacuna {{c1::...}} com 1 a 5 palavras dentro da lacuna, unidades de medida FORA da lacuna, SEM preposição pendurada no final, SEM "::dica" e SEM partir expressões ao meio (ex.: proibido "{{c1::3 critérios maiores e 1}} menor"). Mantenha a âncora clínica enxuta e natural: NÃO invente idade nem tempo cronológico artificial no enunciado quando a regra numérica é geral.
   - "answer": "" (string vazia).
4. Raciocínio Visual Proativo (Materiais + Web), Zero Mídias Órfãs e Posicionamento Correto:
   - NUNCA invente nomes de arquivos locais inexistentes em <img src="..."> ou <audio>.
   - Se o card original já tiver <img src="..."> válido no "hint" (especialmente tabelas, algoritmos ou esquemas de resposta), MANTENHA a tag <img src="..."> e sua <i>Legenda</i> no INÍCIO do "hint" ("<img ...><br><i>Legenda</i><br><br><b>Comentário:</b> ...").
   - PROATIVO: Mesmo que o card original NÃO tenha imagem, avalie se ele se beneficia clinicamente de um ECG, radiografia, TC, USG, CTG, foto semiológica/dermatoscopia, lâmina ou fluxograma:
     * Se houver imagem correspondente no CATÁLOGO DE IMAGENS DOS MATERIAIS ANEXADOS acima, insira <img src="pdfimg:ID_EXATO">!
     * Se não houver no catálogo dos PDFs, insira <img src="buscar_imagem: query clínica precisa"> (ex.: <img src="buscar_imagem: bloqueio de ramo direito ECG">)!
     * Use na "question" ("image_mode": "recognition") quando o aluno precisa interpretar a imagem para responder, ou no início do "hint" ("image_mode": "feedback") quando ela serve para feedback visual/fluxograma. Não force imagens em cards puramente teóricos/normativos sem valor visual.
   - Garanta 100% de coerência numérica entre pergunta e hint.
5. Duplo Salto Cognitivo Implícito: NUNCA faça pergunta composta ("Qual o diagnóstico e a conduta?"). Apresente o caso clínico e pergunte apenas 1 decisão atômica.
6. "topic": formato "Tema - Subtema", ZERO spoiler por palavra ou radical INCLUSIVE no prefixo antes do " - " e NUNCA repita o topic em negrito dentro do question.
7. "question": ZERO spoiler entre parênteses e ZERO LaTeX ($...$, \\rightarrow).
8. "hint": deve ter "<b>Comentário:</b> " logo antes da explicação textual (se houver <i>Legenda</i> ou <img ...>, coloque no início ANTES de "<b>Comentário:</b> "), com 1 a 2 frases (180 a 300 caracteres visíveis no comentário textual, NUNCA passar de 310), termos-chave em <b>negrito</b> e contraste diferencial/causal obrigatório. Para escores, critérios numéricos ou pareamento parede×derivações×artéria, inclua APÓS o comentário uma tabela HTML compacta <table class="med-table"><thead><tr><th>...</th></tr></thead><tbody>...</tbody></table> (≤ 4 colunas; não conta nos 310 chars). Valide termos bioquímicos (ex.: calemia = potássio, nunca "litemia").
9. NÃO inclua o campo "sources".

Retorne EXCLUSIVAMENTE um objeto JSON válido no seguinte formato:
{
  "deck_key": "${deckKey}",
  "notes": [
    {
      "id": 171000101,
      "type": "basic",
      "priority": "P1",
      "topic": "Tema - Subtema Sem Spoiler",
      "question": "No contexto clínico/assistencial pertinente ao tema, paciente apresenta [achados/cenário sem spoiler]. Qual a conduta prioritária indicada neste perfil?",
      "answer": "Conduta atômica curta terminada em ponto.",
      "hint": "<b>Comentário:</b> Explicação concisa de 180 a 300 chars visíveis com <b>termos-chave</b> e contraste diferencial."
    }
  ]
}`;

        const response = await withGeminiKeyRotation(async (ai, keyFp) => {
          const parts: Part[] = await resolveDocumentPartsForGemini(ai, pdfs, signal, keyFp);
          return generateContentWithRetry(
            ai,
            {
              model: activeModel,
              contents: { parts: [...parts, { text: prompt }] },
              config: {
                systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
                responseMimeType: 'application/json',
                maxOutputTokens: 65536,
                thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
              },
            },
            { signal, timeoutMs: 150_000, enableModelFallback: true }
          );
        }, signal);
        lastModelUsed = response.modelUsed;

        const rawText = response.text || '{}';
        const finishReason = response.finishReason;
        let parsedNotes: Array<Record<string, unknown>> = [];
        let wasTruncated = false;

        try {
          const parsed = parseOrRecoverNotesJsonWithMeta(rawText);
          parsedNotes = parsed.notes;
          wasTruncated = parsed.wasTruncated;
        } catch (err) {
          if (subsetCards.length >= 4 && depth < 2) {
            wasTruncated = true;
          } else {
            throw err;
          }
        }

        const isAnomalousLoss =
          subsetCards.length >= 6 && parsedNotes.length < Math.ceil(subsetCards.length * 0.6);

        if (
          (finishReason === 'MAX_TOKENS' || wasTruncated || isAnomalousLoss) &&
          subsetCards.length >= 4 &&
          depth < 2
        ) {
          console.warn(
            `[generate-deck] Sub-lote dividido (recebido ${parsedNotes.length}/${subsetCards.length}, finish=${String(finishReason)}, truncated=${wasTruncated}, depth=${depth})`
          );
          const mid = Math.ceil(subsetCards.length / 2);
          const halfStride = Math.max(10, Math.floor(stride / 2));
          const [leftNotes, rightNotes] = await Promise.all([
            runDeckBatch(subsetCards.slice(0, mid), subsetNewIdStart, depth + 1, halfStride),
            runDeckBatch(
              subsetCards.slice(mid),
              subsetNewIdStart + halfStride,
              depth + 1,
              halfStride
            ),
          ]);
          return [...leftNotes, ...rightNotes];
        }

        return parsedNotes;
      };

      const notes = sanitizeReturnedNotes(
        await runDeckBatch(cardsForPrompt, effectiveNewIdStart)
      );
      if (res.writableEnded) return;

      return res.json({
        deck_key: deckKey,
        notes,
        batchIndex,
        totalBatches,
        modelUsed: lastModelUsed,
      });
    } catch (error: unknown) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, 'Erro ao gerar o Deck JSON Canônico com Gemini.'),
      });
    } finally {
      cleanup();
    }
  });

  // Auditoria Pós-Lotes — Preencher Lacunas Reais do Mapa Clínico P1-P4 Descobertas
  router.post('/fill-map-gaps', async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 180_000);
    try {
      const {
        deckKey = 'tema_clinico_internato',
        clinicalMap = null,
        rebuiltCards = [],
        pdfImagesCatalog = [],
        nextNewIdStart = 171000200,
        model: requestedModel,
      } = req.body || {};
      const activeModel = resolveGeminiModel(requestedModel);

      const checkedMapItems = Array.isArray(clinicalMap?.items)
        ? clinicalMap.items.filter((i: { checked?: boolean }) => i.checked !== false)
        : [];
      const effectiveProfile = resolveEffectiveDomainProfile(
        clinicalMap?.profile,
        deckKey,
        `${clinicalMap?.themeTitle || ''} ${clinicalMap?.specialty || ''}`
      );
      const profilePromptBlock = formatProfilePromptBlock(effectiveProfile);

      if (checkedMapItems.length === 0) {
        return res.json({ deck_key: deckKey, notes: [] });
      }

      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error: 'Chave GEMINI_API_KEY não configurada no ambiente.',
        });
      }

      const existingDigest = Array.isArray(rebuiltCards)
        ? rebuiltCards
            .slice(0, 160)
            .map(
              (c: { id?: unknown; topic?: unknown; question?: unknown; answer?: unknown }) =>
                `- ID:${c.id ?? '?'} | ${sanitizeCardTextForPrompt(c.topic, 80)} | Q: "${sanitizeCardTextForPrompt(c.question, 180)}"${c.answer ? ` | A: "${sanitizeCardTextForPrompt(c.answer, 90)}"` : ''}`
            )
            .join('\n')
        : '';
      const pdfCatalogBlock = formatPdfImagesCatalogBlock(pdfImagesCatalog);
      const guidelinesBlock = formatVerifiedGuidelinesBlock(clinicalMap);

      const prompt = `Audite a cobertura clínica do baralho reconstruído "${deckKey}" comparando-o com o Mapa Clínico P1–P4 aprovado para o perfil "${effectiveProfile}".

${profilePromptBlock}

MAPA CLÍNICO APROVADO:
${JSON.stringify(checkedMapItems, null, 2)}
${guidelinesBlock}${pdfCatalogBlock}
CARDS JÁ GERADOS NOS LOTES:
${existingDigest || 'Nenhum card gerado.'}

TAREFA CIRÚRGICA:
- Identifique APENAS os conceitos essenciais do Mapa Clínico que ficaram SEM UM CARD PRÓPRIO DEDICADO (uma menção passageira dentro do comentário/"hint" ou lista lateral de outro card NÃO conta como card dedicado!).
- Para cada lacuna real encontrada, crie 1 card atômico seguindo rigorosamente Andy Matuschak & Michael Nielsen, atribuindo IDs sequenciais a partir de ${nextNewIdStart}:
  * "topic": formato "Tema - Subtema" sem spoiler por palavra ou radical INCLUSIVE no prefixo antes de " - ".
  * Raciocínio visual proativo: se a lacuna envolve exame/lesão/traçado/algoritmo que ganhe retenção com imagem, use <img src="pdfimg:ID_EXATO"> (se presente no catálogo acima) ou <img src="buscar_imagem: query clínica específica"> na "question" ("image_mode": "recognition") ou no início do "hint" ("image_mode": "feedback"). NUNCA invente arquivos locais.
  * Se "basic": "question" <= 45–50 palavras (vinheta ou pergunta causal), "answer" com 1 a 12 palavras terminado em ponto final (.), sem ";".
  * Se "cloze": exatamente 1 lacuna {{c1::...}} (1 a 5 palavras) e "answer": "".
  * "hint": comece com "<b>Comentário:</b> " (precedido por <i>Legenda</i> ou <img ...><br> quando aplicável), tenha entre 180 e 300 caracteres visíveis (medidos APÓS "<b>Comentário:</b> " excluindo <table>, teto de 320), destaque termos-chave em <b>negrito</b> e traga contraste diferencial real pertinente ao tema. Inclua <table class="med-table"> compacta após o comentário sempre que houver escore, critérios ou tabela topográfica. Valide terminologia clínica estrita (ex.: calemia = K+, nunca "litemia").
- Se TODOS os conceitos do Mapa Clínico já possuírem card próprio dedicado acima, retorne "notes": [].
- NUNCA duplique conceitos já cobertos nos cards existentes acima.
- NÃO inclua o campo "sources".

Retorne EXCLUSIVAMENTE um JSON válido:
{
  "deck_key": "${deckKey}",
  "notes": []
}`;

      const response = await withGeminiKeyRotation(
        (ai) =>
          generateContentWithRetry(
            ai,
            {
              model: activeModel,
              contents: [{ text: prompt }],
              config: {
                systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
                responseMimeType: 'application/json',
                maxOutputTokens: 65536,
                thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
              },
            },
            { signal, timeoutMs: 135_000, enableModelFallback: true }
          ),
        signal
      );

      if (res.writableEnded) return;
      const { notes, wasTruncated } = parseOrRecoverNotesJsonWithMeta(response.text || '{}');
      if (wasTruncated) {
        console.warn('[fill-map-gaps] Resposta truncada recuperada parcialmente:', notes.length);
      }
      return res.json({
        deck_key: deckKey,
        notes: sanitizeReturnedNotes(notes),
        modelUsed: response.modelUsed,
      });
    } catch (error: unknown) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, 'Erro ao auditar lacunas do Mapa Clínico.'),
      });
    } finally {
      cleanup();
    }
  });

  // Auto-Reparar Avisos com IA (Reescrita Cirúrgica apenas dos cards sinalizados, fundamentada no Mapa Clínico + PDFs)
  router.post('/repair-cards', async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 180_000);
    try {
      const {
        flaggedCards = [],
        deckKey = 'internato_deck',
        clinicalMap = null,
        pdfs = [],
        targetField = '',
        fieldInstruction = '',
        model: requestedModel,
      } = req.body || {};
      const activeModel = resolveGeminiModel(requestedModel);

      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error:
            'Chave GEMINI_API_KEY não configurada no ambiente. Configure sua chave no painel Settings > Secrets.',
        });
      }

      const guidelinesBlock = formatVerifiedGuidelinesBlock(clinicalMap);
      const checkedItems = Array.isArray(clinicalMap?.items)
        ? clinicalMap.items
            .filter((i: { checked?: boolean }) => i.checked !== false)
            .slice(0, 20)
            .map((i: { priority?: unknown; subtopic?: unknown; concept?: unknown }) =>
              `- [${String(i.priority || 'P2')}] ${sanitizeCardTextForPrompt(i.subtopic, 60)}: ${sanitizeCardTextForPrompt(i.concept, 150)}`
            )
            .join('\n')
        : '';
      const targetFieldBlock = targetField
        ? `\nFOCO SOLICITADO PELO USUÁRIO: Concentre a reescrita no campo "${String(targetField)}"${fieldInstruction ? ` (motivo: "${sanitizeCardTextForPrompt(fieldInstruction, 220)}")` : ''}, preservando os demais campos já válidos e mantendo coerência total entre pergunta, resposta e comentário.`
        : '';

      const prompt = `Reescreva cirurgicamente APENAS os cards abaixo que foram reprovados pelo Linter Matuschak & Nielsen (andymatuschak.org/prompts/ e augmentingcognition.com/ltm.html) e/ou pela Verificação Final.
Mantenha rigorosamente o mesmo "id" numérico e qualquer tag de mídia válida (como __EMBEDDED_DATA_URI_*__) de cada card, A MENOS que o card faça referência visual sem imagem — nesse caso insira <img src="buscar_imagem: query clínica precisa"> ou remova a referência órfã. NÃO inclua o campo "sources".
${guidelinesBlock}${checkedItems ? `\nMAPA CLÍNICO DO DECK "${deckKey}":\n${checkedItems}\n` : ''}${targetFieldBlock}

REGRAS DE CORREÇÃO CIRÚRGICA (MATUSCHAK & NIELSEN):
- **Focused & Tractable:** Se a pergunta pede lista aberta ("Quais as causas/critérios...?", "Cite...") ou a resposta tem múltiplos itens/ponto-e-vírgula, isole 1 único atributo/decisão determinante. Se for pergunta composta ("Qual a parede e a artéria?", "Qual o diagnóstico e antiarrítmico?"), mantenha apenas 1 alvo atômico.
- **Salience & Anti-Passivo (Nielsen):** Se a pergunta é uma definição inerte ("O que é X?") ou binária ("Sim/Não"), transforme em um prompt de saliência ancorado em cenário clínico ou mecanismo causal.
- **Precise & Consistent:** Se "type": "basic" -> "question" com <= 50 palavras e pergunta precisa (com janela temporal explícita: "imediata", "inicial", "de 1ª escolha" — NUNCA "Qual a conduta?"); "answer" DEVE ter entre 1 e 12 palavras (máx 15 palavras / 110 chars), terminar com ".", NÃO conter ";" e NÃO ter <b> envolvendo tudo.
- **Cloze Atômico:** Se "type": "cloze" -> "question" DEVE ter estritamente 1 lacuna {{c1::...}} com 1 a 5 palavras, unidades fora da lacuna, sem preposição pendurada no final, SEM "::dica", e "answer" DEVE ser "".
- **Effortful (Zero Spoiler):** Se spoiler por radical ou palavra no "topic" ou entre parênteses na "question" -> remova imediatamente a palavra/radical da resposta mantendo formato "Tema - Subtema".
- **Precisão Terminológica & Tabelas:** Corrija imprecisões clínicas (ex.: calemia = potássio, nunca litemia). Se o card explicar escore ou correlação topográfica, mantenha ou adicione <table class="med-table"> compacta (≤ 4 colunas) APÓS o texto de <b>Comentário:</b>.
- Substitua qualquer LaTeX ($...$, \\rightarrow) por Unicode puro (→, ≥, ≤).
- "hint": DEVE conter "<b>Comentário:</b> ", ter entre 180 e 295 caracteres visíveis APÓS o prefixo "<b>Comentário:</b> " (excluindo <table>; PROIBIDO passar de 320 chars visíveis), com termos-chave em <b>negrito</b> e contraste diferencial/causal.

CARDS SINALIZADOS E SEUS AVISOS:
${JSON.stringify(flaggedCards, null, 2)}

Retorne EXCLUSIVAMENTE um objeto JSON válido no formato:
{
  "repairedCards": [
    {
      "id": 171000101,
      "type": "basic",
      "priority": "P1",
      "topic": "Tema - Subtema",
      "question": "...",
      "answer": "...",
      "hint": "<b>Comentário:</b> ..."
    }
  ]
}`;

      const response = await withGeminiKeyRotation(async (ai, keyFp) => {
        const parts: Part[] = await resolveDocumentPartsForGemini(ai, pdfs, signal, keyFp);
        parts.push({ text: prompt });
        return generateContentWithRetry(
          ai,
          {
            model: activeModel,
            contents: { parts },
            config: {
              systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              maxOutputTokens: 65536,
              thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
            },
          },
          { signal, timeoutMs: 135_000, enableModelFallback: true }
        );
      }, signal);

      if (res.writableEnded) return;
      const rawText = response.text || '{}';
      const { items: rawRepaired } = parseOrRecoverJsonArrayField(
        rawText,
        'repairedCards',
        ['id', 'question']
      );
      const repairedCards = sanitizeReturnedNotes(rawRepaired);

      return res.json({ repairedCards, deckKey, modelUsed: response.modelUsed });
    } catch (error: unknown) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, 'Erro ao auto-reparar cards com Gemini.'),
      });
    } finally {
      cleanup();
    }
  });

  // Raciocínio Visual Proativo — Avalia quais cards sem imagem ganhariam valor clínico com uma figura (Materiais + Web)
  router.post('/suggest-visual-cards', async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 130_000);
    try {
      const {
        deckKey = 'internato_deck',
        cards = [],
        pdfImagesCatalog = [],
        model: requestedModel,
      } = req.body || {};
      const activeModel = resolveGeminiModel(requestedModel);

      const candidateCards = (Array.isArray(cards) ? cards : [])
        .filter((c: { question?: unknown; hint?: unknown }) => {
          const combined = `${String(c?.question || '')} ${String(c?.hint || '')}`;
          return !/<img\b/i.test(combined);
        })
        .slice(0, 40);

      if (candidateCards.length === 0) {
        return res.json({ deckKey, suggestions: [] });
      }

      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error:
            'Chave GEMINI_API_KEY não configurada no ambiente. Configure sua chave no painel Settings > Secrets.',
        });
      }

      const cardsDigest = candidateCards
        .map(
          (c: {
            id?: unknown;
            type?: unknown;
            topic?: unknown;
            question?: unknown;
            answer?: unknown;
            hint?: unknown;
          }) =>
            `- cardId: ${Number(c.id)} | type: ${c.type === 'cloze' ? 'cloze' : 'basic'} | topic: "${sanitizeCardTextForPrompt(c.topic, 80)}" | Q: "${sanitizeCardTextForPrompt(c.question, 220)}"${c.answer ? ` | A: "${sanitizeCardTextForPrompt(c.answer, 110)}"` : ''} | Hint: "${sanitizeCardTextForPrompt(c.hint, 200)}"`
        )
        .join('\n');

      const pdfCatalogBlock = formatPdfImagesCatalogBlock(pdfImagesCatalog);

      const prompt = `Você é um preceptor de Internato analisando flashcards médicos SEM imagem do deck "${deckKey}".
Raciocine criticamente sobre QUAIS cards realmente se beneficiariam de uma imagem clínica para aumentar a retenção (ex.: traçado de ECG/CTG, radiografia, TC, USG, dermatoscopia/lesão cutânea, fundoscopia, esfregaço/lâmina, exame físico/sinal semiológico, fluxograma diagnóstico ou figura presente nos materiais anexados).

REGRAS ESTRITAS:
1. NÃO sugira imagem para cards puramente conceituais, definições éticas/normativas, doses isoladas ou cálculos simples onde uma figura seria decorativa ou aleatória.
2. Escolha o "mode" ideal:
   - "recognition": coloque a imagem na FRENTE (question) quando ver o exame/traçado/lesão ajuda no reconhecimento clínico (apenas em cards "basic" cujo enunciado não vire spoiler).
   - "feedback": coloque a imagem no VERSO (hint) quando ela ilustra/confirma o achado, classificação, algoritmo ou comparação anatômica após o estudante responder (ideal para "cloze" e condutas).
3. Se uma figura do CATÁLOGO DE MATERIAIS ANEXADOS abaixo corresponder bem ao conceito do card, preencha "pdfImageId" com o ID exato (ex.: "pdfimg_123_p4_1" — sem o prefixo "pdfimg:"). Mesmo quando usar "pdfImageId", preencha "searchQuery" como fallback médico preciso.
4. "searchQuery": termo curto, específico e clínico em português ou inglês com diagnóstico + modalidade (ex.: "bloqueio de ramo direito V1 ECG", "pneumotorax hipertensivo radiografia torax", "cardiotocografia desaceleracao tardia"). NUNCA gere termos genéricos ("exame medico", "paciente", "sintoma").
5. "legend": 1 frase clínica objetiva (máx. 130 chars) descrevendo o achado visual SEM dar spoiler caso seja "recognition".
${pdfCatalogBlock}
CARDS SEM IMAGEM PARA AVALIAR:
${cardsDigest}

Retorne EXCLUSIVAMENTE um JSON válido no formato:
{
  "suggestions": [
    {
      "cardId": 171000101,
      "mode": "recognition",
      "pdfImageId": "",
      "searchQuery": "diagnostico + modalidade exame",
      "legend": "Exame complementar evidenciando...",
      "reason": "Justificativa curta do ganho pedagógico"
    }
  ]
}`;

      const response = await withGeminiKeyRotation(
        (ai) =>
          generateContentWithRetry(
            ai,
            {
              model: activeModel,
              contents: prompt,
              config: {
                responseMimeType: 'application/json',
                maxOutputTokens: 16384,
                thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
              },
            },
            { signal, timeoutMs: 110_000, enableModelFallback: true }
          ),
        signal
      );

      if (res.writableEnded) return;
      const { items: rawList } = parseOrRecoverJsonArrayField(
        response.text || '{}',
        'suggestions',
        ['cardId', 'searchQuery']
      );
      const validIds = new Set(candidateCards.map((c: { id?: unknown }) => Number(c.id)));

      const suggestions = rawList
        .map((item: Record<string, unknown>) => {
          const cardId = Number(item.cardId);
          const searchQuery = String(item.searchQuery || '').trim();
          if (!Number.isFinite(cardId) || !validIds.has(cardId) || !searchQuery) {
            return null;
          }
          const rawPdfId = String(item.pdfImageId || '')
            .replace(/^pdfimg:\s*/i, '')
            .trim();
          const mode: 'recognition' | 'feedback' =
            item.mode === 'recognition' ? 'recognition' : 'feedback';
          return {
            cardId,
            mode,
            ...(rawPdfId ? { pdfImageId: rawPdfId } : {}),
            searchQuery: searchQuery.slice(0, 120),
            legend: String(item.legend || '').trim().slice(0, 180),
            reason: String(item.reason || '').trim().slice(0, 160),
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      return res.json({ deckKey, suggestions, modelUsed: response.modelUsed });
    } catch (error: unknown) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(
          error,
          'Erro ao analisar cards para sugestão proativa de imagens.'
        ),
      });
    } finally {
      cleanup();
    }
  });

  // Validação Multimodal com Gemini Flash — Inspeciona pixels reais da imagem (PDF ou Web)
  router.post('/validate-image', async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 42_000);
    let mediaReachableRaster = false;
    try {
      const {
        imageSource = '',
        cardTopic = '',
        cardQuestion = '',
        cardAnswer = '',
        cardHint = '',
        imageMode = 'feedback',
        captionHint = '',
        model: requestedModel,
      } = req.body || {};

      if (!imageSource || typeof imageSource !== 'string') {
        return res.status(400).json({ error: 'imageSource ausente.' });
      }

      const resolvedMedia = await resolveImageForMultimodalValidation(imageSource, signal);
      if (signal.aborted || res.writableEnded) return;

      if (resolvedMedia.status === 'broken') {
        return res.json({
          validated: true,
          reachable: false,
          isSvg: false,
          isCompatible: false,
          detectedModality: 'broken',
          conflictReason: resolvedMedia.reason,
          visualLegend: '',
        });
      }

      if (resolvedMedia.status === 'fetch_error') {
        return res.json({
          validated: false,
          fallback: true,
          reachable: false,
          isSvg: false,
          isCompatible: false,
          detectedModality: 'unreachable',
          conflictReason: resolvedMedia.reason,
          visualLegend: '',
        });
      }

      if (resolvedMedia.status === 'svg') {
        return res.json({
          validated: false,
          fallback: true,
          reachable: true,
          isSvg: true,
          isCompatible: true,
          detectedModality: 'svg_vector',
          conflictReason: '',
          visualLegend: '',
        });
      }

      mediaReachableRaster = true;

      if (parseGeminiApiKeys().length === 0) {
        return res.json({
          validated: false,
          fallback: true,
          reachable: true,
          isSvg: false,
          isCompatible: true,
          detectedModality: 'unverified',
          conflictReason: '',
          visualLegend: '',
        });
      }

      const activeModel = requestedModel
        ? resolveGeminiModel(requestedModel)
        : FALLBACK_GEMINI_MODEL;
      const safeMode = imageMode === 'recognition' ? 'recognition' : 'feedback';

      const prompt = `Você é um preceptor médico auditando visualmente uma imagem candidata a ser anexada a um flashcard do Internato.
Analise EXCLUSIVAMENTE OS PIXELS REAIS DA IMAGEM ANEXADA (não confie em suposições do texto se os pixels mostrarem outra modalidade!).

CONTEXTO DO FLASHCARD:
- Tópico: "${sanitizeCardTextForPrompt(cardTopic, 90)}"
- Modo de exibição: "${safeMode}" (${safeMode === 'recognition' ? 'imagem na FRENTE — proibido dar spoiler da resposta na legenda!' : 'imagem no VERSO/comentário'})
- Pergunta: "${sanitizeCardTextForPrompt(cardQuestion, 240)}"
- Resposta esperada: "${sanitizeCardTextForPrompt(cardAnswer, 130)}"
- Comentário: "${sanitizeCardTextForPrompt(cardHint, 180)}"
${captionHint ? `- Legenda/nota extraída próxima à figura: "${sanitizeCardTextForPrompt(captionHint, 140)}"` : ''}

REGRAS ESTRITAS DE INSPEÇÃO VISUAL:
1. "detectedModality": nomeie a modalidade real visível nos pixels (ex.: "usg", "videolaparoscopia", "ecg_12_derivacoes", "ecg_tira_ritmo", "ecocardiograma", "radiografia", "tomografia", "ctg", "dermatoscopia", "histologia", "fluxograma", "foto_clinica", "esquema_desenho", "irrelevante_logo").
2. "isCompatible":
   - Retorne FALSE se houver conflito de modalidade (ex.: card pede ECG e a imagem é ecocardiograma/modo-M, anatomia, retrato, logo ou capa de aula; ou card pede USG e a imagem é laparoscopia).
   - Retorne FALSE se o card testa uma **patologia/alteração específica** (ex.: IAM com supra, Flutter atrial, WPW, BAVT, Brugada, pneumotórax, hipercalemia), MAS os pixels mostrarem um **exame NORMAL/FISIOLÓGICO** (ex.: ECG em ritmo sinusal normal sem alteração) ou de **OUTRA patologia diferente** (ex.: hemibloqueio anterior esquerdo quando o card pede IAM anterior; BRD quando o card pede BRE; FA quando o card pede Flutter).
   - Retorne FALSE se modo="${safeMode}" for "recognition" e a imagem for **ilustração/esquema vetorial/cartoon** em vez de exame diagnóstico real, OU se o **diagnóstico/resposta aparecer escrito em texto grande legível como spoiler nos pixels**.
   - Retorne FALSE se a imagem for ilegível, borrada, logomarca ou texto puro genérico.
   - Retorne TRUE apenas se os pixels mostrarem inequivocamente o exame/achado clínico compatível e útil para este card.
3. "visualScore": nota inteira de 1 a 10 da qualidade didática e precisão diagnóstica da imagem (9–10 = ECG de 12 derivações ou exame real nítido demonstrando o achado exato sem texto spoiler; 6–8 = tira de ritmo/exame aceitável demonstrando a patologia; 1–5 = imagem fraca, ambígua, cortada ou incompatível).
4. "conflictReason": explicação objetiva curta caso isCompatible=false (ou "" se compatível).
5. "visualLegend": descreva fielmente em Português do Brasil (entre 8 e 24 palavras, MÍNIMO 6 palavras, sem iniciar com "Legenda visual:") APENAS o que está visível nos pixels reais. Se mode="recognition", descreva a morfologia visual sem entregar o diagnóstico final da resposta esperada.`;

      const result = await withGeminiKeyRotation(
        (ai) =>
          generateContentWithRetry(
            ai,
            {
              model: activeModel,
              contents: {
                parts: [
                  {
                    inlineData: {
                      mimeType: resolvedMedia.mimeType,
                      data: resolvedMedia.data,
                    },
                  },
                  { text: prompt },
                ],
              },
              config: {
                responseMimeType: 'application/json',
                maxOutputTokens: 1024,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    detectedModality: { type: Type.STRING },
                    isCompatible: { type: Type.BOOLEAN },
                    visualScore: { type: Type.INTEGER },
                    conflictReason: { type: Type.STRING },
                    visualLegend: { type: Type.STRING },
                  },
                  required: ['detectedModality', 'isCompatible', 'visualScore', 'visualLegend'],
                },
              },
            },
            { signal, timeoutMs: 15_000, enableModelFallback: true }
          ),
        signal
      );

      if (res.writableEnded) return;
      const parsed = JSON.parse(extractJsonBlock(result.text || '{}')) as {
        detectedModality?: unknown;
        isCompatible?: unknown;
        visualScore?: unknown;
        conflictReason?: unknown;
        visualLegend?: unknown;
      };

      const detectedModality = String(parsed.detectedModality || 'clinical_image').trim().slice(0, 60);
      const isCompatible = parsed.isCompatible === true;
      const rawScore = Number(parsed.visualScore);
      const visualScore = Number.isFinite(rawScore)
        ? Math.max(1, Math.min(10, Math.round(rawScore)))
        : isCompatible
        ? 7
        : 2;
      const conflictReason = String(parsed.conflictReason || '').trim().slice(0, 220);
      const visualLegend = String(parsed.visualLegend || '')
        .replace(/^legenda\s+visual\s*:\s*/i, '')
        .trim()
        .slice(0, 220);

      return res.json({
        validated: true,
        reachable: true,
        isSvg: false,
        isCompatible,
        visualScore,
        detectedModality,
        conflictReason,
        visualLegend,
        modelUsed: result.modelUsed,
      });
    } catch (error: unknown) {
      if (res.writableEnded) return;
      return res.status(200).json({
        validated: false,
        fallback: true,
        reachable: mediaReachableRaster,
        isSvg: false,
        isCompatible: false,
        detectedModality: mediaReachableRaster ? 'unverified' : 'unreachable',
        conflictReason: mediaReachableRaster
          ? 'Falha ao validar imagem por visão computacional.'
          : 'Falha ao validar imagem.',
        visualLegend: '',
        error: formatGeminiError(error, 'Falha na validação multimodal da imagem.'),
      });
    } finally {
      cleanup();
    }
  });

  // Verificação Holística Final do Baralho Montado (Cobertura P1–P4 + Acurácia + Mídia)
  router.post('/verify-deck', async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 160_000);
    try {
      const {
        deckKey = 'tema_clinico_internato',
        cards = [],
        clinicalMap = null,
        pdfs = [],
        model: requestedModel,
      } = req.body || {};
      const activeModel = resolveGeminiModel(requestedModel);

      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error:
            'Chave GEMINI_API_KEY não configurada no ambiente. Configure sua chave no painel Settings > Secrets.',
        });
      }

      const inputCards = Array.isArray(cards) ? cards : [];
      if (inputCards.length === 0) {
        return res.json({
          overallScore: 0,
          approved: false,
          mapCoveragePct: 0,
          summary: 'Baralho vazio — nenhum card disponível para verificação.',
          clinicalAccuracyNotes: [],
          missingConcepts: [],
          weakCardFixes: [],
        });
      }

      const effectiveProfile = resolveEffectiveDomainProfile(
        clinicalMap?.profile,
        deckKey,
        `${clinicalMap?.themeTitle || ''} ${clinicalMap?.specialty || ''}`
      );
      const profilePromptBlock = formatProfilePromptBlock(effectiveProfile);
      const guidelinesBlock = formatVerifiedGuidelinesBlock(clinicalMap);
      const checkedMapItems = Array.isArray(clinicalMap?.items)
        ? clinicalMap.items.filter((i: { checked?: boolean }) => i.checked !== false)
        : [];

      const deckSummary = inputCards
        .slice(0, 140)
        .map((c: Record<string, unknown>) => {
          const hasImg = /<img\b/i.test(`${String(c.question || '')} ${String(c.hint || '')}`);
          return `- ID:${c.id} [${c.type === 'cloze' ? 'cloze' : 'basic'}${c.priority ? ` ${String(c.priority)}` : ''}]${hasImg ? ` [IMG:${String(c.image_mode || 'feedback')}]` : ''} | Topic: "${sanitizeCardTextForPrompt(c.topic, 100)}" | Q: "${sanitizeCardTextForPrompt(c.question, 650)}"${c.answer ? ` | A: "${sanitizeCardTextForPrompt(c.answer, 200)}"` : ''} | Hint: "${sanitizeCardTextForPrompt(c.hint, 850)}"`;
        })
        .join('\n');

      const prompt = `Você é o Preceptor Revisor Final auditando se o baralho montado para "${deckKey}" está COMPLETO, ADEQUADO, CLINICAMENTE CORRETO e pronto para estudo no Anki (FSRS).

${profilePromptBlock}${guidelinesBlock}
MAPA CLÍNICO P1–P4 APROVADO:
${checkedMapItems.length > 0 ? JSON.stringify(checkedMapItems, null, 2) : 'Avalie cobertura integral do tema.'}

BARALHO FINAL MONTADO (${inputCards.length} cards):
${deckSummary}

AVALIE RIGOROSAMENTE:
1. Cobertura do Mapa Clínico P1–P4 (quais conceitos críticos realmente ficaram descobertos em "missingConcepts").
2. Acurácia clínica frente às Diretrizes Verificadas e PDFs anexados (doses, critérios, condutas).
3. Rigor pedagógico Matuschak & Nielsen e adequação clínica das imagens/legendas ("weakCardFixes" — liste apenas cards que realmente tenham falha clínica, ambiguidade ou incompatibilidade entre o achado descrito na legenda e o tema do card. NOTA IMPORTANTE: tags <img src="https://..." data-anki-file="..."> e src="[IMAGEM_EMBUTIDA]" representam imagens médicas JÁ validadas e resolvidas que serão empacotadas localmente no .apkg — NUNCA aponte "URL externa" como problema e NUNCA peça para trocar uma URL resolvida de volta para "buscar_imagem:").
4. "overallScore" de 0 a 10 e "approved": true somente se overallScore >= 8 e não houver lacunas P1 críticas descobertas.

Retorne EXCLUSIVAMENTE um objeto JSON válido:
{
  "overallScore": 9,
  "approved": true,
  "mapCoveragePct": 95,
  "summary": "Síntese objetiva da qualidade final do baralho.",
  "clinicalAccuracyNotes": ["Observação objetiva sobre alinhamento com diretrizes/PDFs."],
  "missingConcepts": [
    {
      "priority": "P1",
      "subtopic": "Subtema sem spoiler",
      "concept": "Conceito ausente que precisa de 1 card dedicado",
      "recommendedType": "basic"
    }
  ],
  "weakCardFixes": [
    {
      "cardId": 171000101,
      "issue": "Problema clínico ou ambiguidade detectada",
      "fixInstruction": "Instrução cirúrgica exata para corrigir o card"
    }
  ]
}`;

      const response = await withGeminiKeyRotation(async (ai, keyFp) => {
        const parts: Part[] = await resolveDocumentPartsForGemini(ai, pdfs, signal, keyFp);
        parts.push({ text: prompt });
        return generateContentWithRetry(
          ai,
          {
            model: activeModel,
            contents: { parts },
            config: {
              systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              maxOutputTokens: 16384,
              thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
            },
          },
          { signal, timeoutMs: 135_000, enableModelFallback: true }
        );
      }, signal);

      if (res.writableEnded) return;
      const rawText = response.text || '{}';
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(extractJsonBlock(rawText)) as Record<string, unknown>;
      } catch {
        const { items: recoveredMissing } = parseOrRecoverJsonArrayField(
          rawText,
          'missingConcepts',
          ['concept']
        );
        const { items: recoveredFixes } = parseOrRecoverJsonArrayField(
          rawText,
          'weakCardFixes',
          ['cardId', 'issue']
        );
        const scoreMatch = rawText.match(/"overallScore"\s*:\s*(\d+(?:\.\d+)?)/);
        const covMatch = rawText.match(/"mapCoveragePct"\s*:\s*(\d+(?:\.\d+)?)/);
        const sumMatch = rawText.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        parsed = {
          overallScore: scoreMatch ? Number(scoreMatch[1]) : 7,
          approved: false,
          mapCoveragePct: covMatch ? Number(covMatch[1]) : 80,
          summary: sumMatch?.[1] || 'Verificação final recuperada parcialmente.',
          clinicalAccuracyNotes: [],
          missingConcepts: recoveredMissing,
          weakCardFixes: recoveredFixes,
        };
      }

      const validPriorities = new Set(['P1', 'P2', 'P3', 'P4']);
      const missingConcepts = Array.isArray(parsed.missingConcepts)
        ? parsed.missingConcepts
            .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === 'object' && (m as Record<string, unknown>).concept))
            .map((m) => {
              const p = String(m.priority || 'P2').toUpperCase();
              return {
                priority: (validPriorities.has(p) ? p : 'P2') as 'P1' | 'P2' | 'P3' | 'P4',
                subtopic: sanitizeCardTextForPrompt(m.subtopic || deckKey, 90),
                concept: sanitizeCardTextForPrompt(m.concept, 220),
                recommendedType: (m.recommendedType === 'cloze' ? 'cloze' : 'basic') as 'basic' | 'cloze',
              };
            })
        : [];

      const weakCardFixes = Array.isArray(parsed.weakCardFixes)
        ? parsed.weakCardFixes
            .filter((f): f is Record<string, unknown> => Boolean(f && typeof f === 'object' && Number.isFinite(Number((f as Record<string, unknown>).cardId))))
            .map((f) => ({
              cardId: Number(f.cardId),
              issue: sanitizeCardTextForPrompt(f.issue, 200),
              fixInstruction: sanitizeCardTextForPrompt(f.fixInstruction, 240),
            }))
            .filter(
              (f) =>
                !(
                  /\b(?:url\s+externa|links?\s+externos?|links?\s+mortos?)\b/i.test(f.issue) &&
                  /buscar_imagem:/i.test(f.fixInstruction)
                )
            )
        : [];

      const overallScore = Number.isFinite(Number(parsed.overallScore))
        ? Math.max(0, Math.min(10, Math.round(Number(parsed.overallScore) * 10) / 10))
        : 8;
      const mapCoveragePct = Number.isFinite(Number(parsed.mapCoveragePct))
        ? Math.max(0, Math.min(100, Math.round(Number(parsed.mapCoveragePct))))
        : 85;
      const approved =
        typeof parsed.approved === 'boolean'
          ? parsed.approved
          : overallScore >= 8 && missingConcepts.filter((m) => m.priority === 'P1').length === 0;

      return res.json({
        overallScore,
        approved,
        mapCoveragePct,
        summary:
          sanitizeCardTextForPrompt(parsed.summary, 350) ||
          `Baralho avaliado com nota ${overallScore}/10 e ${mapCoveragePct}% de cobertura do Mapa Clínico.`,
        clinicalAccuracyNotes: Array.isArray(parsed.clinicalAccuracyNotes)
          ? parsed.clinicalAccuracyNotes
              .map((n) => sanitizeCardTextForPrompt(n, 220))
              .filter(Boolean)
              .slice(0, 8)
          : [],
        missingConcepts,
        weakCardFixes,
        modelUsed: response.modelUsed,
      });
    } catch (error: unknown) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, 'Erro ao realizar verificação final do baralho.'),
      });
    } finally {
      cleanup();
    }
  });

  return router;
}
