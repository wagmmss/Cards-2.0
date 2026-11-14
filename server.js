var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_config = require("dotenv/config");
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_url = require("url");
var import_vite = require("vite");
var import_genai = require("@google/genai");
var import_meta = {};
var __filename = (0, import_url.fileURLToPath)(import_meta.url);
var __dirname = import_path.default.dirname(__filename);
var PORT = 3e3;
function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }
  return new import_genai.GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
var INTERNATO_SYSTEM_INSTRUCTION = `Voc\xEA \xE9 o "Internato-First Card Architect (USP/Unicamp + FSRS)", um preceptor s\xEAnior do Internato da FMUSP e Unicamp e especialista nas Leis de Piotr Wozniak (SuperMemo) e Andy Matuschak.

SUAS REGRAS INEGOCI\xC1VEIS DE SISTEMA (SINCRONIZADAS COM O MOTOR DESKTOP CRIADOR_CARDS):

1. LIBERDADE TOTAL PARA REFAZER, PODAR OU EXPANDIR CARDS PRESERVANDO O ID (FSRS):
- N\xC3O \xC9 PORQUE O USU\xC1RIO ENVIOU N CARDS (ex.: 100 cards) QUE VOC\xCA DEVE DEVOLVER EXATAMENTE N CARDS! O n\xFAmero final de cards deve refletir a real necessidade cl\xEDnica do tema (P1 a P4):
  a) PODAR (EXCLUIR IDs): Exclua sem hesitar os IDs de cards duplicados/sobrepostos, triviais, puramente decorebas ou reprovados pelo Filtro Negativo.
  b) REFAZER & REBALANCEAR PRESERVANDO O ID: Nos conceitos sobreviventes, reescreva pergunta, resposta e coment\xE1rio do zero e converta livremente "cloze" <-> "basic" para atingir a propor\xE7\xE3o obrigat\xF3ria de ~50% "basic" / 50% "cloze" (45% a 55%), mantendo o n\xFAmero exato do "id" original daquele card para preservar o hist\xF3rico FSRS no Anki.
  c) EXPANDIR (CRIAR NOVOS IDs): Se faltarem conceitos cl\xEDnicos essenciais de P1 a P4 para cobrir o tema com seguran\xE7a de prova pr\xE1tica e beira-leito, crie novos cards atribuindo novos IDs num\xE9ricos sequenciais ap\xF3s o maior ID existente (max_id + 1, max_id + 2...).
- N\xC3O inclua o campo "sources" nos cards (desnecess\xE1rio).

2. PRIORIDADE PARA IMAGENS M\xC9DICAS FIDEDIGNAS E SEM SPOILERS (RECOGNITION & FEEDBACK OFFLINE):
- As imagens retiradas de PDFs/apostilas N\xC3O s\xE3o prioridade. A prioridade absoluta s\xE3o BOAS IMAGENS M\xC9DICAS FIDEDIGNAS vindas da web (Google Search, Wikimedia Commons Medical, NLM Open-i, Radiopaedia, ECGpedia), preferindo figuras limpas (sem setas ou legendas embutidas que entreguem o diagn\xF3stico na pr\xF3pria imagem).
- Sempre que um conceito envolver reconhecimento visual (ECG, RX de t\xF3rax/abdome, TC, USG/FAST, cardiotocografia, dermatologia, fundoscopia, esfrega\xE7o sangu\xEDneo ou sinal semiol\xF3gico/cir\xFArgico), incorpore uma imagem fidedigna usando <img src="URL_OU_ARQUIVO"> e defina:
  - "image_mode": "recognition" (card "basic" com <img src="..."> na "question" sem entregar o achado no texto da pergunta + legenda explicativa em it\xE1lico <i>Descri\xE7\xE3o do achado visual...</i><br><br> no in\xEDcio do "hint" antes de <b>Coment\xE1rio:</b>).
  - ou "image_mode": "feedback" (quando a imagem entra no "hint" como algoritmo/fluxograma/anatomia de refor\xE7o visual).

3. DOUTRINA INTERNATO-FIRST GERAL (P1 -> P4) E FILTRO NEGATIVO:
- P1 (Urg\xEAncia / Emerg\xEAncia / Minuto Zero): Sinais de alarme (red flags), crit\xE9rios de instabilidade/gravidade, conduta imediata de estabiliza\xE7\xE3o, manobras salvadoras, cirurgia/parto de emerg\xEAncia, 1\xAA droga (com dose e via), conduta na refratariedade (2\xAA linha), ant\xEDdotos e contraindica\xE7\xF5es fatais.
- P2 (Decis\xE3o Diagn\xF3stica e Reconhecimento Visual): Exame inicial de 1\xAA linha vs. Padr\xE3o-Ouro confirmat\xF3rio, interpreta\xE7\xE3o de exames/imagens em image_mode: "recognition", escores e pontos de corte num\xE9ricos exatos.
- P3 (Manejo Ambulatorial / UBS / Enfermaria / Preven\xE7\xE3o): Tratamento de 1\xAA escolha, popula\xE7\xF5es especiais (gestantes, crian\xE7as, idosos, comorbidades), rastreamento, profilaxias, vacinas, crit\xE9rios de interna\xE7\xE3o e controle de cura.
- P4 (Fisiopatologia Aplicada e Diferenciais Paulistas): Mecanismos que explicam sinais cl\xEDnicos/tratamentos e diferenciais USP-SP/USP-RP/Unicamp.
- FILTRO NEGATIVO ESTRITO: ZERO gen\xE9tica/biologia molecular de bancada sem impacto terap\xEAutico imediato (ex.: muta\xE7\xF5es KRAS, transloca\xE7\xF5es raras), ZERO hist\xF3ria da medicina/datas e ZERO epidemiologia percentual solta que n\xE3o mude conduta.
- POL\xCDTICA DE DOSES: Cobrar doses exatas APENAS em emerg\xEAncias/ant\xEDdotos/choque/ACLS/obstetr\xEDcia cr\xEDtica/intoxica\xE7\xF5es, pediatria cr\xEDtica ou ponto de corte que muda a indica\xE7\xE3o.

4. MATRIZ DE REDA\xC7\xC3O COM TRIPLA ANCORAGEM (CARDS BASIC):
- Todo card "basic" de caso cl\xEDnico DEVE ter no m\xE1ximo 45 a 50 palavras na pergunta (Anti-Pattern-Matching) e obedecer \xE0 estrutura:
  [CEN\xC1RIO + IDADE/IG] + [CL\xCDNICA + SINAIS VITAIS/EXAME] + [COMANDO TEMPORAL INEQU\xCDVOCO]
  - Comando Temporal Fechado \u2014 PROIBIDO "Qual a conduta?":
    1) "Qual a conduta imediata de estabiliza\xE7\xE3o (minuto zero)?"
    2) "Qual o exame inicial de primeira linha?" ou "Qual o exame padr\xE3o-ouro confirmat\xF3rio?"
    3) "Qual o tratamento medicamentoso de primeira escolha (f\xE1rmaco, dose e via)?"
    4) "Ap\xF3s falha de [1\xAA linha], qual a conduta imediata de segunda linha (ou definitiva)?"
- Em "basic": "answer" ultra-curto com 1 a 12 palavras (M\xC1XIMO ESTRITO: 15 palavras / 110 caracteres), terminado em ponto final (.), PROIBIDO conter ";" e sem <b> externo envolvendo toda a resposta.

5. REGRAS DE ENGENHARIA PARA CARDS CLOZE E PROPOR\xC7\xC3O 50/50:
- Equil\xEDbrio OBRIGAT\xD3RIO do deck: 45% a 55% "basic" e 45% a 55% "cloze". Se o deck original tiver excesso de "cloze" ou de "basic", converta os cards necess\xE1rios!
- Em "cloze": estritamente 1 lacuna {{c1::...}} (1 a 5 palavras, m\xE1x 60 chars), "answer": "".
- Unidades de medida SEMPRE FORA da lacuna (ex.: "> {{c1::126}} mg/dL").
- PROIBIDO artigo/preposi\xE7\xE3o pendurada no fim da lacuna (ex.: {{c1::... de}}).
- PROIBIDO usar "::dica" gen\xE9rica e PROIBIDO muleta p\xF3s-lacuna entre par\xEAnteses.

6. ZERO SPOILER, PROIBI\xC7\xC3O DE LATEX E COMENT\xC1RIO CIR\xDARGICO:
- "topic": formato estrito "Tema - Subtema" (NUNCA repetir o topic em negrito dentro do question e NUNCA vazar palavras da resposta ou sin\xF4nimos como adrenalina/epinefrina, noradrenalina/norepinefrina, vasopressina/adh).
- PROIBIDO LaTeX ($...$, \\rightarrow, \\ge, \\le): use exclusivamente Unicode nativo (\u2192, \u2265, \u2264, \xB1, \u03B1, \u03B2, \xB5g, mEq/L) e HTML (<sub>, <sup>, <b>).
- PROIBIDO categorias antigas da FDA na gesta\xE7\xE3o ("Categoria B/C/D/X"): use "1\xAA escolha na gesta\xE7\xE3o", "seguro na gesta\xE7\xE3o" ou "contraindicado (teratog\xEAnico)".
- "hint": sempre iniciando com "<b>Coment\xE1rio:</b> " (ou precedido por <i>Legenda visual...</i><br><br> nos cards recognition) de 1 a 2 frases (180 a 300 caracteres vis\xEDveis medidos AP\xD3S o prefixo "<b>Coment\xE1rio:</b> ", teto estrito de 320 chars), termos-chave em <b>negrito</b> e contraste diferencial obrigat\xF3rio.`;
function extractJsonBlock(text) {
  if (!text) return "{}";
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  if (firstBrace === -1 && firstBracket === -1) return text.trim();
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    const lastBracket = text.lastIndexOf("]");
    if (lastBracket > firstBracket) return text.slice(firstBracket, lastBracket + 1);
  }
  if (firstBrace !== -1) {
    const lastBrace = text.lastIndexOf("}");
    if (lastBrace > firstBrace) return text.slice(firstBrace, lastBrace + 1);
  }
  return text.trim();
}
function buildCompactCardsDigest(rawCards) {
  if (!Array.isArray(rawCards) || rawCards.length === 0) {
    return "Nenhum JSON anterior enviado.";
  }
  return rawCards.map((c) => {
    const id = c.id ?? "";
    const type = c.type === "cloze" ? "cloze" : "basic";
    const topic = String(c.topic || "").trim();
    const q = String(c.question || "").replace(/\s+/g, " ").trim().slice(0, 220);
    const a = String(c.answer || "").replace(/\s+/g, " ").trim().slice(0, 90);
    return `- ID:${id} [${type}] Topic:"${topic}" | Q:"${q}"${a ? ` | A:"${a}"` : ""}`;
  }).join("\n");
}
function parseOrRecoverNotesJson(rawText) {
  const cleanedJson = extractJsonBlock(rawText);
  try {
    const parsed = JSON.parse(cleanedJson);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.notes)) return parsed.notes;
  } catch {
    const recovered = [];
    const objRegex = /\{[^{}]*"id"\s*:\s*\d+[^{}]*"question"\s*:\s*"[\s\S]*?"[^{}]*\}/g;
    let match;
    while ((match = objRegex.exec(rawText)) !== null) {
      try {
        const obj = JSON.parse(match[0]);
        if (obj && typeof obj === "object" && obj.question) {
          recovered.push(obj);
        }
      } catch {
      }
    }
    if (recovered.length > 0) return recovered;
    throw new Error("Resposta JSON truncada ou inv\xE1lida do modelo.");
  }
  return [];
}
function extractGroundingSources(response) {
  const resObj = response;
  const chunks = resObj?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const ch of chunks) {
    const uri = ch?.web?.uri;
    const title = ch?.web?.title || uri || "Diretriz / Fonte M\xE9dica";
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      out.push({ title, uri });
    }
  }
  return out;
}
var PT_TO_EN_MEDICAL_TERMS = [
  [/\bapendicite(?:\s+aguda)?\b/gi, "acute appendicitis CT"],
  [/\bdiverticulite(?:\s+aguda)?\b/gi, "acute diverticulitis CT"],
  [/\bcolecistite(?:\s+aguda)?\b/gi, "acute cholecystitis ultrasound"],
  [/\bpancreatite(?:\s+aguda)?\b/gi, "acute pancreatitis CT"],
  [/\bpneumot[oó]rax(?:\s+hipertensivo)?\b/gi, "tension pneumothorax chest xray"],
  [/\bpneumoperit[oô]nio\b/gi, "pneumoperitoneum chest xray"],
  [/\bedema\s+agudo\s+de\s+pulm[aã]o\b/gi, "pulmonary edema chest xray"],
  [/\binsufici[eê]ncia\s+card[ií]aca\b/gi, "heart failure cardiomegaly chest xray"],
  [/\binfarto|iam|supradesnivelamento\b/gi, "ST elevation myocardial infarction ECG"],
  [/\bfibrila[cç][aã]o\s+atrial\b/gi, "atrial fibrillation ECG"],
  [/\btaquicardia\s+ventricular\b/gi, "ventricular tachycardia ECG"],
  [/\bflutter\s+atrial\b/gi, "atrial flutter ECG"],
  [/\bbloqueio\s+atrioventricular\b/gi, "third degree heart block ECG"],
  [/\bcardiotocografia|dip\s+ii|sofrimento\s+fetal\b/gi, "cardiotocography fetal heart rate"],
  [/\bpr[eé][-\s]?ecl[aâ]mpsia|ecl[aâ]mpsia|síndrome\s+hellp\b/gi, "preeclampsia schistocytes blood smear"],
  [/\bhemorragia\s+p[oó]s[-\s]?parto|bal[aã]o\s+de\s+bakri\b/gi, "postpartum hemorrhage uterus"],
  [/\bgravidez\s+ect[oó]pica\b/gi, "ectopic pregnancy ultrasound"],
  [/\bpneumonia\b/gi, "lobar pneumonia chest xray"],
  [/\btuberculose\b/gi, "pulmonary tuberculosis cavitation chest xray"],
  [/\bderrame\s+pleural\b/gi, "pleural effusion chest xray"],
  [/\btromboembolismo\s+pulmonar|\btep\b/gi, "pulmonary embolism CT angiography"],
  [/\bavc\s+isqu[eê]mico\b/gi, "ischemic stroke brain CT"],
  [/\bavc\s+hemorr[aá]gico|hemorragia\s+subaracn[oó]idea\b/gi, "subarachnoid hemorrhage brain CT"],
  [/\bhematoma\s+epidural\b/gi, "epidural hematoma brain CT"],
  [/\bhematoma\s+subdural\b/gi, "subdural hematoma brain CT"],
  [/\bobstru[cç][aã]o\s+intestinal|volvo\b/gi, "bowel obstruction sigmoid volvulus xray"],
  [/\bintussuscep[cç][aã]o\b/gi, "intussusception target sign ultrasound"],
  [/\bretinopatia\s+hipertensiva|retinopatia\s+diab[eé]tica|fundoscopia\b/gi, "hypertensive retinopathy fundus"]
];
function buildEnglishMedicalSearchQuery(rawQuery) {
  let translated = rawQuery;
  for (const [regex, enTerm] of PT_TO_EN_MEDICAL_TERMS) {
    if (regex.test(translated)) {
      return enTerm;
    }
  }
  translated = translated.replace(/\b(?:na|no|em|de|do|da|dos|das|para|com|sem|qual|conduta|imediata|primeira|escolha|linha|tratamento|manejo|paciente)\b/gi, " ").replace(/\s+/g, " ").trim();
  return translated || "medical radiology diagnosis";
}
async function searchWikimediaCommonsMedical(searchQuery) {
  const enQuery = buildEnglishMedicalSearchQuery(searchQuery);
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", `filetype:bitmap ${enQuery}`);
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", "8");
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|extmetadata");
  url.searchParams.set("iiurlwidth", "800");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  const resp = await fetch(url.toString(), {
    headers: {
      "User-Agent": "InternatoFirstCardArchitect/1.0 (https://aistudio.google.com; medical-education)"
    },
    signal: AbortSignal.timeout(2e3)
  });
  if (!resp.ok) {
    throw new Error(`Wikimedia HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const pages = Object.values(data?.query?.pages || {});
  return pages.map((p, idx) => {
    const info = p.imageinfo?.[0];
    if (!info?.url) return null;
    const rawTitle = (p.title || `Imagem M\xE9dica ${idx + 1}`).replace(/^File:/i, "");
    const cleanName = rawTitle.toLowerCase().replace(/[^a-z0-9.]+/g, "_").replace(/^_|_$/g, "");
    const descHtml = info.extmetadata?.ImageDescription?.value || rawTitle;
    const cleanDesc = descHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
    return {
      id: `wiki-${p.pageid || idx}`,
      title: rawTitle.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "),
      thumbUrl: info.thumburl || info.url,
      fullUrl: info.url,
      description: cleanDesc || `Imagem m\xE9dica de refer\xEAncia para ${searchQuery}.`,
      suggestedFilename: cleanName.endsWith(".jpg") || cleanName.endsWith(".png") ? cleanName : `${cleanName}.jpg`,
      defaultLegend: cleanDesc ? `Exame complementar demonstrando ${cleanDesc.slice(0, 130)}.` : `Imagem diagn\xF3stica demonstrando achado cl\xE1ssico de ${searchQuery}.`,
      source: "Wikimedia Commons Medical (Google / Open Access)"
    };
  }).filter((item) => item !== null);
}
var CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();
function crc32Buffer(buf) {
  let crc = 4294967295;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 255] ^ crc >>> 8;
  }
  return (crc ^ 4294967295) >>> 0;
}
function buildZipArchive(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const dataBuf = entry.data;
    const crc = crc32Buffer(dataBuf);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(67324752, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(2048, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(21537, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, dataBuf);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(33639248, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(2048, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(21537, 14);
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
  eocd.writeUInt32LE(101010256, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}
async function resolveMediaSourceToBuffer(sourceUrl) {
  if (!sourceUrl) return null;
  if (sourceUrl.startsWith("data:")) {
    const commaIdx = sourceUrl.indexOf(",");
    if (commaIdx === -1) return null;
    const header = sourceUrl.slice(0, commaIdx);
    const payload = sourceUrl.slice(commaIdx + 1);
    if (header.includes(";base64")) {
      return Buffer.from(payload, "base64");
    }
    return Buffer.from(decodeURIComponent(payload), "utf8");
  }
  if (sourceUrl.startsWith("http://") || sourceUrl.startsWith("https://")) {
    try {
      const resp = await fetch(sourceUrl, {
        headers: {
          "User-Agent": "InternatoFirstCardArchitect/1.0 (https://aistudio.google.com; medical-education)"
        },
        signal: AbortSignal.timeout(3500)
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
  const app = (0, import_express.default)();
  app.use(import_express.default.json({ limit: "50mb" }));
  app.post("/api/media/search-medical-images", async (req, res) => {
    try {
      const { query = "", topic = "", question = "" } = req.body || {};
      const rawSearch = (query || topic || question || "clinical diagnosis").trim();
      const results = await searchWikimediaCommonsMedical(rawSearch);
      return res.json({
        query: rawSearch,
        images: results.slice(0, 8)
      });
    } catch {
      return res.json({
        query: "atlas_clinico",
        images: []
      });
    }
  });
  app.get("/api/media/proxy-image", async (req, res) => {
    try {
      const targetUrl = String(req.query.url || "").trim();
      if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
        return res.status(400).send("Invalid image URL");
      }
      const upstream = await fetch(targetUrl, {
        headers: {
          "User-Agent": "InternatoFirstCardArchitect/1.0 (https://aistudio.google.com; medical-education)"
        },
        signal: AbortSignal.timeout(4e3)
      });
      if (!upstream.ok) {
        return res.status(upstream.status).send("Failed to fetch upstream image");
      }
      const contentType = upstream.headers.get("content-type") || "image/jpeg";
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.setHeader("Content-Type", contentType);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(buffer);
    } catch {
      return res.status(502).send("Error proxying image");
    }
  });
  app.post("/api/media/export-bundle", async (req, res) => {
    try {
      const {
        deckKey = "internato_deck",
        notesJson = "[]",
        mediaManifest = []
      } = req.body || {};
      const cleanDeckKey = String(deckKey || "internato_deck").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
      const zipEntries = [];
      const jsonBuffer = Buffer.from(String(notesJson), "utf8");
      zipEntries.push({
        name: `${cleanDeckKey}_notes.json`,
        data: jsonBuffer
      });
      zipEntries.push({
        name: `01_Notas/${cleanDeckKey}_notes.json`,
        data: jsonBuffer
      });
      const seenFilenames = /* @__PURE__ */ new Set();
      if (Array.isArray(mediaManifest)) {
        for (const item of mediaManifest) {
          const localFilename = String(item?.filename || item?.localFilename || "").trim();
          const sourceUrl = String(item?.sourceUrl || "").trim();
          if (!localFilename || seenFilenames.has(localFilename)) continue;
          const imgBuf = await resolveMediaSourceToBuffer(sourceUrl);
          if (imgBuf && imgBuf.length > 0) {
            seenFilenames.add(localFilename);
            zipEntries.push({
              name: `collection.media/${localFilename}`,
              data: imgBuf
            });
            zipEntries.push({
              name: `04_M\xEDdias/${cleanDeckKey}/${localFilename}`,
              data: imgBuf
            });
          }
        }
      }
      const readmeText = [
        `PACOTE OFFLINE ANKI \u2014 ${cleanDeckKey.toUpperCase()}`,
        "==========================================================",
        `1. Arquivo de Notas JSON (com <img src="nome_arquivo_local"> sem links externos):`,
        `   - ${cleanDeckKey}_notes.json`,
        `   - 01_Notas/${cleanDeckKey}_notes.json`,
        "",
        `2. M\xEDdias Baixadas e Embutidas Offline (${seenFilenames.size} arquivo(s)):`,
        "   - Pasta collection.media/ : copie os arquivos diretamente para a pasta collection.media do seu Anki.",
        `   - Pasta 04_M\xEDdias/${cleanDeckKey}/ : pronta para o gerador desktop (uv run cards build / anki.py), que empacota automaticamente no .apkg.`,
        ""
      ].join("\n");
      zipEntries.push({
        name: "LEIA-ME_ANKI_OFFLINE.txt",
        data: Buffer.from(readmeText, "utf8")
      });
      const zipBuffer = buildZipArchive(zipEntries);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${cleanDeckKey}_anki_offline_bundle.zip"`
      );
      return res.send(zipBuffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao montar pacote ZIP offline";
      return res.status(500).json({ error: msg });
    }
  });
  app.post("/api/gemini/clinical-map", async (req, res) => {
    try {
      const {
        deckKey = "tema_clinico_internato",
        pdfs = [],
        existingJsonSummary = "",
        useGoogleSearch = true
      } = req.body || {};
      const ai = getAiClient();
      if (!ai) {
        return res.status(200).json({
          fallback: true,
          error: "Chave GEMINI_API_KEY n\xE3o configurada no ambiente. Configure sua chave no painel Settings > Secrets."
        });
      }
      const parts = [];
      for (const pdf of pdfs) {
        if (pdf?.base64Data) {
          parts.push({
            inlineData: {
              mimeType: "application/pdf",
              data: pdf.base64Data
            }
          });
        }
      }
      const prompt = `Analise os documentos PDF anexados (se houver) e o tema m\xE9dico indicado pela Deck Key "${deckKey}".
${existingJsonSummary ? `Resumo do deck atual enviado pelo usu\xE1rio:
${existingJsonSummary}
` : ""}
${useGoogleSearch ? "Utilize o Google Search para verificar diretrizes atualizadas do Minist\xE9rio da Sa\xFAde (MS), Sociedades M\xE9dicas Brasileiras (FEBRASGO, SBC, SBP, SBGG, CBC, etc.), consensos internacionais recentes e refer\xEAncias de exames de imagem/tra\xE7ados cl\xE1ssicos sobre este tema." : ""}

Gere um Mapa Cl\xEDnico estruturado segundo a Doutrina Internato-First (P1 a P4) para guiar a cria\xE7\xE3o/recria\xE7\xE3o do deck.
Inclua em P2 conceitos de Reconhecimento Visual de exames/imagens fidedignas (ECG, RX, TC, USG, CTG, les\xF5es cl\xE1ssicas).
Aplique o Filtro Negativo: exclua gen\xE9tica de bancada, hist\xF3ria da medicina e epidemiologia percentual que n\xE3o mude conduta.
Retorne EXCLUSIVAMENTE um objeto JSON v\xE1lido (sem coment\xE1rios fora do JSON) no seguinte formato exato:
{
  "themeTitle": "Nome Completo do Tema M\xE9dico",
  "specialty": "Especialidade (Cl\xEDnica / Cirurgia / GO / Pediatria / Preventiva)",
  "deckKey": "${deckKey}",
  "guidelineUpdates": [
    "Resumo objetivo de atualiza\xE7\xE3o de diretriz MS / Sociedade Brasileira / Internacional com pontos de corte e condutas"
  ],
  "items": [
    {
      "id": "p1-1",
      "priority": "P1",
      "subtopic": "Subtema cl\xEDnico sem spoiler",
      "concept": "Conceito cl\xEDnico de alto impacto (doses em emerg\xEAncia, vias, red flags, conduta minuto zero, 2\xAA linha, ant\xEDdotos)",
      "guidelineNote": "Refer\xEAncia ou destaque USP/Unicamp/Diretriz",
      "targetCardType": "basic",
      "checked": true
    }
  ]
}
Gere entre 8 e 14 itens distribu\xEDdos em P1, P2, P3 e P4, alternando targetCardType entre "basic" e "cloze" (50%/50%).`;
      parts.push({ text: prompt });
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: { parts },
        config: {
          systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
          ...useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}
        }
      });
      const rawText = response.text || "{}";
      const cleanedJson = extractJsonBlock(rawText);
      const parsed = JSON.parse(cleanedJson);
      const groundingSources = extractGroundingSources(response);
      return res.json({
        ...parsed,
        deckKey: parsed.deckKey || deckKey,
        groundingSources: groundingSources.length > 0 ? groundingSources : parsed.groundingSources || []
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao gerar o Mapa Cl\xEDnico com Gemini.";
      return res.status(200).json({ fallback: true, error: message });
    }
  });
  app.post("/api/gemini/generate-deck", async (req, res) => {
    try {
      const {
        deckKey = "tema_clinico_internato",
        pdfs = [],
        clinicalMap = null,
        existingMetadata = null,
        useGoogleSearch = true
      } = req.body || {};
      const ai = getAiClient();
      if (!ai) {
        return res.status(200).json({
          fallback: true,
          error: "Chave GEMINI_API_KEY n\xE3o configurada no ambiente. Configure sua chave no painel Settings > Secrets."
        });
      }
      const parts = [];
      for (const pdf of pdfs) {
        if (pdf?.base64Data) {
          parts.push({
            inlineData: {
              mimeType: "application/pdf",
              data: pdf.base64Data
            }
          });
        }
      }
      const existingIds = existingMetadata?.existingIds || [];
      const maxExistingId = existingIds.length > 0 ? Math.max(...existingIds) : 171000100;
      const mediaTags = existingMetadata?.mediaTags || [];
      const rawCardsSummary = buildCompactCardsDigest(existingMetadata?.rawCards || []);
      const checkedMapItems = Array.isArray(clinicalMap?.items) ? clinicalMap.items.filter((i) => i.checked !== false) : [];
      const prompt = `Recrie, pode redund\xE2ncias e lapide totalmente o baralho can\xF4nico para o tema "${deckKey}".

DADOS DO BARALHO ANTIGO PARA CURADORIA E PRESERVA\xC7\xC3O FSRS:
- Total de cards enviados originalmente: ${existingIds.length}
- Maior ID existente: ${maxExistingId} (se criar novos cards, use IDs sequenciais a partir de ${maxExistingId + 1})
- Tags de M\xEDdia Originais: ${JSON.stringify(mediaTags)}
- Resumo Compacto dos Cards Originais (voc\xEA DEVE: 1) EXCLUIR os IDs de cards duplicados/redundantes/fracos; 2) REFAZER os sobreviventes mantendo o n\xFAmero "id" original daquele conceito; 3) CONVERTER basic <-> cloze para atingir 50% basic / 50% cloze; 4) CRIAR novos cards com IDs >= ${maxExistingId + 1} para cobrir conceitos P1-P4 ausentes):
${rawCardsSummary}

MAPA CL\xCDNICO APROVADO (P1 a P4):
${checkedMapItems.length > 0 ? JSON.stringify(checkedMapItems, null, 2) : "Mapear integralmente P1, P2, P3 e P4 do tema."}

CHECKLIST DE VALIDA\xC7\xC3O ANTES DE GERAR CADA CARD:
1. QUANTIDADE ADEQUADA AO TEMA + PROPOR\xC7\xC3O 50/50: N\xE3o devolva o mesmo n\xFAmero de cards por in\xE9rcia. Pode excluir IDs redundantes ou criar novos IDs sequenciais. O baralho final DEVE ter entre 45% e 55% "basic" e entre 45% e 55% "cloze".
2. Se "basic":
   - "question": no m\xE1ximo 45 a 50 palavras, seguindo a Matriz de Tripla Ancoragem ([CEN\xC1RIO + IDADE/IG] + [CL\xCDNICA + SINAIS VITAIS] + [COMANDO TEMPORAL FECHADO: minuto zero / exame inicial vs padr\xE3o-ouro / 1\xAA escolha / 2\xAA linha ap\xF3s falha]). PROIBIDO "Qual a conduta?".
   - "answer": 1 a 12 palavras (M\xC1XIMO ESTRITO 15 palavras e <= 110 caracteres), terminado em ponto final (.), SEM ponto-e-v\xEDrgula (;) e SEM tag <b> externo envolvendo toda a resposta.
3. Se "cloze":
   - "question": cont\xE9m ESTRITAMENTE UMA lacuna {{c1::...}} com 1 a 5 palavras dentro da lacuna, unidades de medida FORA da lacuna, SEM preposi\xE7\xE3o pendurada no final, SEM "::dica".
   - "answer": "" (string vazia).
4. Imagens M\xE9dicas Fidedignas:
   - Nos cards de reconhecimento visual (P2), use "image_mode": "recognition", inclua <img src="NOME_ARQUIVO.jpg"> na "question" e inicie o "hint" com <i>Descri\xE7\xE3o do achado visual...</i><br><br><b>Coment\xE1rio:</b> ...
5. Duplo Salto Cognitivo Impl\xEDcito: NUNCA fa\xE7a pergunta composta ("Qual o diagn\xF3stico e a conduta?"). Apresente o caso cl\xEDnico e pergunte apenas 1 decis\xE3o at\xF4mica.
6. "topic": formato "Tema - Subtema", ZERO spoiler (nenhuma palavra da resposta ou sin\xF4nimo pode aparecer no topic) e NUNCA repita o topic em negrito dentro do question.
7. "question": ZERO spoiler entre par\xEAnteses e ZERO LaTeX ($...$, \\rightarrow).
8. "hint": deve conter "<b>Coment\xE1rio:</b> ", ter 1 a 2 frases (entre 180 e 300 caracteres vis\xEDveis medidos AP\xD3S "<b>Coment\xE1rio:</b> ", NUNCA passar de 320 caracteres vis\xEDveis), destacar termos-chave em <b>negrito</b> e trazer contraste diferencial obrigat\xF3rio.
9. N\xC3O inclua o campo "sources".

Retorne EXCLUSIVAMENTE um objeto JSON v\xE1lido no seguinte formato:
{
  "deck_key": "${deckKey}",
  "notes": [
    {
      "id": 171000101,
      "type": "basic",
      "priority": "P1",
      "topic": "Tema - Subtema Sem Spoiler",
      "question": "Na Sala Vermelha, paciente de 54 anos apresenta [cl\xEDnica + sinais vitais]. Qual a conduta imediata de estabiliza\xE7\xE3o (minuto zero)?",
      "answer": "Conduta at\xF4mica curta terminada em ponto.",
      "hint": "<b>Coment\xE1rio:</b> Explica\xE7\xE3o concisa de 180 a 300 chars vis\xEDveis com <b>termos-chave</b> e contraste diferencial."
    }
  ]
}`;
      parts.push({ text: prompt });
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: { parts },
        config: {
          systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
          ...useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}
        }
      });
      const rawText = response.text || "{}";
      const notes = parseOrRecoverNotesJson(rawText);
      const groundingSources = extractGroundingSources(response);
      return res.json({
        deck_key: deckKey,
        notes,
        groundingSources
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao gerar o Deck JSON Can\xF4nico com Gemini.";
      return res.status(200).json({ fallback: true, error: message });
    }
  });
  app.post("/api/gemini/repair-cards", async (req, res) => {
    try {
      const { flaggedCards = [], deckKey = "internato_deck" } = req.body || {};
      const ai = getAiClient();
      if (!ai) {
        return res.status(200).json({
          fallback: true,
          error: "Chave GEMINI_API_KEY n\xE3o configurada no ambiente. Configure sua chave no painel Settings > Secrets."
        });
      }
      const prompt = `Reescreva cirurgicamente APENAS os cards abaixo que foram reprovados pelo Linter Wozniak/Matuschak e lint.py.
Mantenha rigorosamente o mesmo "id" num\xE9rico e qualquer tag de m\xEDdia (<img src="..."> ou <audio>) de cada card. N\xC3O inclua o campo "sources".

REGRAS DE CORRE\xC7\xC3O CIR\xDARGICA:
- Se "type": "basic" -> "question" com <= 50 palavras e Tripla Ancoragem (comando temporal fechado: minuto zero, exame inicial vs padr\xE3o-ouro, 1\xAA escolha ou 2\xAA linha ap\xF3s falha); "answer" DEVE ter entre 1 e 12 palavras (m\xE1x 15 palavras / 110 chars), terminar com ".", N\xC3O conter ";" e N\xC3O ter <b> envolvendo tudo.
- Se "type": "cloze" -> "question" DEVE ter estritamente 1 lacuna {{c1::...}} com 1 a 5 palavras, unidades fora da lacuna, sem preposi\xE7\xE3o pendurada no final, SEM "::dica", e "answer" DEVE ser "".
- Se pergunta composta -> transforme em pergunta at\xF4mica com Duplo Salto Cognitivo Impl\xEDcito (apenas 1 ponto de interroga\xE7\xE3o).
- Se spoiler no "topic" ou entre par\xEAnteses na "question" -> remova imediatamente a palavra da resposta ou sin\xF4nimo do topic/par\xEAnteses mantendo formato "Tema - Subtema".
- Substitua qualquer LaTeX ($...$, \\rightarrow) por Unicode puro (\u2192, \u2265, \u2264).
- "hint": DEVE conter "<b>Coment\xE1rio:</b> ", ter entre 180 e 295 caracteres vis\xEDveis AP\xD3S o prefixo "<b>Coment\xE1rio:</b> " (PROIBIDO passar de 320 caracteres vis\xEDveis), com termos-chave em <b>negrito</b> e contraste diferencial.

CARDS SINALIZADOS E SEUS AVISOS:
${JSON.stringify(flaggedCards, null, 2)}

Retorne EXCLUSIVAMENTE um objeto JSON v\xE1lido no formato:
{
  "repairedCards": [
    {
      "id": 171000101,
      "type": "basic",
      "priority": "P1",
      "topic": "Tema - Subtema",
      "question": "...",
      "answer": "...",
      "hint": "<b>Coment\xE1rio:</b> ..."
    }
  ]
}`;
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: prompt,
        config: {
          systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
          responseMimeType: "application/json"
        }
      });
      const rawText = response.text || "{}";
      const cleanedJson = extractJsonBlock(rawText);
      const parsed = JSON.parse(cleanedJson);
      const repairedCards = Array.isArray(parsed) ? parsed : Array.isArray(parsed.repairedCards) ? parsed.repairedCards : [];
      return res.json({ repairedCards, deckKey });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao auto-reparar cards com Gemini.";
      return res.status(200).json({ fallback: true, error: message });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(__dirname, "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Internato-First Card Architect server running at http://localhost:${PORT}`);
  });
}
startServer();
