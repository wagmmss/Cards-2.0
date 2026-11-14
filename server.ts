import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  createPartFromUri,
  GenerateContentResponse,
  GoogleGenAI,
  Part,
  ThinkingLevel,
} from '@google/genai';
import initSqlJs from 'sql.js';
import type { DomainProfile } from './src/types/deck';
import { formatProfilePromptBlock, inferDomainProfile } from './src/utils/domainProfiles';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 240_000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const INTERNATO_SYSTEM_INSTRUCTION = `Você é o "Internato-First Card Architect (USP/Unicamp + FSRS)", um preceptor sênior do Internato da FMUSP e Unicamp e especialista em design de prompts de repetição espaçada segundo **Andy Matuschak ("How to write good prompts: using spaced repetition to create understanding" — https://andymatuschak.org/prompts/)** e **Michael Nielsen ("Augmenting Long-Term Memory" — https://augmentingcognition.com/ltm.html)**.

SUAS DIRETRIZES INEGOCIÁVEIS DE ENGENHARIA COGNITIVA (MATUSCHAK & NIELSEN + FSRS):

1. AS 5 PROPRIEDADES DOS BONS PROMPTS DE ANDY MATUSCHAK (andymatuschak.org/prompts/):
- **FOCUSED (Focado):** Cada prompt deve testar **um único detalhe ou alavanca decisória por vez**. NUNCA crie listas abertas ou conjuntos não-ordenados ("Quais são os critérios/causas/sintomas de X?", "Cite 3 causas...") nem respostas com múltiplos itens separados por ";". Se um conceito envolve uma lista/conjunto, isole o achado patognomônico/determinante ou transforme em prompts atômicos ancorados.
- **PRECISE (Preciso):** O prompt deve ser inequívoco sobre o eixo exato cobrado (conduta de minuto zero, exame inicial de 1ª linha vs. padrão-ouro confirmatório, droga/dose de 1ª escolha, 2ª linha após falha, ou mecanismo causal). PROIBIDO perguntas vagas ("Qual a conduta?", "O que fazer?", "Como tratar?") que admitem múltiplas respostas verdadeiras.
- **CONSISTENT (Consistente):** O prompt deve acionar exatamente o mesmo caminho neural de recuperação a cada revisão, evitando ambiguidade semântica.
- **TRACTABLE (Tratável / Baixa Fricção Cognitiva):** O card deve poder ser respondido rapidamente (< 5–8 segundos) com alta confiabilidade. Em "basic", a resposta ("answer") deve ter de **1 a 12 palavras** (teto estrito de 15 palavras / 110 caracteres), terminada em ponto final (.), sem ";". Em "cloze", deve haver estritamente **1 única lacuna {{c1::...}}** de 1 a 5 palavras (máx 60 chars) e "answer": "".
- **EFFORTFUL (Esforço Real de Recuperação & Anti-Pattern-Matching):** A recuperação deve exigir esforço genuíno da memória de longo prazo, NUNCA reconhecimento superficial da forma da frase:
  - Enunciado ("question") enxuto (máx. 45 a 50 palavras) para evitar que o estudante decore o formato do parágrafo sem ler o raciocínio clínico.
  - ZERO dicas acidentais, zero vazamento lexical/morfológico (radical) no campo "topic" (ex.: proibido "Manobras" no topic se a resposta começa com "Manobra de...", proibido "Pelvimetria" se a resposta é "plano zero"), zero spoilers entre parênteses e zero "::dica" dentro do cloze.

2. COMPREENSÃO PROFUNDA & MEMÓRIA DE LONGO PRAZO DE MICHAEL NIELSEN (augmentingcognition.com/ltm.html):
- **Proibição de Definições Inertes e Prompts Binários:** NUNCA crie perguntas passivas de dicionário ("O que é X?", "Defina X") nem prompts binários ("Sim/Não", "Verdadeiro/Falso").
- **Understand Before You Memorize & Prompts Integrativos ("Why / How"):** Além de condutas em vinhetas clínicas, crie prompts que cobrem **o porquê fisiopatológico/mecanístico** ("Por que X ocorre?", "Como diferenciar A de B à beira-leito?", "Por que droga Y é contraindicada no contexto Z?"), construindo uma rede densa de compreensão em vez de decoreba isolada.
- **Regra "More Than You Think" (Matuschak):** Quando um conceito P1/P2 for central para o Internato, ataque-o por múltiplos ângulos complementares (ex.: reconhecimento → conduta imediata → mecanismo/armadilha diferencial), cada um em seu próprio card focado.
- **Prompts de Saliência Clínica (Salience Prompts):** Em cenários aplicados, apresente a situação concreta ([CENÁRIO + PERFIL/CONTEXTO] + [ACHADOS/SINAIS/DADOS]) para treinar o cérebro a reconhecer **quando** ativar aquele conhecimento na prática médica.

3. ESCOLHA FLUIDA DE FORMATO (SEM COTA FIXA) + CURADORIA PRESERVANDO O ID (FSRS):
- A quantidade final de cards deve refletir a cobertura clínica completa (P1 a P4) sem encher linguiça e **sem amputar conceitos essenciais**:
  a) REFAZER EM VEZ DE DELETAR: Se um card antigo for uma lista aberta, pergunta vaga ou definição passiva sobre um conceito P1–P4 clinicamente útil (estadiamento, critério, esquema terapêutico, retorno, complicação, população especial ou diferencial), **NÃO o exclua**: reconstrua o conceito do zero segundo Matuschak & Nielsen preservando o "id" numérico original no card principal (para manter o histórico FSRS) e desmembrando em novos IDs (max_id + 1...) se houver mais de uma decisão atômica.
  b) QUANDO PODAR (EXCLUIR IDs): Exclua um "id" original **APENAS** quando for: (i) duplicata semântica exata de outro card mantido, (ii) reprovado pelo Filtro Negativo (genética/biologia molecular de bancada sem impacto clínico, história/datas), ou (iii) preenchimento trivial sem alavanca clínica real.
  c) ESCOLHA FLUIDA DE FORMATO (SEM COTA 50/50): Para cada card sobrevivente ou novo, escolha livremente "basic" (condutas, diferenciais, imagens recognition, mecanismos causais "por que/como") ou "cloze" (critérios numéricos, limiares, doses críticas e alvos em âncora clínica enxuta com 1 única lacuna {{c1::...}}). Em "cloze" de regra geral, NÃO force vinheta artificial com idade/tempo de uso quando isso não altera a conduta.
- NÃO inclua o campo "sources" nos cards.

4. DOUTRINA INTERNATO-FIRST GERAL (P1 -> P4 ADAPTÁVEL POR PERFIL DE DOMÍNIO), IMAGENS FIDEDIGNAS E FORMATAÇÃO:
- A matriz P1–P4 adapta-se dinamicamente ao **Perfil de Domínio** ativo do tema ("emergencia", "ambulatorio", "cirurgico", "preventiva_normativo"), conforme bloco de perfil fornecido em cada requisição:
  * **P1** = Prioridade Máxima / Conduta Crítica do Perfil (emergência/minuto zero no perfil Emergência; indicação cirúrgica/choque/dano no Cirúrgico; indicação/contraindicação/critério diagnóstico no Ambulatorial; lei/sigilo/notificação/princípio ético-SUS no Preventiva/Normativo).
  * **P2** = Decisão Diagnóstica, Estadiamento, Escores e Reconhecimento Visual (exames reais em image_mode: "recognition", pontos de corte numéricos exatos, interpretação de medidas/índices).
  * **P3** = Manejo Longitudinal / Seguimento / Prevenção / Fluxo Operacional (tratamento de 1ª linha, populações especiais, rastreamento, vacinas, reabilitação, prazos/fluxos documentais).
  * **P4** = Fisiopatologia Aplicada, Diferenciais e Armadilhas Clássicas de Banca (mecanismos causais, pares confundíveis, exceções normativas).
- FILTRO NEGATIVO ESTRITO: ZERO genética/biologia molecular de bancada sem impacto terapêutico imediato, ZERO história da medicina/datas e ZERO epidemiologia percentual solta que não mude conduta.
- PROIBIDO LaTeX ($...$, \\rightarrow, \\ge, \\le): use exclusivamente Unicode nativo (→, ≥, ≤, ±, α, β, µg, mEq/L) e HTML (<sub>, <sup>, <b>).
- PROIBIDO categorias antigas da FDA na gestação ("Categoria B/C/D/X").
- "hint": sempre iniciando com "<b>Comentário:</b> " (ou precedido por <i>Legenda visual...</i><br><br> nos cards recognition) de 1 a 2 frases (180 a 300 caracteres visíveis medidos APÓS o prefixo "<b>Comentário:</b> ", teto estrito de 320 chars), termos-chave em <b>negrito</b> e contraste diferencial/causal obrigatório.`;

function extractJsonBlock(text: string): string {
  if (!text) return '{}';
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  if (firstBrace === -1 && firstBracket === -1) return text.trim();
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    const lastBracket = text.lastIndexOf(']');
    if (lastBracket > firstBracket) return text.slice(firstBracket, lastBracket + 1);
  }
  if (firstBrace !== -1) {
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace > firstBrace) return text.slice(firstBrace, lastBrace + 1);
  }
  return text.trim();
}

function sanitizeCardTextForPrompt(value: unknown, maxLen: number): string {
  return String(value || '')
    .replace(/src=["']data:image\/[^"']+["']/gi, 'src="[IMAGEM_EMBUTIDA]"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function buildFullCardsDigest(rawCards: Array<Record<string, unknown>>): string {
  if (!Array.isArray(rawCards) || rawCards.length === 0) {
    return 'Nenhum JSON anterior enviado.';
  }
  return rawCards
    .map((c) => {
      const id = c.id ?? '';
      const type = c.type === 'cloze' ? 'cloze' : 'basic';
      const priority = c.priority ? ` ${String(c.priority)}` : '';
      const topic = sanitizeCardTextForPrompt(c.topic, 140);
      const q = sanitizeCardTextForPrompt(c.question, 600);
      const a = sanitizeCardTextForPrompt(c.answer, 250);
      const h = sanitizeCardTextForPrompt(c.hint, 700);
      return [
        `- ID:${id} [${type}${priority}]`,
        `  Topic: "${topic}"`,
        `  Q: "${q}"`,
        a ? `  A: "${a}"` : null,
        h ? `  Hint: "${h}"` : null,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
}

function parseOrRecoverNotesJsonWithMeta(rawText: string): {
  notes: Array<Record<string, unknown>>;
  wasTruncated: boolean;
} {
  const cleanedJson = extractJsonBlock(rawText);
  try {
    const parsed = JSON.parse(cleanedJson);
    if (Array.isArray(parsed)) return { notes: parsed, wasTruncated: false };
    if (parsed && Array.isArray(parsed.notes)) {
      return { notes: parsed.notes, wasTruncated: false };
    }
  } catch {
    const recovered: Array<Record<string, unknown>> = [];
    const objRegex = /\{[^{}]*"id"\s*:\s*\d+[^{}]*"question"\s*:\s*"[\s\S]*?"[^{}]*\}/g;
    let match: RegExpExecArray | null;
    while ((match = objRegex.exec(rawText)) !== null) {
      try {
        const obj = JSON.parse(match[0]);
        if (obj && typeof obj === 'object' && obj.question) {
          recovered.push(obj);
        }
      } catch {
        // skip malformed fragment
      }
    }
    if (recovered.length > 0) return { notes: recovered, wasTruncated: true };
    throw new Error('Resposta JSON truncada ou inválida do modelo.');
  }
  return { notes: [], wasTruncated: false };
}

function parseOrRecoverNotesJson(rawText: string): Array<Record<string, unknown>> {
  return parseOrRecoverNotesJsonWithMeta(rawText).notes;
}

function extractErrorDetails(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const rec = current as { message?: unknown; code?: unknown; status?: unknown; cause?: unknown };
    const codeStr = rec.code ? `[${String(rec.code)}]` : '';
    const msgStr = typeof rec.message === 'string' ? rec.message.trim() : '';
    const combined = [codeStr, msgStr].filter(Boolean).join(' ');
    if (combined && !parts.includes(combined)) {
      parts.push(combined);
    }
    current = rec.cause;
  }
  if (parts.length === 0 && error != null) {
    parts.push(String(error));
  }
  return parts.join(' → ');
}

function formatGeminiError(error: unknown, fallbackMessage: string): string {
  const raw = extractErrorDetails(error) || fallbackMessage;
  if (/402|prepayment credits are depleted|billing#prepay/i.test(raw)) {
    return 'Créditos pré-pagos da chave Gemini esgotados (402 RESOURCE_EXHAUSTED). Troque a chave ou adicione créditos em AI Studio.';
  }
  if (/503|UNAVAILABLE|high demand/i.test(raw)) {
    return 'Servidor da API Gemini temporariamente sobrecarregado (503 UNAVAILABLE). Tente novamente em alguns segundos.';
  }
  if (/429|RESOURCE_EXHAUSTED|quota exceeded/i.test(raw)) {
    const isDaily = /per day|PerDay|limit:\s*20/i.test(raw);
    return isDaily
      ? 'Cota diária da API Gemini esgotada (429 RESOURCE_EXHAUSTED — Free Tier: 20 req/dia no gemini-4-hydrogen). Aguarde a renovação da cota ou configure uma chave com faturamento.'
      : 'Limite de requisições por minuto da API Gemini atingido (429 RESOURCE_EXHAUSTED). Aguarde alguns segundos e tente novamente.';
  }
  if (/fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_|socket hang up|other side closed|AbortError|TimeoutError/i.test(raw)) {
    return `Falha de conexão com a API Gemini após novas tentativas (${raw}). Tente novamente ou reduza a quantidade de PDFs simultâneos.`;
  }
  return raw || fallbackMessage;
}

function isRetryableGeminiError(error: unknown): boolean {
  const raw = extractErrorDetails(error);
  if (/402|prepayment credits|PerDay|limit:\s*20|API_KEY_INVALID|PERMISSION_DENIED/i.test(raw)) {
    return false;
  }
  return /fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_|socket hang up|other side closed|network|terminated|503|502|504|500|UNAVAILABLE|high demand|DEADLINE_EXCEEDED|429|RESOURCE_EXHAUSTED/i.test(
    raw
  );
}

async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0]
): Promise<{
  text: string;
  finishReason?: string;
  groundingSources: Array<{ title: string; uri: string }>;
}> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Stream chunks so TCP traffic stays active during long multi-PDF reasoning
      const stream = await ai.models.generateContentStream(params);
      let fullText = '';
      let finishReason: string | undefined;
      const groundingChunks: Array<{ web?: { uri?: string; title?: string } }> = [];

      for await (const chunk of stream) {
        const c = chunk as GenerateContentResponse;
        if (c.text) {
          fullText += c.text;
        }
        const cand = c.candidates?.[0];
        if (cand?.finishReason) {
          finishReason = String(cand.finishReason);
        }
        const chunks = cand?.groundingMetadata?.groundingChunks;
        if (Array.isArray(chunks) && chunks.length > 0) {
          groundingChunks.push(...chunks);
        }
      }

      const seen = new Set<string>();
      const groundingSources: Array<{ title: string; uri: string }> = [];
      for (const ch of groundingChunks) {
        const uri = ch?.web?.uri;
        const title = ch?.web?.title || uri || 'Diretriz / Fonte Médica';
        if (uri && !seen.has(uri)) {
          seen.add(uri);
          groundingSources.push({ title, uri });
        }
      }

      return { text: fullText, finishReason, groundingSources };
    } catch (error: unknown) {
      lastError = error;
      console.error(`[gemini] attempt ${attempt}/${maxAttempts} failed:`, extractErrorDetails(error));
      if (attempt < maxAttempts && isRetryableGeminiError(error)) {
        const delayMs = attempt === 1 ? 2000 : 5000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

interface UploadedFileCacheEntry {
  uri: string;
  mimeType: string;
  name: string;
  uploadedAt: number;
}

const GEMINI_FILE_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h (Files API retains 48h)
const geminiUploadedFileCache = new Map<string, UploadedFileCacheEntry>();
const geminiUploadInFlight = new Map<string, Promise<UploadedFileCacheEntry>>();

interface InputDocumentPayload {
  name?: string;
  mimeType?: string;
  base64Data?: string;
  fileUri?: string;
  fileName?: string;
  textContent?: string;
  docRole?: string;
}

async function uploadSinglePdfToGeminiFiles(
  ai: GoogleGenAI,
  doc: InputDocumentPayload
): Promise<UploadedFileCacheEntry> {
  const base64Data = String(doc.base64Data || '');
  const mimeType = doc.mimeType || 'application/pdf';
  const hash = crypto.createHash('sha256').update(base64Data).digest('hex');

  const cached = geminiUploadedFileCache.get(hash);
  if (cached && Date.now() - cached.uploadedAt < GEMINI_FILE_CACHE_TTL_MS) {
    return cached;
  }

  const existingPromise = geminiUploadInFlight.get(hash);
  if (existingPromise) {
    return existingPromise;
  }

  const uploadTask = (async (): Promise<UploadedFileCacheEntry> => {
    const buffer = Buffer.from(base64Data, 'base64');
    const blob = new Blob([buffer], { type: mimeType });
    let lastErr: unknown;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        let uploaded = await ai.files.upload({
          file: blob,
          config: {
            mimeType,
            displayName: doc.name || `documento_${hash.slice(0, 8)}.pdf`,
          },
        });

        let polls = 0;
        while (uploaded.state === 'PROCESSING' && uploaded.name && polls < 15) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          uploaded = await ai.files.get({ name: uploaded.name });
          polls++;
        }

        if (uploaded.state === 'FAILED' || !uploaded.uri) {
          throw new Error(`Falha ao processar arquivo "${doc.name || 'PDF'}" na Gemini Files API.`);
        }

        const entry: UploadedFileCacheEntry = {
          uri: uploaded.uri,
          mimeType: uploaded.mimeType || mimeType,
          name: uploaded.name || '',
          uploadedAt: Date.now(),
        };
        geminiUploadedFileCache.set(hash, entry);
        return entry;
      } catch (err: unknown) {
        lastErr = err;
        console.error(
          `[gemini-files-upload] attempt ${attempt}/3 failed for ${doc.name || 'PDF'}:`,
          extractErrorDetails(err)
        );
        if (attempt < 3 && isRetryableGeminiError(err)) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
          continue;
        }
        throw err;
      }
    }

    throw lastErr;
  })();

  geminiUploadInFlight.set(hash, uploadTask);
  try {
    return await uploadTask;
  } finally {
    geminiUploadInFlight.delete(hash);
  }
}

async function resolveDocumentPartsForGemini(
  ai: GoogleGenAI,
  pdfs: InputDocumentPayload[]
): Promise<Part[]> {
  const parts: Part[] = [];
  if (!Array.isArray(pdfs)) return parts;

  for (const pdf of pdfs) {
    if (pdf?.textContent && typeof pdf.textContent === 'string') {
      parts.push({
        text: `DOCUMENTO ANEXADO (${pdf.name || 'Texto/Questões'}):\n${pdf.textContent.slice(0, 60000)}`,
      });
    } else if (pdf?.fileUri && typeof pdf.fileUri === 'string') {
      parts.push(createPartFromUri(pdf.fileUri, pdf.mimeType || 'application/pdf'));
    } else if (pdf?.base64Data && typeof pdf.base64Data === 'string') {
      const mimeType = pdf.mimeType || 'application/pdf';
      try {
        const uploaded = await uploadSinglePdfToGeminiFiles(ai, pdf);
        parts.push(createPartFromUri(uploaded.uri, uploaded.mimeType));
      } catch (uploadErr) {
        // Fallback to inlineData only when total inline size is safe (< ~10 MB binary)
        if (pdf.base64Data.length < 13_500_000) {
          console.warn(
            `[gemini] Falling back to inlineData for ${pdf.name || 'PDF'}:`,
            extractErrorDetails(uploadErr)
          );
          parts.push({
            inlineData: {
              mimeType,
              data: pdf.base64Data,
            },
          });
        } else {
          throw uploadErr;
        }
      }
    }
  }

  return parts;
}

// PT -> EN medical translation dictionary for high-recall real medical image retrieval
const PT_TO_EN_MEDICAL_TERMS: Array<[RegExp, string]> = [
  [/\bapendicite(?:\s+aguda)?\b/gi, 'acute appendicitis CT ultrasound'],
  [/\bdiverticulite(?:\s+aguda)?\b/gi, 'acute diverticulitis abdominal CT'],
  [/\bcolecistite(?:\s+aguda)?\b/gi, 'acute cholecystitis gallbladder ultrasound'],
  [/\bpancreatite(?:\s+aguda)?\b/gi, 'acute pancreatitis abdominal CT'],
  [/\bpneumot[oó]rax(?:\s+hipertensivo)?\b/gi, 'tension pneumothorax chest x-ray'],
  [/\bpneumoperit[oô]nio\b/gi, 'pneumoperitoneum upright chest x-ray'],
  [/\bedema\s+agudo\s+de\s+pulm[aã]o\b/gi, 'acute pulmonary edema chest x-ray'],
  [/\binsufici[eê]ncia\s+card[ií]aca\b/gi, 'congestive heart failure cardiomegaly chest x-ray'],
  [/\binfarto|iam|supradesnivelamento\b/gi, 'ST elevation myocardial infarction ECG LITFL'],
  [/\bfibrila[cç][aã]o\s+atrial\b/gi, 'atrial fibrillation ECG rhythm strip'],
  [/\btaquicardia\s+ventricular\b/gi, 'ventricular tachycardia ECG'],
  [/\bflutter\s+atrial\b/gi, 'atrial flutter sawtooth ECG'],
  [/\bbloqueio\s+atrioventricular\b/gi, 'third degree AV block complete heart block ECG'],
  [/\bcardiotocografia|dip\s+ii|desacelera[cç][aã]o|sofrimento\s+fetal|taquissistolia|uterot[oô]nic/gi, 'cardiotocography fetal heart rate deceleration uterine tachysystole'],
  [/\bindu[cç][aã]o\s+do\s+parto|misoprostol|ocitocina\b/gi, 'cardiotocography uterine tachysystole labor induction'],
  [/\bpr[eé][-\s]?ecl[aâ]mpsia|ecl[aâ]mpsia|s[ií]ndrome\s+hellp\b/gi, 'HELLP syndrome schistocytes peripheral blood smear'],
  [/\bhemorragia\s+p[oó]s[-\s]?parto|bal[aã]o\s+de\s+bakri|atonia\s+uterina\b/gi, 'postpartum hemorrhage Bakri balloon tamponade'],
  [/\bgravidez\s+ect[oó]pica\b/gi, 'ectopic pregnancy transvaginal ultrasound'],
  [/\bdescolamento\s+prematuro\s+de\s+placenta|placenta\s+pr[eé]via\b/gi, 'placental abruption placenta previa ultrasound'],
  [/\bpartograma\b/gi, 'partogram labor progression WHO curve'],
  [/\bpneumonia\b/gi, 'lobar pneumonia consolidation chest x-ray'],
  [/\btuberculose\b/gi, 'pulmonary tuberculosis cavitation chest x-ray'],
  [/\bderrame\s+pleural\b/gi, 'pleural effusion chest x-ray meniscus sign'],
  [/\btromboembolismo\s+pulmonar|\btep\b/gi, 'pulmonary embolism CT pulmonary angiography'],
  [/\bavc\s+isqu[eê]mico\b/gi, 'ischemic stroke brain CT'],
  [/\bavc\s+hemorr[aá]gico|hemorragia\s+subaracn[oó]idea\b/gi, 'subarachnoid hemorrhage head CT'],
  [/\bhematoma\s+epidural\b/gi, 'epidural hematoma lens shaped head CT'],
  [/\bhematoma\s+subdural\b/gi, 'subdural hematoma crescent head CT'],
  [/\bobstru[cç][aã]o\s+intestinal|volvo\b/gi, 'bowel obstruction sigmoid volvulus coffee bean x-ray'],
  [/\bintussuscep[cç][aã]o\b/gi, 'intussusception target sign pediatric ultrasound'],
  [/\bestenose\s+hipertr[oó]fica\s+de\s+piloro\b/gi, 'hypertrophic pyloric stenosis ultrasound'],
  [/\bepigloti(?:te|tis)|crupe|laringotraque[ií]te\b/gi, 'croup steeple sign epiglottitis thumbprint neck x-ray'],
  [/\bbronquiolite\b/gi, 'bronchiolitis chest x-ray hyperinflation pediatric'],
  [/\bdoen[cç]a\s+da\s+membrana\s+hialina|s[ií]ndrome\s+do\s+desconforto\b/gi, 'neonatal respiratory distress syndrome ground glass chest x-ray'],
  [/\bretinopatia\s+hipertensiva|retinopatia\s+diab[eé]tica|fundoscopia\b/gi, 'hypertensive diabetic retinopathy fundus photography'],
  [/\bpapiledema\b/gi, 'papilledema optic disc fundoscopy'],
  [/\bmelanoma|carcinoma\s+basocelular|dermatoscopia\b/gi, 'melanoma basal cell carcinoma dermoscopy'],
  [/\bherpes\s+zoster|varicela|impetigo|celulite|erisipela\b/gi, 'herpes zoster dermatome skin rash clinical photo'],
  [/\bs[ií]filis|cancro|linfogranuloma\b/gi, 'secondary syphilis palmar plantar rash clinical photo'],
  [/\bcirrose|ascite|varizes\s+esof[aá]gicas\b/gi, 'esophageal varices endoscopy liver cirrhosis'],
  [/\bfratura|luxa[cç][aã]o|osteomielite\b/gi, 'bone fracture dislocation radiograph x-ray'],
];

const BLOCKED_IMAGE_URL_PATTERN =
  /(?:logo|icon|favicon|avatar|gravatar|pb-primary|dark-mode|banner|badge|pixel|1x1|sprite|spinner|button|social|share|commons-logo|ambox|edit-clear|question_book|crystal_clear|padlock|symbol_|flag_of_|coat_of_arms|map_of_|blank_map|wikimedia-button|poweredby|boeing|airlines|airport|stamp_of_|coin_)/i;

function isSpamOrLogoImageUrl(url: string, title = ''): boolean {
  const combined = `${url} ${title}`;
  if (!url || BLOCKED_IMAGE_URL_PATTERN.test(combined)) return true;
  if (/\.(?:tif|tiff|pdf|djvu|ogg|ogv|webm|mp4|mp3|wav)$/i.test(url.split('?')[0])) {
    return true;
  }
  return false;
}

function buildEnglishMedicalSearchQueries(
  rawQuery: string,
  topic = '',
  question = ''
): string[] {
  const queries: string[] = [];
  const combined = `${rawQuery} ${topic} ${question}`;

  for (const [regex, enTerm] of PT_TO_EN_MEDICAL_TERMS) {
    if (regex.test(combined) && !queries.includes(enTerm)) {
      queries.push(enTerm);
      if (queries.length >= 2) break;
    }
  }

  const stripped = rawQuery
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(
      /\b(?:na|no|nos|nas|em|de|do|da|dos|das|para|com|sem|qual|quais|conduta|imediata|primeira|escolha|linha|tratamento|manejo|paciente|gestante|evolui|apresenta|reacao|adversa|exame|achado)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (stripped && !queries.includes(stripped)) {
    queries.push(stripped);
  }
  if (queries.length === 0) {
    queries.push('clinical medical imaging diagnosis');
  }
  return queries.slice(0, 3);
}

/**
 * Uses Gemini (when available) to translate a Portuguese clinical prompt/card into 2–3 high-signal
 * English medical image search queries (e.g., "uterine tachysystole cardiotocography", "late deceleration CTG").
 */
async function expandMedicalQueriesWithGemini(
  ai: GoogleGenAI | null,
  rawQuery: string,
  topic = '',
  question = '',
  hint = ''
): Promise<string[]> {
  const fallbackQueries = buildEnglishMedicalSearchQueries(rawQuery, topic, question);
  if (!ai) return fallbackQueries;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Traduza e expanda esta busca clínica para encontrar IMAGENS MÉDICAS REAIS na internet (Wikimedia Commons, Wikipedia, Radiopaedia, LITFL, DermNet, PubMed).
Retorne EXCLUSIVAMENTE um JSON array com 2 a 3 termos curtos em INGLÊS (2 a 5 palavras cada, focados no exame/foto/traçado clínico real):
- Busca: "${rawQuery}"
- Tópico: "${topic}"
- Pergunta: "${question.slice(0, 220)}"
- Comentário: "${hint.slice(0, 180)}"
Exemplo de saída: ["cardiotocography late decelerations", "uterine tachysystole CTG"]`,
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 200,
      },
    });
    const parsed = JSON.parse(extractJsonBlock(response.text || '[]'));
    if (Array.isArray(parsed)) {
      const llmQueries = parsed
        .map((q) => String(q || '').trim())
        .filter((q) => q.length >= 3 && q.length <= 70);
      if (llmQueries.length > 0) {
        return Array.from(new Set([...llmQueries, ...fallbackQueries])).slice(0, 3);
      }
    }
  } catch {
    // Silent fallback to deterministic PT->EN medical dictionary
  }
  return fallbackQueries;
}

interface MedicalImageCandidate {
  id: string;
  title: string;
  thumbUrl: string;
  fullUrl: string;
  description: string;
  suggestedFilename: string;
  defaultLegend: string;
  source: string;
  isSvg?: boolean;
}

const WIKIMEDIA_USER_AGENT =
  'Cards20MedicalApp/2.0 (https://github.com/wagmms/Cards-2.0)';

/**
 * Searches English and Portuguese Wikipedia articles for real curated medical images
 * attached to peer-reviewed encyclopedic articles (avoiding noisy Commons spam).
 */
async function searchWikipediaMedicalImages(
  enQueries: string[],
  ptQuery: string
): Promise<MedicalImageCandidate[]> {
  const primaryEn = (enQueries[0] || '').split(/\s+/).slice(0, 4).join(' ');
  const searches: Array<{ lang: 'en' | 'pt'; query: string }> = [
    ...(primaryEn ? [{ lang: 'en' as const, query: primaryEn }] : []),
    ...(ptQuery ? [{ lang: 'pt' as const, query: ptQuery }] : []),
  ];

  const results: MedicalImageCandidate[] = [];
  const seenUrls = new Set<string>();

  for (const { lang, query } of searches) {
    if (results.length >= 6) break;
    try {
      const searchUrl = new URL(`https://${lang}.wikipedia.org/w/api.php`);
      searchUrl.searchParams.set('action', 'query');
      searchUrl.searchParams.set('list', 'search');
      searchUrl.searchParams.set('srsearch', query);
      searchUrl.searchParams.set('srlimit', '3');
      searchUrl.searchParams.set('format', 'json');
      searchUrl.searchParams.set('origin', '*');

      const sResp = await fetch(searchUrl.toString(), {
        headers: { 'User-Agent': WIKIMEDIA_USER_AGENT },
        signal: AbortSignal.timeout(3500),
      });
      if (!sResp.ok) continue;
      const sData = (await sResp.json()) as {
        query?: { search?: Array<{ title?: string }> };
      };
      const titles = (sData.query?.search || [])
        .map((item) => item.title)
        .filter((t): t is string => Boolean(t));
      if (titles.length === 0) continue;

      const pagesUrl = new URL(`https://${lang}.wikipedia.org/w/api.php`);
      pagesUrl.searchParams.set('action', 'query');
      pagesUrl.searchParams.set('titles', titles.join('|'));
      pagesUrl.searchParams.set('prop', 'pageimages|images');
      pagesUrl.searchParams.set('piprop', 'original|thumbnail');
      pagesUrl.searchParams.set('pithumbsize', '900');
      pagesUrl.searchParams.set('imlimit', '20');
      pagesUrl.searchParams.set('format', 'json');
      pagesUrl.searchParams.set('origin', '*');

      const pResp = await fetch(pagesUrl.toString(), {
        headers: { 'User-Agent': WIKIMEDIA_USER_AGENT },
        signal: AbortSignal.timeout(3500),
      });
      if (!pResp.ok) continue;
      const pData = (await pResp.json()) as {
        query?: {
          pages?: Record<
            string,
            {
              title?: string;
              thumbnail?: { source?: string };
              original?: { source?: string };
              images?: Array<{ title?: string }>;
            }
          >;
        };
      };

      const fileTitles = new Set<string>();
      for (const page of Object.values(pData.query?.pages || {})) {
        for (const img of page.images || []) {
          if (img.title && !isSpamOrLogoImageUrl(img.title, img.title)) {
            fileTitles.add(img.title);
          }
        }
      }

      if (fileTitles.size === 0) continue;
      const fileList = Array.from(fileTitles).slice(0, 10);

      const infoUrl = new URL(`https://${lang}.wikipedia.org/w/api.php`);
      infoUrl.searchParams.set('action', 'query');
      infoUrl.searchParams.set('titles', fileList.join('|'));
      infoUrl.searchParams.set('prop', 'imageinfo');
      infoUrl.searchParams.set('iiprop', 'url|mime|size|extmetadata');
      infoUrl.searchParams.set('iiurlwidth', '900');
      infoUrl.searchParams.set('format', 'json');
      infoUrl.searchParams.set('origin', '*');

      const iResp = await fetch(infoUrl.toString(), {
        headers: { 'User-Agent': WIKIMEDIA_USER_AGENT },
        signal: AbortSignal.timeout(3500),
      });
      if (!iResp.ok) continue;
      const iData = (await iResp.json()) as {
        query?: {
          pages?: Record<
            string,
            {
              pageid?: number;
              title?: string;
              imageinfo?: Array<{
                thumburl?: string;
                url?: string;
                mime?: string;
                width?: number;
                height?: number;
                extmetadata?: { ImageDescription?: { value?: string } };
              }>;
            }
          >;
        };
      };

      for (const [idx, page] of Object.values(iData.query?.pages || {}).entries()) {
        const info = page.imageinfo?.[0];
        if (!info?.url) continue;
        const mime = (info.mime || '').toLowerCase();
        if (!mime.startsWith('image/')) continue;
        if ((info.width || 0) < 220 || (info.height || 0) < 140) continue;

        const targetUrl = info.thumburl || info.url;
        if (isSpamOrLogoImageUrl(targetUrl, page.title || '')) continue;
        if (seenUrls.has(targetUrl)) continue;
        seenUrls.add(targetUrl);

        const rawTitle = (page.title || `Wikipedia Medical ${idx + 1}`).replace(/^(?:File|Ficheiro|Arquivo):/i, '');
        const cleanName = rawTitle
          .toLowerCase()
          .replace(/[^a-z0-9.]+/g, '_')
          .replace(/^_|_$/g, '');
        const descHtml = info.extmetadata?.ImageDescription?.value || rawTitle;
        const cleanDesc = descHtml
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 180);

        results.push({
          id: `wp-${lang}-${page.pageid || idx}`,
          title: rawTitle.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 85),
          thumbUrl: targetUrl,
          fullUrl: info.url,
          description: cleanDesc || `Imagem médica enciclopédica (${lang}.wikipedia.org).`,
          suggestedFilename: /\.(jpg|jpeg|png|webp|gif)$/i.test(cleanName)
            ? cleanName.slice(0, 60)
            : `${cleanName.slice(0, 52)}.jpg`,
          defaultLegend: cleanDesc
            ? `Imagem clínica demonstrando ${cleanDesc.slice(0, 130)}.`
            : `Imagem clínica real referente a ${query}.`,
          source: `Wikipedia Medical (${lang.toUpperCase()})`,
          isSvg: mime.includes('svg') || targetUrl.toLowerCase().endsWith('.svg'),
        });
      }
    } catch {
      // Continue to fallback query
    }
  }

  return results;
}

async function searchWikimediaCommonsMedical(enQueries: string[]): Promise<MedicalImageCandidate[]> {
  const results: MedicalImageCandidate[] = [];
  const seenUrls = new Set<string>();
  const baseWords = (enQueries[0] || '').split(/\s+/).filter(Boolean);
  const candidateSearches = Array.from(
    new Set([
      baseWords.slice(0, 3).join(' '),
      baseWords.slice(0, 2).join(' '),
    ].filter((q) => q.length >= 3))
  );

  for (const enQuery of candidateSearches) {
    if (results.length >= 4) break;
    try {
      const url = new URL('https://commons.wikimedia.org/w/api.php');
      url.searchParams.set('action', 'query');
      url.searchParams.set('generator', 'search');
      url.searchParams.set('gsrsearch', enQuery);
      url.searchParams.set('gsrnamespace', '6');
      url.searchParams.set('gsrlimit', '10');
      url.searchParams.set('prop', 'imageinfo');
      url.searchParams.set('iiprop', 'url|mime|size|extmetadata');
      url.searchParams.set('iiurlwidth', '900');
      url.searchParams.set('format', 'json');
      url.searchParams.set('origin', '*');

      const resp = await fetch(url.toString(), {
        headers: { 'User-Agent': WIKIMEDIA_USER_AGENT },
        signal: AbortSignal.timeout(3500),
      });
      if (!resp.ok) continue;

      const data = (await resp.json()) as {
        query?: {
          pages?: Record<
            string,
            {
              pageid?: number;
              title?: string;
              imageinfo?: Array<{
                thumburl?: string;
                url?: string;
                mime?: string;
                width?: number;
                height?: number;
                extmetadata?: {
                  ImageDescription?: { value?: string };
                };
              }>;
            }
          >;
        };
      };

      const pages = Object.values(data?.query?.pages || {}).sort((a, b) => {
        const aAnn = /annotation|labeled|arrow/i.test(a.title || '') ? 1 : 0;
        const bAnn = /annotation|labeled|arrow/i.test(b.title || '') ? 1 : 0;
        return aAnn - bAnn;
      });

      for (const [idx, p] of pages.entries()) {
        const info = p.imageinfo?.[0];
        if (!info?.url) continue;
        const mime = (info.mime || '').toLowerCase();
        if (!mime.startsWith('image/')) continue;
        if ((info.width || 0) < 220 || (info.height || 0) < 140) continue;

        const targetUrl = info.thumburl || info.url;
        const rawTitle = (p.title || `Imagem Médica ${idx + 1}`).replace(/^File:/i, '');
        if (isSpamOrLogoImageUrl(targetUrl, rawTitle)) continue;
        if (seenUrls.has(targetUrl)) continue;
        seenUrls.add(targetUrl);

        const cleanName = rawTitle
          .toLowerCase()
          .replace(/[^a-z0-9.]+/g, '_')
          .replace(/^_|_$/g, '');
        const descHtml = info.extmetadata?.ImageDescription?.value || rawTitle;
        const cleanDesc = descHtml
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 180);

        results.push({
          id: `wiki-${p.pageid || idx}`,
          title: rawTitle.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 85),
          thumbUrl: targetUrl,
          fullUrl: info.url,
          description: cleanDesc || `Imagem médica real obtida no Wikimedia Commons.`,
          suggestedFilename: /\.(jpg|jpeg|png|webp|gif)$/i.test(cleanName)
            ? cleanName.slice(0, 60)
            : `${cleanName.slice(0, 52)}.jpg`,
          defaultLegend: cleanDesc
            ? `Exame complementar demonstrando ${cleanDesc.slice(0, 130)}.`
            : `Imagem diagnóstica demonstrando achado clínico real de ${enQuery}.`,
          source: 'Wikimedia Commons Medical',
          isSvg: mime.includes('svg') || targetUrl.toLowerCase().endsWith('.svg'),
        });
      }
    } catch {
      // Continue to shorter query fallback
    }
  }

  return results;
}

/**
 * Validates that a candidate image URL responds with HTTP 200, Content-Type: image/*,
 * and a reasonable minimum byte size (discarding broken thumbnails, icons, logos, or HTML error pages).
 */
async function validateCandidateImageUrl(url: string): Promise<{
  ok: boolean;
  contentType: string;
  byteLength: number;
  isSvg: boolean;
}> {
  if (!url || (!url.startsWith('https://') && !url.startsWith('http://'))) {
    return { ok: false, contentType: '', byteLength: 0, isSvg: false };
  }
  if (isSpamOrLogoImageUrl(url)) {
    return { ok: false, contentType: '', byteLength: 0, isSvg: false };
  }
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; InternatoFirstCardArchitect/2.0; +https://github.com/wagmms/Cards-2.0)',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(4500),
    });
    if (!resp.ok) {
      return { ok: false, contentType: '', byteLength: 0, isSvg: false };
    }
    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      return { ok: false, contentType, byteLength: 0, isSvg: false };
    }
    const isSvg = contentType.includes('svg');
    const buf = Buffer.from(await resp.arrayBuffer());
    const minBytes = isSvg ? 1500 : 3000;
    if (buf.length < minBytes) {
      return { ok: false, contentType, byteLength: buf.length, isSvg };
    }
    return { ok: true, contentType, byteLength: buf.length, isSvg };
  } catch {
    return { ok: false, contentType: '', byteLength: 0, isSvg: false };
  }
}

/**
 * Extracts real clinical `<img>` and OpenGraph (`og:image`, `twitter:image`) URLs from a grounded medical web page
 * (e.g. LITFL, Radiopaedia, DermNet, Wikipedia, PMC, SciELO) without falling back to synthetic images or site logos.
 */
async function extractImagesFromMedicalWebPage(
  pageUrl: string,
  pageTitle = ''
): Promise<Array<{ url: string; alt: string; pageUrl: string; pageTitle: string }>> {
  if (!pageUrl || !pageUrl.startsWith('http')) return [];
  try {
    const resp = await fetch(pageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(3500),
    });
    if (!resp.ok) return [];
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return [];

    const html = (await resp.text()).slice(0, 220000);
    const extracted: Array<{ url: string; alt: string; pageUrl: string; pageTitle: string }> = [];
    const seen = new Set<string>();

    const addCandidate = (rawSrc: string, alt = '') => {
      const trimmed = rawSrc.trim().replace(/&amp;/g, '&');
      if (!trimmed || trimmed.startsWith('data:')) return;
      try {
        const resolved = new URL(trimmed, pageUrl).toString();
        if (!resolved.startsWith('http')) return;
        if (isSpamOrLogoImageUrl(resolved, alt)) return;
        if (seen.has(resolved)) return;
        seen.add(resolved);
        extracted.push({ url: resolved, alt: alt.trim(), pageUrl, pageTitle });
      } catch {
        // Ignore malformed URLs
      }
    };

    // 1) OpenGraph / Twitter meta images
    const metaRegex =
      /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:secure_url)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = metaRegex.exec(html)) !== null) {
      addCandidate(m[1], pageTitle);
    }
    const metaReverseRegex =
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:secure_url)["'][^>]*>/gi;
    while ((m = metaReverseRegex.exec(html)) !== null) {
      addCandidate(m[1], pageTitle);
    }

    // 2) Content <img> tags (src / data-src / data-lazy-src)
    const imgRegex = /<img\b[^>]*>/gi;
    while ((m = imgRegex.exec(html)) !== null && extracted.length < 10) {
      const tag = m[0];
      const srcMatch =
        /\b(?:data-lazy-src|data-src|src)=["']([^"']+)["']/i.exec(tag);
      if (!srcMatch) continue;
      const altMatch = /\balt=["']([^"']*)["']/i.exec(tag);
      const widthMatch = /\bwidth=["']?(\d+)/i.exec(tag);
      if (widthMatch && Number(widthMatch[1]) > 0 && Number(widthMatch[1]) < 150) {
        continue;
      }
      addCandidate(srcMatch[1], altMatch?.[1] || pageTitle);
    }

    return extracted;
  } catch {
    return [];
  }
}

/**
 * Searches Google/Web via Gemini Search Grounding (`tools: [{ googleSearch: {} }]`),
 * extracts BOTH grounded page images (`groundingChunks` + `og:image` / `<img>`) AND any validated direct URLs,
 * strictly returning only verified real images available on the internet.
 */
async function searchGoogleMedicalImagesViaGrounding(
  ai: GoogleGenAI | null,
  searchQuery: string,
  topic = '',
  question = '',
  enQueries: string[] = []
): Promise<MedicalImageCandidate[]> {
  if (!ai) return [];

  const enLabel = enQueries[0] || searchQuery;
  const prompt = `Pesquise na Web páginas médicas reais (LITFL, Radiopaedia, Wikimedia Commons, Wikipedia, DermNet NZ, SciELO, PubMed Central) com exames de imagem, traçados (ECG/CTG) ou fotos clínicas reais disponíveis publicamente sobre:
- Busca: "${searchQuery}" (${enLabel})
- Tópico: "${topic}"
- Contexto: "${question.slice(0, 180)}"

Retorne EXCLUSIVAMENTE um array JSON válido com até 5 referências encontradas no Google Search:
[
  {
    "title": "Título conciso do achado visual",
    "imageUrl": "URL direta do arquivo de imagem (.jpg/.png/.webp) ou URL da página médica encontrada",
    "description": "Descrição clínica objetiva do exame sem entregar o diagnóstico final",
    "source": "LITFL / Radiopaedia / Wikimedia / Wikipedia / DermNet / SciELO",
    "suggestedFilename": "nome_limpo_exame.jpg",
    "defaultLegend": "Exame complementar evidenciando [descrição morfológica do achado]."
  }
]`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const directCandidates: Array<{
      url: string;
      title: string;
      description: string;
      source: string;
      suggestedFilename: string;
      defaultLegend: string;
    }> = [];
    const groundedPages: Array<{ url: string; title: string }> = [];

    // 1) Collect groundingChunks (verified Google Search web pages)
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    for (const chunk of chunks) {
      const web = (chunk as { web?: { uri?: string; title?: string } }).web;
      if (web?.uri && web.uri.startsWith('http')) {
        groundedPages.push({
          url: web.uri,
          title: web.title || searchQuery,
        });
      }
    }

    // 2) Collect JSON candidates from model output
    try {
      const parsed = JSON.parse(extractJsonBlock(response.text || '[]'));
      const arr: Array<Record<string, unknown>> = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.images)
        ? parsed.images
        : [];
      for (const item of arr.slice(0, 6)) {
        const rawUrl = String(item.imageUrl || item.url || item.thumbUrl || '').trim();
        if (!rawUrl.startsWith('http')) continue;
        if (/\.(jpg|jpeg|png|webp|gif)(?:\?|$)/i.test(rawUrl)) {
          directCandidates.push({
            url: rawUrl,
            title: String(item.title || searchQuery).slice(0, 85),
            description: String(item.description || `Exame referente a ${searchQuery}.`).slice(0, 180),
            source: String(item.source || 'Google Search Grounding'),
            suggestedFilename: String(item.suggestedFilename || 'google_med_img.jpg'),
            defaultLegend: String(
              item.defaultLegend || `Imagem clínica referente a ${searchQuery}.`
            ),
          });
        } else {
          groundedPages.push({ url: rawUrl, title: String(item.title || searchQuery) });
        }
      }
    } catch {
      // Model might not have emitted strict JSON alongside groundingChunks
    }

    // 3) Scrape real <img> / og:image tags from top 5 grounded web pages in parallel
    const uniquePages = Array.from(
      new Map(groundedPages.map((p) => [p.url, p])).values()
    ).slice(0, 5);

    const pageExtracts = await Promise.all(
      uniquePages.map((page) => extractImagesFromMedicalWebPage(page.url, page.title))
    );
    for (const extractedList of pageExtracts) {
      for (const item of extractedList.slice(0, 3)) {
        let hostLabel = 'Medical Web (Google)';
        try {
          hostLabel = new URL(item.pageUrl).hostname.replace(/^www\./, '');
        } catch {
          // ignore
        }
        directCandidates.push({
          url: item.url,
          title: (item.alt || item.pageTitle || searchQuery).slice(0, 85),
          description: `Imagem real extraída de ${hostLabel}: ${(item.alt || item.pageTitle).slice(0, 140)}`,
          source: `${hostLabel} (via Google Search)`,
          suggestedFilename: (item.alt || item.pageTitle || searchQuery)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 44),
          defaultLegend: `Imagem clínica real (${hostLabel}) demonstrando ${(item.alt || item.pageTitle).slice(0, 110)}.`,
        });
      }
    }

    // 4) Validate all candidate URLs in parallel (HTTP 200, real image/*, min byte size)
    const uniqueDirect = Array.from(
      new Map(directCandidates.map((c) => [c.url, c])).values()
    ).slice(0, 12);

    const validated = await Promise.all(
      uniqueDirect.map(async (item, idx) => {
        const check = await validateCandidateImageUrl(item.url);
        if (!check.ok) return null;

        const ext = check.contentType.includes('png')
          ? '.png'
          : check.contentType.includes('webp')
          ? '.webp'
          : check.contentType.includes('svg')
          ? '.svg'
          : '.jpg';
        const cleanBase = item.suggestedFilename
          .toLowerCase()
          .replace(/\.[a-z0-9]+$/i, '')
          .replace(/[^a-z0-9_]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 48);

        return {
          id: `google-web-${idx}-${Date.now()}`,
          title: item.title,
          thumbUrl: item.url,
          fullUrl: item.url,
          description: item.description,
          suggestedFilename: `${cleanBase || `google_med_${idx + 1}`}${ext}`,
          defaultLegend: item.defaultLegend,
          source: item.source,
          isSvg: check.isSvg,
        } satisfies MedicalImageCandidate;
      })
    );

    return validated.filter((item): item is NonNullable<typeof item> => item !== null);
  } catch {
    return [];
  }
}

/**
 * Pure Node.js CRC32 + PKZIP builder so we can export both `.zip` bundles and `.apkg` packages
 * without native C++ addons.
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32Buffer(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipArchive(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = entry.data;
    const crc = crc32Buffer(dataBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x5421, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, dataBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += 30 + nameBuf.length + dataBuf.length;
  }

  const centralDirSize = centralParts.reduce((acc, b) => acc + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

async function resolveMediaSourceToBuffer(sourceUrl: string): Promise<Buffer | null> {
  if (!sourceUrl) return null;
  if (sourceUrl.startsWith('data:')) {
    const commaIdx = sourceUrl.indexOf(',');
    if (commaIdx === -1) return null;
    const header = sourceUrl.slice(0, commaIdx);
    const payload = sourceUrl.slice(commaIdx + 1);
    if (header.includes(';base64')) {
      return Buffer.from(payload, 'base64');
    }
    return Buffer.from(decodeURIComponent(payload), 'utf8');
  }
  if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
    try {
      const resp = await fetch(sourceUrl, {
        headers: {
          'User-Agent': 'InternatoFirstCardArchitect/2.0 (https://aistudio.google.com; medical-education)',
        },
        signal: AbortSignal.timeout(4000),
      });
      if (!resp.ok) return null;
      const arrBuf = await resp.arrayBuffer();
      return Buffer.from(arrBuf);
    } catch {
      return null;
    }
  }
  // If raw base64 string without data: prefix
  if (/^[A-Za-z0-9+/=\s]+$/.test(sourceUrl) && sourceUrl.length > 64) {
    try {
      return Buffer.from(sourceUrl.replace(/\s+/g, ''), 'base64');
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Resolves all media files requested by the deck using:
 * 1) `mediaAssets` uploaded/pasted in the user's browser session (exact or lowercase filename match)
 * 2) `mediaManifest` items (`data:` URI or `https://` download)
 * Never fails silently: returns both `resolvedMedia` buffers and a structured `missingMedia` list.
 */
async function resolveDeckMediaFiles(
  mediaManifest: Array<{ filename?: string; localFilename?: string; sourceUrl?: string; cardId?: number }>,
  mediaAssets: Record<string, string> = {}
): Promise<{
  resolvedMedia: Array<{ filename: string; data: Buffer }>;
  missingMedia: Array<{ filename: string; cardId?: number; reason: string }>;
}> {
  const normalizedAssetMap = new Map<string, string>();
  for (const [key, val] of Object.entries(mediaAssets || {})) {
    if (key && typeof val === 'string' && val) {
      const cleanKey = key.trim().toLowerCase();
      normalizedAssetMap.set(cleanKey, val);
      const base = cleanKey.split(/[\\/]/).pop();
      if (base) normalizedAssetMap.set(base, val);
    }
  }

  const seenFilenames = new Set<string>();
  const resolvedMedia: Array<{ filename: string; data: Buffer }> = [];
  const missingMedia: Array<{ filename: string; cardId?: number; reason: string }> = [];

  if (Array.isArray(mediaManifest)) {
    for (const item of mediaManifest) {
      const filename = String(item?.filename || item?.localFilename || '').trim();
      const sourceUrl = String(item?.sourceUrl || '').trim();
      if (!filename || seenFilenames.has(filename)) continue;
      seenFilenames.add(filename);

      const lowerName = filename.toLowerCase();
      const uploadedDataUri =
        normalizedAssetMap.get(lowerName) ||
        normalizedAssetMap.get(sourceUrl.toLowerCase());

      let buf: Buffer | null = null;
      if (uploadedDataUri) {
        buf = await resolveMediaSourceToBuffer(uploadedDataUri);
      }
      if (!buf && sourceUrl) {
        buf = await resolveMediaSourceToBuffer(sourceUrl);
      }

      if (buf && buf.length > 0) {
        resolvedMedia.push({ filename, data: buf });
      } else {
        missingMedia.push({
          filename,
          cardId: item?.cardId,
          reason: /^(?:https?:\/\/)/i.test(sourceUrl)
            ? `Falha ao baixar URL externa (${sourceUrl.slice(0, 80)})`
            : 'Arquivo local não encontrado nos assets carregados (04_Mídias)',
        });
      }
    }
  }

  // Also include any extra uploaded mediaAssets whose filename wasn't in mediaManifest
  for (const [rawName, dataUri] of Object.entries(mediaAssets || {})) {
    const cleanName = rawName.trim().split(/[\\/]/).pop() || '';
    if (!cleanName || seenFilenames.has(cleanName)) continue;
    const buf = await resolveMediaSourceToBuffer(dataUri);
    if (buf && buf.length > 0) {
      seenFilenames.add(cleanName);
      resolvedMedia.push({ filename: cleanName, data: buf });
    }
  }

  return { resolvedMedia, missingMedia };
}

// ============================================================================
// Direct Anki .apkg Builder (sql.js + genanki-compatible models, CSS & FSRS GUID)
// ============================================================================

const CLOZE_MODEL_ID = 1738331521911;
const CLOZE_MODEL_NAME = 'Med_Cloze_Inverted_v2';
const BASIC_MODEL_ID = 1738331521912;
const BASIC_MODEL_NAME = 'Med_Basic_Inverted_v2';
const GUID_SALT = 'criador-de-cards';

const ANKI_CLINICAL_CSS = `.card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 18.5px;
  line-height: 1.58;
  text-align: left;
  color: #1e293b;
  background-color: #f8fafc;
  padding: 24px;
}
.med-card { max-width: 740px; margin: 0 auto; }
.topic-box {
  display: inline-block; background-color: #f1f5f9; color: #0369a1;
  padding: 4px 10px; border-radius: 4px; font-size: 13.5px;
  font-weight: 700; margin-bottom: 12px; border: 1px solid #cbd5e1;
  text-transform: uppercase; letter-spacing: 0.5px;
}
b, strong { color: #0284c7; font-weight: 700; }
.cloze { font-weight: 700; color: #0284c7; border-bottom: 2px solid #38bdf8; padding: 0 2px; }
.front-content { font-size: 19.5px; color: #0f172a; line-height: 1.58; }
.back-content { font-size: 18.5px; color: #0f172a; line-height: 1.58; margin-top: 10px; }
.main-answer { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
.extra-box {
  margin-top: 16px; padding: 14px 18px; background: #f1f5f9;
  border-radius: 8px; border-left: 4px solid #0284c7;
  font-size: 16px; color: #334155; line-height: 1.52;
}
hr, hr#answer, hr.med-divider { border: 0; height: 1px; background: #cbd5e1; margin: 20px 0; }
img {
  max-width: 100%; max-height: 65vh; height: auto; border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12); margin: 14px auto 0;
  background: #ffffff; padding: 4px; display: block; object-fit: contain;
}
table.med-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 15px; }
table.med-table th, table.med-table td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
table.med-table th { background-color: #e0f2fe; color: #0369a1; font-weight: 700; }
.nightMode.card, .night_mode.card, body.nightMode, body.night_mode { background-color: #18181b !important; color: #f4f4f5 !important; }
.nightMode .topic-box, .night_mode .topic-box { background-color: #27272a !important; color: #7dd3fc !important; border-color: #3f3f46 !important; }
.nightMode .front-content, .nightMode .back-content, .night_mode .front-content, .night_mode .back-content, .nightMode .cloze-text, .night_mode .cloze-text { color: #f4f4f5 !important; }
.nightMode .main-answer, .night_mode .main-answer { color: #f4f4f5 !important; }
.nightMode b, .nightMode strong, .night_mode b, .night_mode strong { color: #38bdf8 !important; }
.nightMode .cloze, .night_mode .cloze { color: #38bdf8 !important; border-bottom: 2px solid #0ea5e9 !important; }
.nightMode .extra-box, .night_mode .extra-box { background: #27272a !important; border-left: 4px solid #38bdf8 !important; color: #e4e4e7 !important; }
.nightMode hr, .night_mode hr, .nightMode hr#answer, .night_mode hr#answer, .nightMode hr.med-divider, .night_mode hr.med-divider { background: #3f3f46 !important; }
.nightMode img, .night_mode img { background: #ffffff !important; border: 1px solid #3f3f46; }
.nightMode table.med-table th, .night_mode table.med-table th { background-color: #0c4a6e !important; color: #e0f2fe !important; border-color: #3f3f46 !important; }
.nightMode table.med-table td, .night_mode table.med-table td { border-color: #3f3f46 !important; color: #f4f4f5 !important; }
@media (max-width: 600px) {
  .card { padding: 14px; font-size: 16.5px; }
  .med-card { max-width: 100%; }
  .front-content { font-size: 17.5px; }
  .back-content { font-size: 16.5px; }
  .main-answer { font-size: 18px; }
  .extra-box { padding: 10px 14px; font-size: 15px; }
  img { max-height: 55vh; margin-top: 10px; }
}`;

const BASE91_TABLE =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';

function genankiGuidFor(deckId: number, deckKey: string, noteId: number): string {
  const key = `${deckKey}:id:${noteId}`;
  const hashStr = `${GUID_SALT}__${deckId}__${key}`;
  const digest = crypto.createHash('sha256').update(hashStr, 'utf8').digest();
  let hashInt = 0n;
  for (let i = 0; i < 8; i++) {
    hashInt = (hashInt << 8n) | BigInt(digest[i]);
  }
  const base = BigInt(BASE91_TABLE.length);
  let rv = '';
  while (hashInt > 0n) {
    rv = BASE91_TABLE[Number(hashInt % base)] + rv;
    hashInt = hashInt / base;
  }
  return rv || `id${noteId}`;
}

function ankiFieldChecksum(sfld: string): number {
  const hex = crypto.createHash('sha1').update(sfld || '', 'utf8').digest('hex').slice(0, 8);
  return parseInt(hex, 16) >>> 0;
}

function computeDeckIdFromKey(deckKey: string): number {
  const digest = crypto.createHash('sha256').update(deckKey || 'deck', 'utf8').digest();
  const val = digest.readUInt32BE(0);
  return 1730000000000 + (val % 900000000);
}

let sqlJsPromise: ReturnType<typeof initSqlJs> | null = null;
function getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs();
  }
  return sqlJsPromise;
}

async function buildAnkiApkgBuffer(params: {
  deckKey: string;
  deckName: string;
  deckId?: number;
  notes: Array<{
    id: number;
    type: 'basic' | 'cloze';
    topic: string;
    question: string;
    answer: string;
    hint: string;
    tags?: string[];
  }>;
  resolvedMedia: Array<{ filename: string; data: Buffer }>;
  guidRegistry?: Record<string, string>;
}): Promise<{ apkgBuffer: Buffer; updatedRegistry: Record<string, string> }> {
  const SQL = await getSqlJs();
  const db = new SQL.Database();

  const nowSec = Math.floor(Date.now() / 1000);
  const cleanDeckKey =
    (params.deckKey || 'internato_deck').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_') ||
    'internato_deck';
  const deckId =
    typeof params.deckId === 'number' && params.deckId > 1
      ? params.deckId
      : computeDeckIdFromKey(cleanDeckKey);
  const deckName = (params.deckName || cleanDeckKey.replace(/_/g, ' ')).trim();
  const updatedRegistry: Record<string, string> = { ...(params.guidRegistry || {}) };

  db.run(`
    CREATE TABLE col (
      id integer primary key,
      crt integer not null,
      mod integer not null,
      scm integer not null,
      ver integer not null,
      dty integer not null,
      usn integer not null,
      ls integer not null,
      conf text not null,
      models text not null,
      decks text not null,
      dconf text not null,
      tags text not null
    );
    CREATE TABLE notes (
      id integer primary key,
      guid text not null,
      mid integer not null,
      mod integer not null,
      usn integer not null,
      tags text not null,
      flds text not null,
      sfld integer not null,
      csum integer not null,
      flags integer not null,
      data text not null
    );
    CREATE TABLE cards (
      id integer primary key,
      nid integer not null,
      did integer not null,
      ord integer not null,
      mod integer not null,
      usn integer not null,
      type integer not null,
      queue integer not null,
      due integer not null,
      ivl integer not null,
      factor integer not null,
      reps integer not null,
      lapses integer not null,
      left integer not null,
      odue integer not null,
      odid integer not null,
      flags integer not null,
      data text not null
    );
    CREATE TABLE revlog (
      id integer primary key,
      cid integer not null,
      usn integer not null,
      ease integer not null,
      ivl integer not null,
      lastIvl integer not null,
      factor integer not null,
      time integer not null,
      type integer not null
    );
    CREATE TABLE graves (
      usn integer not null,
      oid integer not null,
      type integer not null
    );
    CREATE INDEX ix_notes_usn on notes (usn);
    CREATE INDEX ix_cards_nid on cards (nid);
    CREATE INDEX ix_cards_sched on cards (did, queue, due);
    CREATE INDEX ix_cards_usn on cards (usn);
    CREATE INDEX ix_revlog_usn on revlog (usn);
    CREATE INDEX ix_revlog_cid on revlog (cid);
  `);

  const fieldDefs = ['Question', 'Topic', 'Answer', 'Hint'].map((name, ord) => ({
    name,
    ord,
    sticky: false,
    rtl: false,
    font: 'Arial',
    size: 20,
    media: [],
  }));

  const modelsObj = {
    [String(CLOZE_MODEL_ID)]: {
      id: CLOZE_MODEL_ID,
      name: CLOZE_MODEL_NAME,
      type: 1, // Cloze
      mod: nowSec,
      usn: -1,
      sortf: 0,
      did: deckId,
      tmpls: [
        {
          name: 'Cloze',
          ord: 0,
          qfmt: '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="cloze-text">{{cloze:Question}}</div></div>',
          afmt: '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="cloze-text">{{cloze:Question}}</div>{{#Hint}}<hr id="answer" class="med-divider"><div class="extra-box">{{Hint}}</div>{{/Hint}}</div><script>(document.querySelector(".cloze") || document.getElementById("answer"))?.scrollIntoView({behavior: "smooth", block: "center"});</script>',
          bqfmt: '',
          bafmt: '',
          did: null,
          bfont: '',
          bsize: 0,
        },
      ],
      flds: fieldDefs,
      css: ANKI_CLINICAL_CSS,
      latexPre: '',
      latexPost: '',
      latexsvg: false,
      req: [[0, 'all', [0]]],
      tags: [],
      vers: [],
    },
    [String(BASIC_MODEL_ID)]: {
      id: BASIC_MODEL_ID,
      name: BASIC_MODEL_NAME,
      type: 0, // Standard Basic
      mod: nowSec,
      usn: -1,
      sortf: 0,
      did: deckId,
      tmpls: [
        {
          name: 'Basic',
          ord: 0,
          qfmt: '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="front-content">{{Question}}</div></div>',
          afmt: '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="front-content">{{Question}}</div><hr id="answer" class="med-divider"><div class="back-content"><div class="main-answer"><b>{{Answer}}</b></div>{{#Hint}}<div class="extra-box">{{Hint}}</div>{{/Hint}}</div></div><script>document.getElementById("answer")?.scrollIntoView({behavior: "smooth", block: "nearest"});</script>',
          bqfmt: '',
          bafmt: '',
          did: null,
          bfont: '',
          bsize: 0,
        },
      ],
      flds: fieldDefs,
      css: ANKI_CLINICAL_CSS,
      latexPre: '',
      latexPost: '',
      latexsvg: false,
      req: [[0, 'all', [0]]],
      tags: [],
      vers: [],
    },
  };

  const decksObj = {
    '1': {
      id: 1,
      mod: nowSec,
      name: 'Default',
      usn: -1,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: false,
      browserCollapsed: false,
      desc: '',
      dyn: 0,
      conf: 1,
      extendNew: 10,
      extendRev: 50,
    },
    [String(deckId)]: {
      id: deckId,
      mod: nowSec,
      name: deckName,
      usn: -1,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: false,
      browserCollapsed: false,
      desc: `Baralho Canônico Internato-First (${cleanDeckKey})`,
      dyn: 0,
      conf: 1,
      extendNew: 10,
      extendRev: 50,
    },
  };

  const confObj = {
    nextPos: 1,
    estTimes: true,
    activeDecks: [deckId],
    sortType: 'noteFld',
    timeLim: 0,
    sortBackwards: false,
    addToCur: true,
    curDeck: deckId,
    newBury: true,
    newSpread: 0,
    dueCounts: true,
    curModel: String(BASIC_MODEL_ID),
    collapseTime: 1200,
  };

  const dconfObj = {
    '1': {
      id: 1,
      mod: 0,
      name: 'Default',
      usn: 0,
      maxTaken: 60,
      autoplay: true,
      timer: 0,
      replayq: true,
      new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20 },
      rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 },
      lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
      dyn: false,
    },
  };

  db.run(
    `INSERT INTO col VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      1,
      nowSec,
      nowSec * 1000,
      nowSec * 1000,
      11,
      0,
      0,
      0,
      JSON.stringify(confObj),
      JSON.stringify(modelsObj),
      JSON.stringify(decksObj),
      JSON.stringify(dconfObj),
      '{}',
    ]
  );

  const insertNoteStmt = db.prepare(
    `INSERT OR REPLACE INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertCardStmt = db.prepare(
    `INSERT OR REPLACE INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const usedCardIds = new Set<number>();

  params.notes.forEach((note, index) => {
    const nid = Number(note.id) > 0 ? Number(note.id) : 171000101 + index;
    const regKey = `${cleanDeckKey}:id:${nid}`;
    const guid = updatedRegistry[regKey] || genankiGuidFor(deckId, cleanDeckKey, nid);
    updatedRegistry[regKey] = guid;

    const isCloze = note.type === 'cloze';
    const mid = isCloze ? CLOZE_MODEL_ID : BASIC_MODEL_ID;
    const qField = String(note.question || '');
    const tField = String(note.topic || '');
    const aField = isCloze ? '' : String(note.answer || '');
    const hField = String(note.hint || '');

    const flds = [qField, tField, aField, hField].join('\x1f');
    const sfld = qField.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const csum = ankiFieldChecksum(sfld);

    const noteTags = Array.from(
      new Set([
        cleanDeckKey,
        ...(Array.isArray(note.tags)
          ? note.tags.map((t) => String(t).trim()).filter((t) => t && !/\s/.test(t))
          : []),
      ])
    );
    const tagsStr = ` ${noteTags.join(' ')} `;

    insertNoteStmt.run([
      nid,
      guid,
      mid,
      nowSec,
      -1,
      tagsStr,
      flds,
      sfld,
      csum,
      0,
      '',
    ]);

    let cid = nid < 100000000000 ? nid * 10 + 1 : nid + index + 1;
    while (usedCardIds.has(cid)) {
      cid++;
    }
    usedCardIds.add(cid);

    insertCardStmt.run([
      cid,
      nid,
      deckId,
      0,
      nowSec,
      -1,
      0,
      0,
      index + 1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      '',
    ]);
  });

  insertNoteStmt.free();
  insertCardStmt.free();

  const sqliteBytes = Buffer.from(db.export());
  db.close();

  const zipEntries: Array<{ name: string; data: Buffer }> = [
    { name: 'collection.anki21', data: sqliteBytes },
    { name: 'collection.anki2', data: sqliteBytes },
  ];

  const mediaJsonMap: Record<string, string> = {};
  params.resolvedMedia.forEach((mediaItem, idx) => {
    const numKey = String(idx);
    mediaJsonMap[numKey] = mediaItem.filename;
    zipEntries.push({
      name: numKey,
      data: mediaItem.data,
    });
  });

  zipEntries.push({
    name: 'media',
    data: Buffer.from(JSON.stringify(mediaJsonMap), 'utf8'),
  });

  return {
    apkgBuffer: buildZipArchive(zipEntries),
    updatedRegistry,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Endpoint 0A: Buscar Imagens Médicas Fidedignas na Internet (Google Search Grounding + Wikipedia Medical + Wikimedia Commons)
  app.post('/api/media/search-medical-images', async (req, res) => {
    try {
      const {
        query = '',
        topic = '',
        question = '',
        hint = '',
        preferGoogleGrounding = true,
      } = req.body || {};
      const rawSearch = (query || topic || question || 'clinical diagnosis').trim();
      const ai = getAiClient();

      const enQueries = await expandMedicalQueriesWithGemini(ai, rawSearch, topic, question, hint);

      const [googleSettled, wikipediaSettled, wikimediaSettled] = await Promise.allSettled([
        preferGoogleGrounding
          ? searchGoogleMedicalImagesViaGrounding(ai, rawSearch, topic, question, enQueries)
          : Promise.resolve([]),
        searchWikipediaMedicalImages(enQueries, rawSearch),
        searchWikimediaCommonsMedical(enQueries),
      ]);

      const googleImages = googleSettled.status === 'fulfilled' ? googleSettled.value : [];
      // Wikipedia and Wikimedia Commons imageinfo APIs already verified MIME type (image/*) and dimensions (>= 220x140);
      // skipping redundant bulk thumbnail downloads avoids Wikimedia 429 rate-limits.
      const wpImages = wikipediaSettled.status === 'fulfilled' ? wikipediaSettled.value.slice(0, 8) : [];
      const wmImages = wikimediaSettled.status === 'fulfilled' ? wikimediaSettled.value.slice(0, 8) : [];

      // Interleave Google Grounding, Wikipedia Medical, and Wikimedia Commons without duplicates
      const interleaved: MedicalImageCandidate[] = [];
      const seenUrls = new Set<string>();
      const maxLen = Math.max(googleImages.length, wpImages.length, wmImages.length);
      for (let i = 0; i < maxLen; i++) {
        for (const candidate of [googleImages[i], wpImages[i], wmImages[i]]) {
          if (!candidate) continue;
          const normalizedKey = candidate.thumbUrl.replace(/^http:\/\//i, 'https://').split('?')[0];
          if (!seenUrls.has(normalizedKey)) {
            seenUrls.add(normalizedKey);
            interleaved.push(candidate);
          }
        }
      }

      // Prefer real raster images (.jpg/.png/.webp) before any .svg schematic
      const rasterFirst = [
        ...interleaved.filter((img) => !img.isSvg),
        ...interleaved.filter((img) => img.isSvg),
      ].map(({ isSvg: _omit, ...rest }) => rest);

      return res.json({
        query: rawSearch,
        translatedQueries: enQueries,
        images: rasterFirst.slice(0, 12),
      });
    } catch {
      return res.json({
        query: 'atlas_clinico',
        translatedQueries: [],
        images: [],
      });
    }
  });

  // Endpoint 0B: Proxy de imagem externa para permitir Tarja Anti-Spoiler via <canvas> sem erro de CORS
  app.get('/api/media/proxy-image', async (req, res) => {
    try {
      const targetUrl = String(req.query.url || '').trim();
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        return res.status(400).send('Invalid image URL');
      }
      const upstream = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'InternatoFirstCardArchitect/2.0 (https://aistudio.google.com; medical-education)',
        },
        signal: AbortSignal.timeout(4000),
      });
      if (!upstream.ok) {
        return res.status(upstream.status).send('Failed to fetch upstream image');
      }
      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', contentType);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(buffer);
    } catch {
      return res.status(502).send('Error proxying image');
    }
  });

  // Endpoint 0C: Exportar Pacote Anki Offline (.zip com *_notes.json + collection.media + 04_Mídias/<deck_key> + Relatório)
  app.post('/api/media/export-bundle', async (req, res) => {
    try {
      const {
        deckKey = 'internato_deck',
        notesJson = '[]',
        mediaManifest = [],
        mediaAssets = {},
        guidRegistry = {},
      } = req.body || {};

      const cleanDeckKey = String(deckKey || 'internato_deck')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_');

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

  // Endpoint 0D: Exportar diretamente para .apkg (SQLite collection.anki21 + mídias numeradas + preservação FSRS)
  app.post('/api/export/apkg', async (req, res) => {
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

      const cleanDeckKey = String(deckKey || 'internato_deck')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_');

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

  // Endpoint 0E: Pré-upload individual de PDF para a Gemini Files API (evita reenviar MBs de base64 em cada chamada)
  app.post('/api/gemini/upload-file', async (req, res) => {
    try {
      const { name = 'documento.pdf', mimeType = 'application/pdf', base64Data = '' } = req.body || {};
      if (!base64Data || typeof base64Data !== 'string') {
        return res.status(400).json({ error: 'Arquivo base64Data ausente.' });
      }
      const ai = getAiClient();
      if (!ai) {
        return res.status(200).json({
          fallback: true,
          error:
            'Chave GEMINI_API_KEY não configurada no ambiente. Configure sua chave no painel Settings > Secrets.',
        });
      }
      const uploaded = await uploadSinglePdfToGeminiFiles(ai, {
        name,
        mimeType,
        base64Data,
      });
      return res.json({
        fileUri: uploaded.uri,
        fileName: uploaded.name,
        mimeType: uploaded.mimeType,
      });
    } catch (error: unknown) {
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, 'Erro ao enviar PDF para a Gemini Files API.'),
      });
    }
  });

  const resolveEffectiveDomainProfile = (
    requestedProfile: unknown,
    deckKey: string,
    textHint = ''
  ): DomainProfile => {
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
  };

  // Endpoint 1: Passo 1 — Gerar Mapa Clínico (P1 a P4) + Atualizações de Diretrizes
  app.post('/api/gemini/clinical-map', async (req, res) => {
    try {
      const {
        deckKey = 'tema_clinico_internato',
        profile = 'auto',
        pdfs = [],
        existingJsonSummary = '',
        useGoogleSearch = true,
      } = req.body || {};

      const ai = getAiClient();
      if (!ai) {
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
      const parts: Part[] = await resolveDocumentPartsForGemini(ai, pdfs);

      const prompt = `Analise os documentos PDF anexados (se houver) e o tema médico indicado pela Deck Key "${deckKey}".
${existingJsonSummary ? `Resumo do deck atual enviado pelo usuário:\n${existingJsonSummary}\n` : ''}
${
  useGoogleSearch
    ? 'Utilize o Google Search para verificar diretrizes atualizadas do Ministério da Saúde (MS), Sociedades Médicas Brasileiras (FEBRASGO, SBC, SBP, SBGG, CBC, CFM, etc.), consensos internacionais recentes e referências de exames/normas aplicáveis a este tema.'
    : ''
}

${profilePromptBlock}

Gere um Mapa Clínico estruturado segundo a Doutrina Internato-First (P1 a P4) ADAPTADA ESTRITAMENTE AO PERFIL DE DOMÍNIO "${effectiveProfile}" acima para guiar a criação/recriação do deck.
- Não force cenário de "Sala Vermelha" nem viés obstétrico/de emergência se o tema pertencer a outro perfil!
- Inclua em P2 conceitos de Reconhecimento Visual de exames/imagens reais da internet APENAS quando exames complementares visuais fizerem sentido para o tema (ex.: ECG, RX, TC, USG, CTG, dermoscopia, fundoscopia, lâminas). Para temas normativos/ética/legais sem exame de imagem típico, foque P2 em documentação, prazos e interpretação de medidas/indicadores.
- Aplique o Filtro Negativo: exclua genética de bancada, história da medicina e epidemiologia percentual que não mude conduta.

Retorne EXCLUSIVAMENTE um objeto JSON válido (sem comentários fora do JSON) no seguinte formato exato:
{
  "themeTitle": "Nome Completo do Tema Médico",
  "specialty": "Especialidade (Clínica / Cirurgia / GO / Pediatria / Preventiva / Ética)",
  "deckKey": "${deckKey}",
  "profile": "${effectiveProfile}",
  "guidelineUpdates": [
    "Resumo objetivo de atualização de diretriz MS / Sociedade Brasileira / Norma CFM / Consenso com pontos de corte e condutas"
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
Gere entre 8 e 14 itens distribuídos em P1, P2, P3 e P4 de acordo com o perfil "${effectiveProfile}", escolhendo fluidamente targetCardType ("basic" para decisão clínica/diferencial/mecanismo/imagem e "cloze" para critérios numéricos/limiares/doses em âncora), sem cota percentual rígida.`;

      parts.push({ text: prompt });

      let result: {
        text: string;
        finishReason?: string;
        groundingSources: Array<{ title: string; uri: string }>;
      };

      try {
        result = await generateContentWithRetry(ai, {
          model: 'gemini-4-hydrogen',
          contents: { parts },
          config: {
            systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
            maxOutputTokens: 32768,
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.HIGH,
            },
            ...(useGoogleSearch
              ? { tools: [{ googleSearch: {} }] }
              : { responseMimeType: 'application/json' }),
          },
        });
      } catch (primaryErr) {
        if (useGoogleSearch && isRetryableGeminiError(primaryErr)) {
          console.warn(
            '[clinical-map] Retrying without googleSearch + ThinkingLevel.MEDIUM after primary failure:',
            extractErrorDetails(primaryErr)
          );
          result = await generateContentWithRetry(ai, {
            model: 'gemini-4-hydrogen',
            contents: { parts },
            config: {
              systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
              maxOutputTokens: 32768,
              responseMimeType: 'application/json',
              thinkingConfig: {
                thinkingLevel: ThinkingLevel.MEDIUM,
              },
            },
          });
        } else {
          throw primaryErr;
        }
      }

      const rawText = result.text || '{}';
      const cleanedJson = extractJsonBlock(rawText);
      const parsed = JSON.parse(cleanedJson);

      return res.json({
        ...parsed,
        deckKey: parsed.deckKey || deckKey,
        profile: resolveEffectiveDomainProfile(parsed.profile || profile, deckKey, existingJsonSummary),
        groundingSources:
          result.groundingSources.length > 0
            ? result.groundingSources
            : parsed.groundingSources || [],
      });
    } catch (error: unknown) {
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, 'Erro ao gerar o Mapa Clínico com Gemini.'),
      });
    }
  });

  // Endpoint 2: Passo 2 — Recriar Deck JSON Canônico em Lotes (Preservando IDs FSRS e Reconstruindo do Zero)
  app.post('/api/gemini/generate-deck', async (req, res) => {
    try {
      const {
        deckKey = 'tema_clinico_internato',
        pdfs = [],
        clinicalMap = null,
        existingMetadata = null,
        batchCards = null,
        batchIndex = 0,
        totalBatches = 1,
        nextNewIdStart = null,
        deckOutline = null,
      } = req.body || {};

      const ai = getAiClient();
      if (!ai) {
        return res.status(200).json({
          fallback: true,
          error:
            'Chave GEMINI_API_KEY não configurada no ambiente. Configure sua chave no painel Settings > Secrets.',
        });
      }

      const parts: Part[] = await resolveDocumentPartsForGemini(ai, pdfs);

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

      const runDeckBatch = async (
        subsetCards: Array<Record<string, unknown>>,
        subsetNewIdStart: number,
        depth = 0
      ): Promise<Array<Record<string, unknown>>> => {
        const rawCardsSummary = buildFullCardsDigest(subsetCards);
        const batchInstruction = isBatchMode
          ? `MODO DE RECONSTRUÇÃO PROFUNDA EM LOTE (${batchIndex + 1}/${totalBatches} — ${subsetCards.length} cards neste lote):
- PROIBIDO PARÁFRASE COSMÉTICA DE CLOZES FRACOS: Reconstrua cada conceito válido **DO ZERO** segundo Andy Matuschak & Michael Nielsen (esforço real de recuperação, anti-pattern-matching, raciocínio causal "por que / como", precisão clínica).
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
- Reconstrua o baralho com rigor Matuschak & Nielsen preservando os IDs FSRS dos conceitos clínicos distintos, podando duplicatas reais e criando novos IDs a partir de ${subsetNewIdStart} para cobrir integralmente o Mapa Clínico P1–P4.`;

        const prompt = `Reconstrua profundamente e lapide o baralho canônico para o tema "${deckKey}".

${profilePromptBlock}

${batchInstruction}

DADOS DO BARALHO ANTIGO (COMPLETO COM PERGUNTA, RESPOSTA E COMENTÁRIO ORIGINAL):
- Total de cards no baralho original: ${existingIds.length}
- Primeiro novo ID exclusivo reservado para este lote (se precisar desmembrar algum card deste lote): ${subsetNewIdStart}
- Tags de Mídia Originais: ${JSON.stringify(mediaTags)}
${outlineText ? `- ÍNDICE GLOBAL DE TODOS OS LOTES (use para não duplicar outros lotes nem transformar um card deste lote no tema de outro lote):\n${outlineText}\n` : ''}- Cards Originais DESTE LOTE para Reconstrução Profunda:
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
4. Zero Mídias Órfãs, Posicionamento Correto e Coerência Factual: NUNCA invente nomes de arquivos locais inexistentes em <img src="..."> ou <audio>. Se o card original tiver <img src="..."> no "hint" (especialmente tabelas, algoritmos ou esquemas de resposta), MANTENHA a tag <img src="..."> e sua <i>Legenda</i> no INÍCIO do "hint" ("<img ...><br><i>Legenda</i><br><br><b>Comentário:</b> ..."), NUNCA movendo tabelas/esquemas para "question" nem colocando "<b>Comentário:</b>" antes da imagem. Garanta 100% de coerência numérica entre pergunta e hint (ex.: se o enunciado diz "3 semanas", o hint deve dizer "3 semanas / 21 dias", nunca "20 dias").
5. Duplo Salto Cognitivo Implícito: NUNCA faça pergunta composta ("Qual o diagnóstico e a conduta?"). Apresente o caso clínico e pergunte apenas 1 decisão atômica.
6. "topic": formato "Tema - Subtema", ZERO spoiler por palavra ou radical INCLUSIVE no prefixo antes do " - " (se a resposta contiver "alimento", "rinite" ou "imunoglobulinas", generalize o prefixo para "Alergia Pediátrica", "Vias Aéreas Superiores" ou "Imunidade Humoral") e NUNCA repita o topic em negrito dentro do question.
7. "question": ZERO spoiler entre parênteses e ZERO LaTeX ($...$, \\rightarrow).
8. "hint": deve ter "<b>Comentário:</b> " logo antes da explicação textual (se houver <img ...><br><i>Legenda</i>, coloque no início ANTES de "<b>Comentário:</b> "), com 1 a 2 frases (180 a 300 caracteres visíveis no comentário textual, NUNCA passar de 310), termos-chave em <b>negrito</b> e contraste diferencial/causal obrigatório.
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

        const response = await generateContentWithRetry(ai, {
          model: 'gemini-4-hydrogen',
          contents: { parts: [...parts, { text: prompt }] },
          config: {
            systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            maxOutputTokens: 65536,
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.HIGH,
            },
          },
        });

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

        if ((finishReason === 'MAX_TOKENS' || wasTruncated || isAnomalousLoss) && subsetCards.length >= 4 && depth < 2) {
          console.warn(
            `[generate-deck] Sub-lote dividido (recebido ${parsedNotes.length}/${subsetCards.length}, finish=${String(finishReason)}, truncated=${wasTruncated}, depth=${depth})`
          );
          const mid = Math.ceil(subsetCards.length / 2);
          const [leftNotes, rightNotes] = await Promise.all([
            runDeckBatch(subsetCards.slice(0, mid), subsetNewIdStart, depth + 1),
            runDeckBatch(subsetCards.slice(mid), subsetNewIdStart + 50, depth + 1),
          ]);
          return [...leftNotes, ...rightNotes];
        }

        return parsedNotes;
      };

      const notes = await runDeckBatch(cardsForPrompt, effectiveNewIdStart);

      return res.json({
        deck_key: deckKey,
        notes,
        batchIndex,
        totalBatches,
      });
    } catch (error: unknown) {
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, 'Erro ao gerar o Deck JSON Canônico com Gemini.'),
      });
    }
  });

  // Endpoint 2B: Auditoria Pós-Lotes — Preencher Lacunas Reais do Mapa Clínico P1-P4 Descobertas
  app.post('/api/gemini/fill-map-gaps', async (req, res) => {
    try {
      const {
        deckKey = 'tema_clinico_internato',
        clinicalMap = null,
        rebuiltCards = [],
        nextNewIdStart = 171000200,
      } = req.body || {};

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

      const ai = getAiClient();
      if (!ai) {
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

      const prompt = `Audite a cobertura clínica do baralho reconstruído "${deckKey}" comparando-o com o Mapa Clínico P1–P4 aprovado para o perfil "${effectiveProfile}".

${profilePromptBlock}

MAPA CLÍNICO APROVADO:
${JSON.stringify(checkedMapItems, null, 2)}

CARDS JÁ GERADOS NOS LOTES:
${existingDigest || 'Nenhum card gerado.'}

TAREFA CIRÚRGICA:
- Identifique APENAS os conceitos essenciais do Mapa Clínico que ficaram SEM UM CARD PRÓPRIO DEDICADO (atenção: uma menção passageira dentro do comentário/"hint" ou lista lateral de outro card NÃO conta como card dedicado!). Exemplos típicos de lacunas reais: exame inicial obrigatório (como β-hCG na suspeita de DIP), critério de transição IV→VO ou diferencial P1 ausente.
- Para cada lacuna real encontrada, crie 1 card atômico seguindo rigorosamente Andy Matuschak & Michael Nielsen, atribuindo IDs sequenciais a partir de ${nextNewIdStart}:
  * "topic": formato "Tema - Subtema" sem spoiler por palavra ou radical INCLUSIVE no prefixo antes de " - " (ex.: se a resposta citar "imunoglobulinas", use "Imunidade Humoral - Investigação Inicial", nunca "Imunodeficiência humoral").
  * Para lacunas marcadas no mapa com "image_mode": "recognition" quando não existir arquivo de imagem no acervo original, formule pergunta clínica objetiva pelo achado esperado sem simular ou inventar <img>.
  * Se "basic": "question" ≤ 45–50 palavras (vinheta ou pergunta causal), "answer" com 1 a 12 palavras terminado em ponto final (.), sem ";".
  * Se "cloze": exatamente 1 lacuna {{c1::...}} (1 a 5 palavras) e "answer": "".
  * "hint": comece com "<b>Comentário:</b> ", tenha entre **180 e 300 caracteres visíveis** (medidos APÓS "<b>Comentário:</b> ", teto de 320), destaque termos-chave em <b>negrito</b> e traga contraste diferencial real pertinente ao tema (ex.: gravidez/ectópica vs. quadro não gestacional — nunca use texto genérico sobre "2ª linha").
- Se TODOS os conceitos do Mapa Clínico já possuírem card próprio dedicado acima, retorne "notes": [].
- NUNCA duplique conceitos já cobertos nos cards existentes acima.
- NÃO inclua o campo "sources".

Retorne EXCLUSIVAMENTE um JSON válido:
{
  "deck_key": "${deckKey}",
  "notes": []
}`;

      const response = await generateContentWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: [{ text: prompt }],
        config: {
          systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          maxOutputTokens: 65536,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH,
          },
        },
      });

      const { notes, wasTruncated } = parseOrRecoverNotesJsonWithMeta(response.text || '{}');
      if (wasTruncated) {
        console.warn('[fill-map-gaps] Resposta truncada recuperada parcialmente:', notes.length);
      }
      return res.json({ deck_key: deckKey, notes });
    } catch (error: unknown) {
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, 'Erro ao auditar lacunas do Mapa Clínico.'),
      });
    }
  });

  // Endpoint 3: ⚡ Auto-Reparar Avisos com IA (Reescrita Cirúrgica apenas dos cards sinalizados)
  app.post('/api/gemini/repair-cards', async (req, res) => {
    try {
      const { flaggedCards = [], deckKey = 'internato_deck' } = req.body || {};

      const ai = getAiClient();
      if (!ai) {
        return res.status(200).json({
          fallback: true,
          error:
            'Chave GEMINI_API_KEY não configurada no ambiente. Configure sua chave no painel Settings > Secrets.',
        });
      }

      const prompt = `Reescreva cirurgicamente APENAS os cards abaixo que foram reprovados pelo Linter Matuschak & Nielsen (andymatuschak.org/prompts/ e augmentingcognition.com/ltm.html).
Mantenha rigorosamente o mesmo "id" numérico e qualquer tag de mídia válida de cada card. NÃO inclua o campo "sources".

REGRAS DE CORREÇÃO CIRÚRGICA (MATUSCHAK & NIELSEN):
- **Focused & Tractable:** Se a pergunta pede lista aberta ("Quais as causas/critérios...?", "Cite...") ou a resposta tem múltiplos itens/ponto-e-vírgula, isole 1 único atributo/decisão determinante.
- **Salience & Anti-Passivo (Nielsen):** Se a pergunta é uma definição inerte ("O que é X?") ou binária ("Sim/Não"), transforme em um prompt de saliência ancorado em cenário clínico ou mecanismo causal.
- **Precise & Consistent:** Se "type": "basic" -> "question" com <= 50 palavras e pergunta precisa (cenário clínico com decisão inequívoca ou prompt causal/diferencial de Nielsen & Matuschak); "answer" DEVE ter entre 1 e 12 palavras (máx 15 palavras / 110 chars), terminar com ".", NÃO conter ";" e NÃO ter <b> envolvendo tudo. Use "basic" ou "cloze" livremente conforme o que melhor encaixar para o card.
- **Cloze Atômico:** Se "type": "cloze" -> "question" DEVE ter estritamente 1 lacuna {{c1::...}} com 1 a 5 palavras, unidades fora da lacuna, sem preposição pendurada no final, SEM "::dica", e "answer" DEVE ser "".
- **Effortful (Zero Spoiler):** Se spoiler por radical ou palavra no "topic" ou entre parênteses na "question" -> remova imediatamente a palavra/radical da resposta (ex.: "Manobras" quando a resposta é "Manobra de...") mantendo formato "Tema - Subtema".
- Substitua qualquer LaTeX ($...$, \\rightarrow) por Unicode puro (→, ≥, ≤).
- "hint": DEVE conter "<b>Comentário:</b> ", ter entre 180 e 295 caracteres visíveis APÓS o prefixo "<b>Comentário:</b> " (PROIBIDO passar de 320 caracteres visíveis), com termos-chave em <b>negrito</b> e contraste diferencial/causal.

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

      const response = await generateContentWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          maxOutputTokens: 65536,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH,
          },
        },
      });

      const rawText = response.text || '{}';
      const cleanedJson = extractJsonBlock(rawText);
      const parsed = JSON.parse(cleanedJson);
      const repairedCards = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.repairedCards)
        ? parsed.repairedCards
        : [];

      return res.json({ repairedCards, deckKey });
    } catch (error: unknown) {
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, 'Erro ao auto-reparar cards com Gemini.'),
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Internato-First Card Architect server running at http://localhost:${PORT}`);
  });
  server.requestTimeout = 10 * 60 * 1000;
  server.headersTimeout = 120 * 1000;
  server.keepAliveTimeout = 65 * 1000;
}

startServer();
