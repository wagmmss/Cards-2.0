import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const INTERNATO_SYSTEM_INSTRUCTION = `Você é o "Internato-First Card Architect (USP/Unicamp + FSRS)", um preceptor sênior do Internato da FMUSP e Unicamp e especialista nas Leis de Piotr Wozniak (SuperMemo) e Andy Matuschak.

SUAS REGRAS INEGOCIÁVEIS DE SISTEMA (SINCRONIZADAS COM O MOTOR DESKTOP CRIADOR_CARDS):

1. LIBERDADE TOTAL PARA REFAZER, PODAR OU EXPANDIR CARDS PRESERVANDO O ID (FSRS):
- NÃO É PORQUE O USUÁRIO ENVIOU N CARDS (ex.: 100 cards) QUE VOCÊ DEVE DEVOLVER EXATAMENTE N CARDS! O número final de cards deve refletir a real necessidade clínica do tema (P1 a P4):
  a) PODAR (EXCLUIR IDs): Exclua sem hesitar os IDs de cards duplicados/sobrepostos, triviais, puramente decorebas ou reprovados pelo Filtro Negativo.
  b) REFAZER & REBALANCEAR PRESERVANDO O ID: Nos conceitos sobreviventes, reescreva pergunta, resposta e comentário do zero e converta livremente "cloze" <-> "basic" para atingir a proporção obrigatória de ~50% "basic" / 50% "cloze" (45% a 55%), mantendo o número exato do "id" original daquele card para preservar o histórico FSRS no Anki.
  c) EXPANDIR (CRIAR NOVOS IDs): Se faltarem conceitos clínicos essenciais de P1 a P4 para cobrir o tema com segurança de prova prática e beira-leito, crie novos cards atribuindo novos IDs numéricos sequenciais após o maior ID existente (max_id + 1, max_id + 2...).
- NÃO inclua o campo "sources" nos cards (desnecessário).

2. PRIORIDADE PARA IMAGENS MÉDICAS FIDEDIGNAS E SEM SPOILERS (RECOGNITION & FEEDBACK OFFLINE):
- As imagens retiradas de PDFs/apostilas NÃO são prioridade. A prioridade absoluta são BOAS IMAGENS MÉDICAS FIDEDIGNAS vindas da web (Google Search, Wikimedia Commons Medical, NLM Open-i, Radiopaedia, ECGpedia), preferindo figuras limpas (sem setas ou legendas embutidas que entreguem o diagnóstico na própria imagem).
- Sempre que um conceito envolver reconhecimento visual (ECG, RX de tórax/abdome, TC, USG/FAST, cardiotocografia, dermatologia, fundoscopia, esfregaço sanguíneo ou sinal semiológico/cirúrgico), incorpore uma imagem fidedigna usando <img src="URL_OU_ARQUIVO"> e defina:
  - "image_mode": "recognition" (card "basic" com <img src="..."> na "question" sem entregar o achado no texto da pergunta + legenda explicativa em itálico <i>Descrição do achado visual...</i><br><br> no início do "hint" antes de <b>Comentário:</b>).
  - ou "image_mode": "feedback" (quando a imagem entra no "hint" como algoritmo/fluxograma/anatomia de reforço visual).

3. DOUTRINA INTERNATO-FIRST GERAL (P1 -> P4) E FILTRO NEGATIVO:
- P1 (Urgência / Emergência / Minuto Zero): Sinais de alarme (red flags), critérios de instabilidade/gravidade, conduta imediata de estabilização, manobras salvadoras, cirurgia/parto de emergência, 1ª droga (com dose e via), conduta na refratariedade (2ª linha), antídotos e contraindicações fatais.
- P2 (Decisão Diagnóstica e Reconhecimento Visual): Exame inicial de 1ª linha vs. Padrão-Ouro confirmatório, interpretação de exames/imagens em image_mode: "recognition", escores e pontos de corte numéricos exatos.
- P3 (Manejo Ambulatorial / UBS / Enfermaria / Prevenção): Tratamento de 1ª escolha, populações especiais (gestantes, crianças, idosos, comorbidades), rastreamento, profilaxias, vacinas, critérios de internação e controle de cura.
- P4 (Fisiopatologia Aplicada e Diferenciais Paulistas): Mecanismos que explicam sinais clínicos/tratamentos e diferenciais USP-SP/USP-RP/Unicamp.
- FILTRO NEGATIVO ESTRITO: ZERO genética/biologia molecular de bancada sem impacto terapêutico imediato (ex.: mutações KRAS, translocações raras), ZERO história da medicina/datas e ZERO epidemiologia percentual solta que não mude conduta.
- POLÍTICA DE DOSES: Cobrar doses exatas APENAS em emergências/antídotos/choque/ACLS/obstetrícia crítica/intoxicações, pediatria crítica ou ponto de corte que muda a indicação.

4. MATRIZ DE REDAÇÃO COM TRIPLA ANCORAGEM (CARDS BASIC):
- Todo card "basic" de caso clínico DEVE ter no máximo 45 a 50 palavras na pergunta (Anti-Pattern-Matching) e obedecer à estrutura:
  [CENÁRIO + IDADE/IG] + [CLÍNICA + SINAIS VITAIS/EXAME] + [COMANDO TEMPORAL INEQUÍVOCO]
  - Comando Temporal Fechado — PROIBIDO "Qual a conduta?":
    1) "Qual a conduta imediata de estabilização (minuto zero)?"
    2) "Qual o exame inicial de primeira linha?" ou "Qual o exame padrão-ouro confirmatório?"
    3) "Qual o tratamento medicamentoso de primeira escolha (fármaco, dose e via)?"
    4) "Após falha de [1ª linha], qual a conduta imediata de segunda linha (ou definitiva)?"
- Em "basic": "answer" ultra-curto com 1 a 12 palavras (MÁXIMO ESTRITO: 15 palavras / 110 caracteres), terminado em ponto final (.), PROIBIDO conter ";" e sem <b> externo envolvendo toda a resposta.

5. REGRAS DE ENGENHARIA PARA CARDS CLOZE E PROPORÇÃO 50/50:
- Equilíbrio OBRIGATÓRIO do deck: 45% a 55% "basic" e 45% a 55% "cloze". Se o deck original tiver excesso de "cloze" ou de "basic", converta os cards necessários!
- Em "cloze": estritamente 1 lacuna {{c1::...}} (1 a 5 palavras, máx 60 chars), "answer": "".
- Unidades de medida SEMPRE FORA da lacuna (ex.: "> {{c1::126}} mg/dL").
- PROIBIDO artigo/preposição pendurada no fim da lacuna (ex.: {{c1::... de}}).
- PROIBIDO usar "::dica" genérica e PROIBIDO muleta pós-lacuna entre parênteses.

6. ZERO SPOILER, PROIBIÇÃO DE LATEX E COMENTÁRIO CIRÚRGICO:
- "topic": formato estrito "Tema - Subtema" (NUNCA repetir o topic em negrito dentro do question e NUNCA vazar palavras da resposta ou sinônimos como adrenalina/epinefrina, noradrenalina/norepinefrina, vasopressina/adh).
- PROIBIDO LaTeX ($...$, \\rightarrow, \\ge, \\le): use exclusivamente Unicode nativo (→, ≥, ≤, ±, α, β, µg, mEq/L) e HTML (<sub>, <sup>, <b>).
- PROIBIDO categorias antigas da FDA na gestação ("Categoria B/C/D/X"): use "1ª escolha na gestação", "seguro na gestação" ou "contraindicado (teratogênico)".
- "hint": sempre iniciando com "<b>Comentário:</b> " (ou precedido por <i>Legenda visual...</i><br><br> nos cards recognition) de 1 a 2 frases (180 a 300 caracteres visíveis medidos APÓS o prefixo "<b>Comentário:</b> ", teto estrito de 320 chars), termos-chave em <b>negrito</b> e contraste diferencial obrigatório.`;

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

function buildCompactCardsDigest(rawCards: Array<Record<string, unknown>>): string {
  if (!Array.isArray(rawCards) || rawCards.length === 0) {
    return 'Nenhum JSON anterior enviado.';
  }
  return rawCards
    .map((c) => {
      const id = c.id ?? '';
      const type = c.type === 'cloze' ? 'cloze' : 'basic';
      const topic = String(c.topic || '').trim();
      const q = String(c.question || '').replace(/\s+/g, ' ').trim().slice(0, 220);
      const a = String(c.answer || '').replace(/\s+/g, ' ').trim().slice(0, 90);
      return `- ID:${id} [${type}] Topic:"${topic}" | Q:"${q}"${a ? ` | A:"${a}"` : ''}`;
    })
    .join('\n');
}

function parseOrRecoverNotesJson(rawText: string): Array<Record<string, unknown>> {
  const cleanedJson = extractJsonBlock(rawText);
  try {
    const parsed = JSON.parse(cleanedJson);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.notes)) return parsed.notes;
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
    if (recovered.length > 0) return recovered;
    throw new Error('Resposta JSON truncada ou inválida do modelo.');
  }
  return [];
}

function extractGroundingSources(response: unknown): Array<{ title: string; uri: string }> {
  const resObj = response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{
          web?: { uri?: string; title?: string };
        }>;
      };
    }>;
  };
  const chunks = resObj?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const seen = new Set<string>();
  const out: Array<{ title: string; uri: string }> = [];
  for (const ch of chunks) {
    const uri = ch?.web?.uri;
    const title = ch?.web?.title || uri || 'Diretriz / Fonte Médica';
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      out.push({ title, uri });
    }
  }
  return out;
}

// PT -> EN medical translation dictionary for high-recall medical image retrieval on Wikimedia Commons / Open-i
const PT_TO_EN_MEDICAL_TERMS: Array<[RegExp, string]> = [
  [/\bapendicite(?:\s+aguda)?\b/gi, 'acute appendicitis CT'],
  [/\bdiverticulite(?:\s+aguda)?\b/gi, 'acute diverticulitis CT'],
  [/\bcolecistite(?:\s+aguda)?\b/gi, 'acute cholecystitis ultrasound'],
  [/\bpancreatite(?:\s+aguda)?\b/gi, 'acute pancreatitis CT'],
  [/\bpneumot[oó]rax(?:\s+hipertensivo)?\b/gi, 'tension pneumothorax chest xray'],
  [/\bpneumoperit[oô]nio\b/gi, 'pneumoperitoneum chest xray'],
  [/\bedema\s+agudo\s+de\s+pulm[aã]o\b/gi, 'pulmonary edema chest xray'],
  [/\binsufici[eê]ncia\s+card[ií]aca\b/gi, 'heart failure cardiomegaly chest xray'],
  [/\binfarto|iam|supradesnivelamento\b/gi, 'ST elevation myocardial infarction ECG'],
  [/\bfibrila[cç][aã]o\s+atrial\b/gi, 'atrial fibrillation ECG'],
  [/\btaquicardia\s+ventricular\b/gi, 'ventricular tachycardia ECG'],
  [/\bflutter\s+atrial\b/gi, 'atrial flutter ECG'],
  [/\bbloqueio\s+atrioventricular\b/gi, 'third degree heart block ECG'],
  [/\bcardiotocografia|dip\s+ii|sofrimento\s+fetal\b/gi, 'cardiotocography fetal heart rate'],
  [/\bpr[eé][-\s]?ecl[aâ]mpsia|ecl[aâ]mpsia|síndrome\s+hellp\b/gi, 'preeclampsia schistocytes blood smear'],
  [/\bhemorragia\s+p[oó]s[-\s]?parto|bal[aã]o\s+de\s+bakri\b/gi, 'postpartum hemorrhage uterus'],
  [/\bgravidez\s+ect[oó]pica\b/gi, 'ectopic pregnancy ultrasound'],
  [/\bpneumonia\b/gi, 'lobar pneumonia chest xray'],
  [/\btuberculose\b/gi, 'pulmonary tuberculosis cavitation chest xray'],
  [/\bderrame\s+pleural\b/gi, 'pleural effusion chest xray'],
  [/\btromboembolismo\s+pulmonar|\btep\b/gi, 'pulmonary embolism CT angiography'],
  [/\bavc\s+isqu[eê]mico\b/gi, 'ischemic stroke brain CT'],
  [/\bavc\s+hemorr[aá]gico|hemorragia\s+subaracn[oó]idea\b/gi, 'subarachnoid hemorrhage brain CT'],
  [/\bhematoma\s+epidural\b/gi, 'epidural hematoma brain CT'],
  [/\bhematoma\s+subdural\b/gi, 'subdural hematoma brain CT'],
  [/\bobstru[cç][aã]o\s+intestinal|volvo\b/gi, 'bowel obstruction sigmoid volvulus xray'],
  [/\bintussuscep[cç][aã]o\b/gi, 'intussusception target sign ultrasound'],
  [/\bretinopatia\s+hipertensiva|retinopatia\s+diab[eé]tica|fundoscopia\b/gi, 'hypertensive retinopathy fundus'],
];

function buildEnglishMedicalSearchQuery(rawQuery: string): string {
  let translated = rawQuery;
  for (const [regex, enTerm] of PT_TO_EN_MEDICAL_TERMS) {
    if (regex.test(translated)) {
      return enTerm;
    }
  }
  translated = translated
    .replace(/\b(?:na|no|em|de|do|da|dos|das|para|com|sem|qual|conduta|imediata|primeira|escolha|linha|tratamento|manejo|paciente)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return translated || 'medical radiology diagnosis';
}

async function searchWikimediaCommonsMedical(searchQuery: string) {
  const enQuery = buildEnglishMedicalSearchQuery(searchQuery);
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', `filetype:bitmap ${enQuery}`);
  url.searchParams.set('gsrnamespace', '6');
  url.searchParams.set('gsrlimit', '8');
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|extmetadata');
  url.searchParams.set('iiurlwidth', '800');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  const resp = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'InternatoFirstCardArchitect/1.0 (https://aistudio.google.com; medical-education)',
    },
    signal: AbortSignal.timeout(2000),
  });
  if (!resp.ok) {
    throw new Error(`Wikimedia HTTP ${resp.status}`);
  }
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
            extmetadata?: {
              ImageDescription?: { value?: string };
              ObjectName?: { value?: string };
            };
          }>;
        }
      >;
    };
  };

  const pages = Object.values(data?.query?.pages || {});
  return pages
    .map((p, idx) => {
      const info = p.imageinfo?.[0];
      if (!info?.url) return null;
      const rawTitle = (p.title || `Imagem Médica ${idx + 1}`).replace(/^File:/i, '');
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

      return {
        id: `wiki-${p.pageid || idx}`,
        title: rawTitle.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
        thumbUrl: info.thumburl || info.url,
        fullUrl: info.url,
        description: cleanDesc || `Imagem médica de referência para ${searchQuery}.`,
        suggestedFilename: cleanName.endsWith('.jpg') || cleanName.endsWith('.png') ? cleanName : `${cleanName}.jpg`,
        defaultLegend: cleanDesc
          ? `Exame complementar demonstrando ${cleanDesc.slice(0, 130)}.`
          : `Imagem diagnóstica demonstrando achado clássico de ${searchQuery}.`,
        source: 'Wikimedia Commons Medical (Google / Open Access)',
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

/**
 * Pure Node.js CRC32 + PKZIP builder so we can export a complete offline .zip bundle
 * containing `<deck_key>_notes.json` + `collection.media/<images>` + `04_Mídias/<deck_key>/<images>`
 * without any external dependencies.
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

    // Local file header (30 bytes + name)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(0, 8); // compression method: 0 (store)
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x5421, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, dataBuf);

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(0, 10); // store
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
          'User-Agent': 'InternatoFirstCardArchitect/1.0 (https://aistudio.google.com; medical-education)',
        },
        signal: AbortSignal.timeout(3500),
      });
      if (!resp.ok) return null;
      const arrBuf = await resp.arrayBuffer();
      return Buffer.from(arrBuf);
    } catch {
      return null;
    }
  }
  return null;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Endpoint 0A: Buscar Imagens Médicas Fidedignas (Wikimedia Commons Medical / Google Search)
  app.post('/api/media/search-medical-images', async (req, res) => {
    try {
      const { query = '', topic = '', question = '' } = req.body || {};
      const rawSearch = (query || topic || question || 'clinical diagnosis').trim();
      const results = await searchWikimediaCommonsMedical(rawSearch);
      return res.json({
        query: rawSearch,
        images: results.slice(0, 8),
      });
    } catch {
      return res.json({
        query: 'atlas_clinico',
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
          'User-Agent': 'InternatoFirstCardArchitect/1.0 (https://aistudio.google.com; medical-education)',
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

  // Endpoint 0C: Exportar Pacote Anki Offline (.zip com *_notes.json + collection.media + 04_Mídias/<deck_key>)
  app.post('/api/media/export-bundle', async (req, res) => {
    try {
      const {
        deckKey = 'internato_deck',
        notesJson = '[]',
        mediaManifest = [],
      } = req.body || {};

      const cleanDeckKey = String(deckKey || 'internato_deck')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_');

      const zipEntries: Array<{ name: string; data: Buffer }> = [];
      const jsonBuffer = Buffer.from(String(notesJson), 'utf8');

      // Include JSON at root and inside 01_Notas/ for immediate compatibility with desktop criador_cards
      zipEntries.push({
        name: `${cleanDeckKey}_notes.json`,
        data: jsonBuffer,
      });
      zipEntries.push({
        name: `01_Notas/${cleanDeckKey}_notes.json`,
        data: jsonBuffer,
      });

      const seenFilenames = new Set<string>();
      if (Array.isArray(mediaManifest)) {
        for (const item of mediaManifest) {
          const localFilename = String(item?.filename || item?.localFilename || '').trim();
          const sourceUrl = String(item?.sourceUrl || '').trim();
          if (!localFilename || seenFilenames.has(localFilename)) continue;

          const imgBuf = await resolveMediaSourceToBuffer(sourceUrl);
          if (imgBuf && imgBuf.length > 0) {
            seenFilenames.add(localFilename);
            // Save inside collection.media/ (for direct copy to Anki) AND 04_Mídias/<deck_key>/ (for uv run cards)
            zipEntries.push({
              name: `collection.media/${localFilename}`,
              data: imgBuf,
            });
            zipEntries.push({
              name: `04_Mídias/${cleanDeckKey}/${localFilename}`,
              data: imgBuf,
            });
          }
        }
      }

      const readmeText = [
        `PACOTE OFFLINE ANKI — ${cleanDeckKey.toUpperCase()}`,
        '==========================================================',
        `1. Arquivo de Notas JSON (com <img src="nome_arquivo_local"> sem links externos):`,
        `   - ${cleanDeckKey}_notes.json`,
        `   - 01_Notas/${cleanDeckKey}_notes.json`,
        '',
        `2. Mídias Baixadas e Embutidas Offline (${seenFilenames.size} arquivo(s)):`,
        '   - Pasta collection.media/ : copie os arquivos diretamente para a pasta collection.media do seu Anki.',
        `   - Pasta 04_Mídias/${cleanDeckKey}/ : pronta para o gerador desktop (uv run cards build / anki.py), que empacota automaticamente no .apkg.`,
        '',
      ].join('\n');

      zipEntries.push({
        name: 'LEIA-ME_ANKI_OFFLINE.txt',
        data: Buffer.from(readmeText, 'utf8'),
      });

      const zipBuffer = buildZipArchive(zipEntries);
      res.setHeader('Content-Type', 'application/zip');
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

  // Endpoint 1: Passo 1 — Gerar Mapa Clínico (P1 a P4) + Atualizações de Diretrizes
  app.post('/api/gemini/clinical-map', async (req, res) => {
    try {
      const {
        deckKey = 'tema_clinico_internato',
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

      const parts: Array<
        | { text: string }
        | { inlineData: { mimeType: string; data: string } }
      > = [];

      for (const pdf of pdfs) {
        if (pdf?.base64Data) {
          parts.push({
            inlineData: {
              mimeType: 'application/pdf',
              data: pdf.base64Data,
            },
          });
        }
      }

      const prompt = `Analise os documentos PDF anexados (se houver) e o tema médico indicado pela Deck Key "${deckKey}".
${existingJsonSummary ? `Resumo do deck atual enviado pelo usuário:\n${existingJsonSummary}\n` : ''}
${
  useGoogleSearch
    ? 'Utilize o Google Search para verificar diretrizes atualizadas do Ministério da Saúde (MS), Sociedades Médicas Brasileiras (FEBRASGO, SBC, SBP, SBGG, CBC, etc.), consensos internacionais recentes e referências de exames de imagem/traçados clássicos sobre este tema.'
    : ''
}

Gere um Mapa Clínico estruturado segundo a Doutrina Internato-First (P1 a P4) para guiar a criação/recriação do deck.
Inclua em P2 conceitos de Reconhecimento Visual de exames/imagens fidedignas (ECG, RX, TC, USG, CTG, lesões clássicas).
Aplique o Filtro Negativo: exclua genética de bancada, história da medicina e epidemiologia percentual que não mude conduta.
Retorne EXCLUSIVAMENTE um objeto JSON válido (sem comentários fora do JSON) no seguinte formato exato:
{
  "themeTitle": "Nome Completo do Tema Médico",
  "specialty": "Especialidade (Clínica / Cirurgia / GO / Pediatria / Preventiva)",
  "deckKey": "${deckKey}",
  "guidelineUpdates": [
    "Resumo objetivo de atualização de diretriz MS / Sociedade Brasileira / Internacional com pontos de corte e condutas"
  ],
  "items": [
    {
      "id": "p1-1",
      "priority": "P1",
      "subtopic": "Subtema clínico sem spoiler",
      "concept": "Conceito clínico de alto impacto (doses em emergência, vias, red flags, conduta minuto zero, 2ª linha, antídotos)",
      "guidelineNote": "Referência ou destaque USP/Unicamp/Diretriz",
      "targetCardType": "basic",
      "checked": true
    }
  ]
}
Gere entre 8 e 14 itens distribuídos em P1, P2, P3 e P4, alternando targetCardType entre "basic" e "cloze" (50%/50%).`;

      parts.push({ text: prompt });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
          ...(useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
        },
      });

      const rawText = response.text || '{}';
      const cleanedJson = extractJsonBlock(rawText);
      const parsed = JSON.parse(cleanedJson);
      const groundingSources = extractGroundingSources(response);

      return res.json({
        ...parsed,
        deckKey: parsed.deckKey || deckKey,
        groundingSources:
          groundingSources.length > 0
            ? groundingSources
            : parsed.groundingSources || [],
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Erro ao gerar o Mapa Clínico com Gemini.';
      return res.status(200).json({ fallback: true, error: message });
    }
  });

  // Endpoint 2: Passo 2 — Recriar Deck JSON Canônico (Preservando IDs FSRS e Mídias Offline)
  app.post('/api/gemini/generate-deck', async (req, res) => {
    try {
      const {
        deckKey = 'tema_clinico_internato',
        pdfs = [],
        clinicalMap = null,
        existingMetadata = null,
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

      const parts: Array<
        | { text: string }
        | { inlineData: { mimeType: string; data: string } }
      > = [];

      for (const pdf of pdfs) {
        if (pdf?.base64Data) {
          parts.push({
            inlineData: {
              mimeType: 'application/pdf',
              data: pdf.base64Data,
            },
          });
        }
      }

      const existingIds: number[] = existingMetadata?.existingIds || [];
      const maxExistingId =
        existingIds.length > 0 ? Math.max(...existingIds) : 171000100;
      const mediaTags: string[] = existingMetadata?.mediaTags || [];
      const rawCardsSummary = buildCompactCardsDigest(existingMetadata?.rawCards || []);

      const checkedMapItems = Array.isArray(clinicalMap?.items)
        ? clinicalMap.items.filter((i: { checked?: boolean }) => i.checked !== false)
        : [];

      const prompt = `Recrie, pode redundâncias e lapide totalmente o baralho canônico para o tema "${deckKey}".

DADOS DO BARALHO ANTIGO PARA CURADORIA E PRESERVAÇÃO FSRS:
- Total de cards enviados originalmente: ${existingIds.length}
- Maior ID existente: ${maxExistingId} (se criar novos cards, use IDs sequenciais a partir de ${maxExistingId + 1})
- Tags de Mídia Originais: ${JSON.stringify(mediaTags)}
- Resumo Compacto dos Cards Originais (você DEVE: 1) EXCLUIR os IDs de cards duplicados/redundantes/fracos; 2) REFAZER os sobreviventes mantendo o número "id" original daquele conceito; 3) CONVERTER basic <-> cloze para atingir 50% basic / 50% cloze; 4) CRIAR novos cards com IDs >= ${maxExistingId + 1} para cobrir conceitos P1-P4 ausentes):
${rawCardsSummary}

MAPA CLÍNICO APROVADO (P1 a P4):
${checkedMapItems.length > 0 ? JSON.stringify(checkedMapItems, null, 2) : 'Mapear integralmente P1, P2, P3 e P4 do tema.'}

CHECKLIST DE VALIDAÇÃO ANTES DE GERAR CADA CARD:
1. QUANTIDADE ADEQUADA AO TEMA + PROPORÇÃO 50/50: Não devolva o mesmo número de cards por inércia. Pode excluir IDs redundantes ou criar novos IDs sequenciais. O baralho final DEVE ter entre 45% e 55% "basic" e entre 45% e 55% "cloze".
2. Se "basic":
   - "question": no máximo 45 a 50 palavras, seguindo a Matriz de Tripla Ancoragem ([CENÁRIO + IDADE/IG] + [CLÍNICA + SINAIS VITAIS] + [COMANDO TEMPORAL FECHADO: minuto zero / exame inicial vs padrão-ouro / 1ª escolha / 2ª linha após falha]). PROIBIDO "Qual a conduta?".
   - "answer": 1 a 12 palavras (MÁXIMO ESTRITO 15 palavras e <= 110 caracteres), terminado em ponto final (.), SEM ponto-e-vírgula (;) e SEM tag <b> externo envolvendo toda a resposta.
3. Se "cloze":
   - "question": contém ESTRITAMENTE UMA lacuna {{c1::...}} com 1 a 5 palavras dentro da lacuna, unidades de medida FORA da lacuna, SEM preposição pendurada no final, SEM "::dica".
   - "answer": "" (string vazia).
4. Imagens Médicas Fidedignas:
   - Nos cards de reconhecimento visual (P2), use "image_mode": "recognition", inclua <img src="NOME_ARQUIVO.jpg"> na "question" e inicie o "hint" com <i>Descrição do achado visual...</i><br><br><b>Comentário:</b> ...
5. Duplo Salto Cognitivo Implícito: NUNCA faça pergunta composta ("Qual o diagnóstico e a conduta?"). Apresente o caso clínico e pergunte apenas 1 decisão atômica.
6. "topic": formato "Tema - Subtema", ZERO spoiler (nenhuma palavra da resposta ou sinônimo pode aparecer no topic) e NUNCA repita o topic em negrito dentro do question.
7. "question": ZERO spoiler entre parênteses e ZERO LaTeX ($...$, \\rightarrow).
8. "hint": deve conter "<b>Comentário:</b> ", ter 1 a 2 frases (entre 180 e 300 caracteres visíveis medidos APÓS "<b>Comentário:</b> ", NUNCA passar de 320 caracteres visíveis), destacar termos-chave em <b>negrito</b> e trazer contraste diferencial obrigatório.
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
      "question": "Na Sala Vermelha, paciente de 54 anos apresenta [clínica + sinais vitais]. Qual a conduta imediata de estabilização (minuto zero)?",
      "answer": "Conduta atômica curta terminada em ponto.",
      "hint": "<b>Comentário:</b> Explicação concisa de 180 a 300 chars visíveis com <b>termos-chave</b> e contraste diferencial."
    }
  ]
}`;

      parts.push({ text: prompt });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
          ...(useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
        },
      });

      const rawText = response.text || '{}';
      const notes = parseOrRecoverNotesJson(rawText);
      const groundingSources = extractGroundingSources(response);

      return res.json({
        deck_key: deckKey,
        notes,
        groundingSources,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Erro ao gerar o Deck JSON Canônico com Gemini.';
      return res.status(200).json({ fallback: true, error: message });
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

      const prompt = `Reescreva cirurgicamente APENAS os cards abaixo que foram reprovados pelo Linter Wozniak/Matuschak e lint.py.
Mantenha rigorosamente o mesmo "id" numérico e qualquer tag de mídia (<img src="..."> ou <audio>) de cada card. NÃO inclua o campo "sources".

REGRAS DE CORREÇÃO CIRÚRGICA:
- Se "type": "basic" -> "question" com <= 50 palavras e Tripla Ancoragem (comando temporal fechado: minuto zero, exame inicial vs padrão-ouro, 1ª escolha ou 2ª linha após falha); "answer" DEVE ter entre 1 e 12 palavras (máx 15 palavras / 110 chars), terminar com ".", NÃO conter ";" e NÃO ter <b> envolvendo tudo.
- Se "type": "cloze" -> "question" DEVE ter estritamente 1 lacuna {{c1::...}} com 1 a 5 palavras, unidades fora da lacuna, sem preposição pendurada no final, SEM "::dica", e "answer" DEVE ser "".
- Se pergunta composta -> transforme em pergunta atômica com Duplo Salto Cognitivo Implícito (apenas 1 ponto de interrogação).
- Se spoiler no "topic" ou entre parênteses na "question" -> remova imediatamente a palavra da resposta ou sinônimo do topic/parênteses mantendo formato "Tema - Subtema".
- Substitua qualquer LaTeX ($...$, \\rightarrow) por Unicode puro (→, ≥, ≤).
- "hint": DEVE conter "<b>Comentário:</b> ", ter entre 180 e 295 caracteres visíveis APÓS o prefixo "<b>Comentário:</b> " (PROIBIDO passar de 320 caracteres visíveis), com termos-chave em <b>negrito</b> e contraste diferencial.

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

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
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
      const message =
        error instanceof Error ? error.message : 'Erro ao auto-reparar cards com Gemini.';
      return res.status(200).json({ fallback: true, error: message });
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Internato-First Card Architect server running at http://localhost:${PORT}`);
  });
}

startServer();
