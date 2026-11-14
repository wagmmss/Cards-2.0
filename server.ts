import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import initSqlJs from 'sql.js';

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
  b) REFAZER & REBALANCEAR PRESERVANDO O ID: Nos conceitos sobreviventes, reescreva pergunta, resposta e comentário do zero e converta livremente "cloze" <-> "basic" para atingir a proporção obrigatória de 45% a 55% "basic" / 45% a 55% "cloze" (meta: 50%/50%), mantendo o número exato do "id" original daquele card para preservar o histórico FSRS no Anki.
  c) EXPANDIR (CRIAR NOVOS IDs): Se faltarem conceitos clínicos essenciais de P1 a P4 para cobrir o tema com segurança de prova prática e beira-leito, crie novos cards atribuindo novos IDs numéricos sequenciais após o maior ID existente (max_id + 1, max_id + 2...).
- NÃO inclua o campo "sources" nos cards.

2. PRIORIDADE PARA IMAGENS MÉDICAS FIDEDIGNAS E SEM SPOILERS (RECOGNITION & FEEDBACK OFFLINE):
- As imagens retiradas de PDFs/apostilas NÃO são prioridade. A prioridade absoluta são BOAS IMAGENS MÉDICAS FIDEDIGNAS vindas da web (Google Search, Wikimedia Commons Medical, NLM Open-i, Radiopaedia, ECGpedia), preferindo figuras limpas (sem setas ou legendas embutidas que entreguem o diagnóstico na própria imagem).
- NUNCA invente nomes de arquivos locais inexistentes em <img src="..."> ou <audio>. Se referenciar uma imagem da web, use uma URL real ou mantenha mídias que já existam nos assets do usuário.

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

5. REGRAS DE ENGENHARIA PARA CARDS CLOZE E PROPORÇÃO 45% A 55%:
- Equilíbrio OBRIGATÓRIO do deck: estritamente entre 45% e 55% "basic" e entre 45% e 55% "cloze". Se o deck original tiver excesso de "cloze" ou de "basic", converta os cards necessários!
- Em "cloze": estritamente 1 lacuna {{c1::...}} (1 a 5 palavras, máx 60 chars), "answer": "".
- Unidades de medida SEMPRE FORA da lacuna (ex.: "> {{c1::126}} mg/dL").
- PROIBIDO artigo/preposição pendurada no fim da lacuna (ex.: {{c1::... de}}).
- PROIBIDO usar "::dica" genérica e PROIBIDO muleta pós-lacuna entre parênteses.

6. ZERO SPOILER POR RADICAL, PROIBIÇÃO DE LATEX E COMENTÁRIO CIRÚRGICO:
- "topic": formato estrito "Tema - Subtema". NUNCA vaze palavras ou radicais da resposta no topic (ex.: PROIBIDO colocar "Manobras" no topic se a resposta começa com "Manobra de...", e PROIBIDO sinônimos como adrenalina/epinefrina, noradrenalina/norepinefrina, vasopressina/adh).
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

// PT -> EN medical translation dictionary for high-recall medical image retrieval on Wikimedia Commons & NLM Open-i
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
  [/\bmelanoma|carcinoma\s+basocelular|dermatoscopia\b/gi, 'melanoma dermoscopy skin lesion'],
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
  url.searchParams.set('gsrlimit', '6');
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|extmetadata');
  url.searchParams.set('iiurlwidth', '800');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  const resp = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'InternatoFirstCardArchitect/2.0 (https://aistudio.google.com; medical-education)',
    },
    signal: AbortSignal.timeout(2500),
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
        suggestedFilename:
          cleanName.endsWith('.jpg') || cleanName.endsWith('.png')
            ? cleanName
            : `${cleanName}.jpg`,
        defaultLegend: cleanDesc
          ? `Exame complementar demonstrando ${cleanDesc.slice(0, 130)}.`
          : `Imagem diagnóstica demonstrando achado clássico de ${searchQuery}.`,
        source: 'Wikimedia Commons Medical',
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

/**
 * Queries the public NLM Open-i Biomedical Image Search Engine (`https://openi.nlm.nih.gov/api/search`)
 * for peer-reviewed clinical images (ECG, Chest X-Ray, CT, Ultrasound, Dermatology).
 */
async function searchNlmOpenIMedical(searchQuery: string) {
  const enQuery = buildEnglishMedicalSearchQuery(searchQuery);
  const url = new URL('https://openi.nlm.nih.gov/api/search');
  url.searchParams.set('query', enQuery);
  url.searchParams.set('m', '1');
  url.searchParams.set('n', '6');

  const resp = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'InternatoFirstCardArchitect/2.0 (https://aistudio.google.com; medical-education)',
    },
    signal: AbortSignal.timeout(2800),
  });
  if (!resp.ok) {
    throw new Error(`NLM Open-i HTTP ${resp.status}`);
  }

  const data = (await resp.json()) as {
    list?: Array<{
      uid?: string;
      title?: string;
      imgLarge?: string;
      imgThumb?: string;
      image?: { caption?: string };
      abstract?: string;
    }>;
  };

  const list = Array.isArray(data?.list) ? data.list : [];
  return list
    .map((item, idx) => {
      const rawImgPath = item.imgLarge || item.imgThumb || '';
      if (!rawImgPath) return null;
      const fullImgUrl = rawImgPath.startsWith('http')
        ? rawImgPath
        : `https://openi.nlm.nih.gov${rawImgPath.startsWith('/') ? '' : '/'}${rawImgPath}`;
      const thumbImgUrl = item.imgThumb
        ? item.imgThumb.startsWith('http')
          ? item.imgThumb
          : `https://openi.nlm.nih.gov${item.imgThumb.startsWith('/') ? '' : '/'}${item.imgThumb}`
        : fullImgUrl;

      const rawCaption =
        item.image?.caption || item.title || item.abstract || `Exame biomédico NLM Open-i ${idx + 1}`;
      const cleanCaption = rawCaption
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
      const cleanUid = (item.uid || `openi_${idx + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_');

      return {
        id: `openi-${cleanUid}-${idx}`,
        title: (item.title || cleanCaption).replace(/<[^>]*>/g, '').slice(0, 85),
        thumbUrl: thumbImgUrl,
        fullUrl: fullImgUrl,
        description: cleanCaption,
        suggestedFilename: `openi_${cleanUid}.png`,
        defaultLegend: `Exame complementar (NLM Open-i) evidenciando ${cleanCaption.slice(0, 125)}.`,
        source: 'NLM Open-i (NIH Biomedical Archive)',
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
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

  // Endpoint 0A: Buscar Imagens Médicas Fidedignas (Wikimedia Commons Medical + NLM Open-i NIH)
  app.post('/api/media/search-medical-images', async (req, res) => {
    try {
      const { query = '', topic = '', question = '' } = req.body || {};
      const rawSearch = (query || topic || question || 'clinical diagnosis').trim();

      const [wikiSettled, openiSettled] = await Promise.allSettled([
        searchWikimediaCommonsMedical(rawSearch),
        searchNlmOpenIMedical(rawSearch),
      ]);

      const wikiImages = wikiSettled.status === 'fulfilled' ? wikiSettled.value : [];
      const openiImages = openiSettled.status === 'fulfilled' ? openiSettled.value : [];

      // Interleave Wikimedia Commons Medical and NLM Open-i results
      const combined = [];
      const maxLen = Math.max(wikiImages.length, openiImages.length);
      for (let i = 0; i < maxLen; i++) {
        if (wikiImages[i]) combined.push(wikiImages[i]);
        if (openiImages[i]) combined.push(openiImages[i]);
      }

      return res.json({
        query: rawSearch,
        images: combined.slice(0, 12),
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
- Resumo Compacto dos Cards Originais (você DEVE: 1) EXCLUIR os IDs de cards duplicados/redundantes/fracos; 2) REFAZER os sobreviventes mantendo o número "id" original daquele conceito; 3) CONVERTER basic <-> cloze para atingir estritamente 45% a 55% basic / 45% a 55% cloze; 4) CRIAR novos cards com IDs >= ${maxExistingId + 1} para cobrir conceitos P1-P4 ausentes):
${rawCardsSummary}

MAPA CLÍNICO APROVADO (P1 a P4):
${checkedMapItems.length > 0 ? JSON.stringify(checkedMapItems, null, 2) : 'Mapear integralmente P1, P2, P3 e P4 do tema.'}

CHECKLIST DE VALIDAÇÃO ANTES DE GERAR CADA CARD:
1. QUANTIDADE ADEQUADA AO TEMA + PROPORÇÃO 45% A 55%: Não devolva o mesmo número de cards por inércia. Pode excluir IDs redundantes ou criar novos IDs sequenciais. O baralho final DEVE ter estritamente entre 45% e 55% "basic" e entre 45% e 55% "cloze".
2. Se "basic":
   - "question": no máximo 45 a 50 palavras, seguindo a Matriz de Tripla Ancoragem ([CENÁRIO + IDADE/IG] + [CLÍNICA + SINAIS VITAIS] + [COMANDO TEMPORAL FECHADO: minuto zero / exame inicial vs padrão-ouro / 1ª escolha / 2ª linha após falha]). PROIBIDO "Qual a conduta?".
   - "answer": 1 a 12 palavras (MÁXIMO ESTRITO 15 palavras e <= 110 caracteres), terminado em ponto final (.), SEM ponto-e-vírgula (;) e SEM tag <b> externo envolvendo toda a resposta.
3. Se "cloze":
   - "question": contém ESTRITAMENTE UMA lacuna {{c1::...}} com 1 a 5 palavras dentro da lacuna, unidades de medida FORA da lacuna, SEM preposição pendurada no final, SEM "::dica".
   - "answer": "" (string vazia).
4. Zero Mídias Órfãs: NUNCA invente nomes de arquivos locais inexistentes em <img src="..."> ou <audio>.
5. Duplo Salto Cognitivo Implícito: NUNCA faça pergunta composta ("Qual o diagnóstico e a conduta?"). Apresente o caso clínico e pergunte apenas 1 decisão atômica.
6. "topic": formato "Tema - Subtema", ZERO spoiler por palavra ou radical (ex.: proibido "Manobras" no topic se a resposta começa com "Manobra de...") e NUNCA repita o topic em negrito dentro do question.
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
Mantenha rigorosamente o mesmo "id" numérico e qualquer tag de mídia válida de cada card. NÃO inclua o campo "sources".

REGRAS DE CORREÇÃO CIRÚRGICA:
- Se "type": "basic" -> "question" com <= 50 palavras e Tripla Ancoragem (comando temporal fechado: minuto zero, exame inicial vs padrão-ouro, 1ª escolha ou 2ª linha após falha); "answer" DEVE ter entre 1 e 12 palavras (máx 15 palavras / 110 chars), terminar com ".", NÃO conter ";" e NÃO ter <b> envolvendo tudo.
- Se "type": "cloze" -> "question" DEVE ter estritamente 1 lacuna {{c1::...}} com 1 a 5 palavras, unidades fora da lacuna, sem preposição pendurada no final, SEM "::dica", e "answer" DEVE ser "".
- Se pergunta composta -> transforme em pergunta atômica com Duplo Salto Cognitivo Implícito (apenas 1 ponto de interrogação).
- Se spoiler por radical ou palavra no "topic" ou entre parênteses na "question" -> remova imediatamente a palavra/radical da resposta (ex.: "Manobras" quando a resposta é "Manobra de...") mantendo formato "Tema - Subtema".
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
