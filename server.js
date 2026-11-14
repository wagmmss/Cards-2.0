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
var import_crypto = __toESM(require("crypto"), 1);
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_url = require("url");
var import_vite = require("vite");
var import_genai = require("@google/genai");
var import_sql = __toESM(require("sql.js"), 1);
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
  b) REFAZER & REBALANCEAR PRESERVANDO O ID: Nos conceitos sobreviventes, reescreva pergunta, resposta e coment\xE1rio do zero e converta livremente "cloze" <-> "basic" para atingir a propor\xE7\xE3o obrigat\xF3ria de 45% a 55% "basic" / 45% a 55% "cloze" (meta: 50%/50%), mantendo o n\xFAmero exato do "id" original daquele card para preservar o hist\xF3rico FSRS no Anki.
  c) EXPANDIR (CRIAR NOVOS IDs): Se faltarem conceitos cl\xEDnicos essenciais de P1 a P4 para cobrir o tema com seguran\xE7a de prova pr\xE1tica e beira-leito, crie novos cards atribuindo novos IDs num\xE9ricos sequenciais ap\xF3s o maior ID existente (max_id + 1, max_id + 2...).
- N\xC3O inclua o campo "sources" nos cards.

2. PRIORIDADE PARA IMAGENS M\xC9DICAS FIDEDIGNAS E SEM SPOILERS (RECOGNITION & FEEDBACK OFFLINE):
- As imagens retiradas de PDFs/apostilas N\xC3O s\xE3o prioridade. A prioridade absoluta s\xE3o BOAS IMAGENS M\xC9DICAS FIDEDIGNAS vindas da web (Google Search, Wikimedia Commons Medical, NLM Open-i, Radiopaedia, ECGpedia), preferindo figuras limpas (sem setas ou legendas embutidas que entreguem o diagn\xF3stico na pr\xF3pria imagem).
- NUNCA invente nomes de arquivos locais inexistentes em <img src="..."> ou <audio>. Se referenciar uma imagem da web, use uma URL real ou mantenha m\xEDdias que j\xE1 existam nos assets do usu\xE1rio.

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

5. REGRAS DE ENGENHARIA PARA CARDS CLOZE E PROPOR\xC7\xC3O 45% A 55%:
- Equil\xEDbrio OBRIGAT\xD3RIO do deck: estritamente entre 45% e 55% "basic" e entre 45% e 55% "cloze". Se o deck original tiver excesso de "cloze" ou de "basic", converta os cards necess\xE1rios!
- Em "cloze": estritamente 1 lacuna {{c1::...}} (1 a 5 palavras, m\xE1x 60 chars), "answer": "".
- Unidades de medida SEMPRE FORA da lacuna (ex.: "> {{c1::126}} mg/dL").
- PROIBIDO artigo/preposi\xE7\xE3o pendurada no fim da lacuna (ex.: {{c1::... de}}).
- PROIBIDO usar "::dica" gen\xE9rica e PROIBIDO muleta p\xF3s-lacuna entre par\xEAnteses.

6. ZERO SPOILER POR RADICAL, PROIBI\xC7\xC3O DE LATEX E COMENT\xC1RIO CIR\xDARGICO:
- "topic": formato estrito "Tema - Subtema". NUNCA vaze palavras ou radicais da resposta no topic (ex.: PROIBIDO colocar "Manobras" no topic se a resposta come\xE7a com "Manobra de...", e PROIBIDO sin\xF4nimos como adrenalina/epinefrina, noradrenalina/norepinefrina, vasopressina/adh).
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
  [/\bretinopatia\s+hipertensiva|retinopatia\s+diab[eé]tica|fundoscopia\b/gi, "hypertensive retinopathy fundus"],
  [/\bmelanoma|carcinoma\s+basocelular|dermatoscopia\b/gi, "melanoma dermoscopy skin lesion"]
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
  url.searchParams.set("gsrlimit", "6");
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|extmetadata");
  url.searchParams.set("iiurlwidth", "800");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  const resp = await fetch(url.toString(), {
    headers: {
      "User-Agent": "InternatoFirstCardArchitect/2.0 (https://aistudio.google.com; medical-education)"
    },
    signal: AbortSignal.timeout(2500)
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
      source: "Wikimedia Commons Medical"
    };
  }).filter((item) => item !== null);
}
async function searchNlmOpenIMedical(searchQuery) {
  const enQuery = buildEnglishMedicalSearchQuery(searchQuery);
  const url = new URL("https://openi.nlm.nih.gov/api/search");
  url.searchParams.set("query", enQuery);
  url.searchParams.set("m", "1");
  url.searchParams.set("n", "6");
  const resp = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "InternatoFirstCardArchitect/2.0 (https://aistudio.google.com; medical-education)"
    },
    signal: AbortSignal.timeout(2800)
  });
  if (!resp.ok) {
    throw new Error(`NLM Open-i HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const list = Array.isArray(data?.list) ? data.list : [];
  return list.map((item, idx) => {
    const rawImgPath = item.imgLarge || item.imgThumb || "";
    if (!rawImgPath) return null;
    const fullImgUrl = rawImgPath.startsWith("http") ? rawImgPath : `https://openi.nlm.nih.gov${rawImgPath.startsWith("/") ? "" : "/"}${rawImgPath}`;
    const thumbImgUrl = item.imgThumb ? item.imgThumb.startsWith("http") ? item.imgThumb : `https://openi.nlm.nih.gov${item.imgThumb.startsWith("/") ? "" : "/"}${item.imgThumb}` : fullImgUrl;
    const rawCaption = item.image?.caption || item.title || item.abstract || `Exame biom\xE9dico NLM Open-i ${idx + 1}`;
    const cleanCaption = rawCaption.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
    const cleanUid = (item.uid || `openi_${idx + 1}`).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    return {
      id: `openi-${cleanUid}-${idx}`,
      title: (item.title || cleanCaption).replace(/<[^>]*>/g, "").slice(0, 85),
      thumbUrl: thumbImgUrl,
      fullUrl: fullImgUrl,
      description: cleanCaption,
      suggestedFilename: `openi_${cleanUid}.png`,
      defaultLegend: `Exame complementar (NLM Open-i) evidenciando ${cleanCaption.slice(0, 125)}.`,
      source: "NLM Open-i (NIH Biomedical Archive)"
    };
  }).filter((item) => item !== null);
}
async function validateCandidateImageUrl(url) {
  if (!url || !url.startsWith("https://") && !url.startsWith("http://")) {
    return { ok: false, contentType: "", byteLength: 0 };
  }
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "InternatoFirstCardArchitect/2.0 (https://aistudio.google.com; medical-education)",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      },
      signal: AbortSignal.timeout(2600)
    });
    if (!resp.ok) {
      return { ok: false, contentType: "", byteLength: 0 };
    }
    const contentType = (resp.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      return { ok: false, contentType, byteLength: 0 };
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    const minBytes = contentType.includes("svg") ? 250 : 1800;
    if (buf.length < minBytes) {
      return { ok: false, contentType, byteLength: buf.length };
    }
    return { ok: true, contentType, byteLength: buf.length };
  } catch {
    return { ok: false, contentType: "", byteLength: 0 };
  }
}
async function searchGoogleMedicalImagesViaGrounding(searchQuery, topic = "", question = "") {
  const ai = getAiClient();
  if (!ai) return [];
  const enQuery = buildEnglishMedicalSearchQuery(`${searchQuery} ${topic}`);
  const prompt = `Encontre de 4 a 6 URLs diretas de imagens m\xE9dicas cl\xEDnicas limpas (arquivos .jpg, .png, .webp ou .svg sem setas com spoiler da resposta e sem marca d'\xE1gua pesada) para o exame/achado cl\xEDnico:
- Busca: "${searchQuery}" (${enQuery})
- T\xF3pico: "${topic}"
- Contexto: "${question.slice(0, 180)}"

Priorize fontes m\xE9dicas confi\xE1veis de acesso aberto:
- Life in the Fast Lane (LITFL - litfl.com) para ECG e arritmias
- Radiopaedia / Open-i (openi.nlm.nih.gov) / Wikimedia Commons (upload.wikimedia.org) para RX, TC, RM, USG, Cardiotocografia
- DermNet NZ para dermatologia
- SciELO / PubMed Central para imagens cl\xEDnicas e obst\xE9tricas

Retorne EXCLUSIVAMENTE um array JSON v\xE1lido no formato:
[
  {
    "title": "T\xEDtulo conciso do achado visual",
    "imageUrl": "https://... (URL direta do arquivo de imagem .jpg/.png/.webp/.svg)",
    "description": "Descri\xE7\xE3o cl\xEDnica objetiva do exame sem entregar o diagn\xF3stico final",
    "source": "LITFL / Radiopaedia / Wikimedia / DermNet / SciELO",
    "suggestedFilename": "nome_limpo_exame.jpg",
    "defaultLegend": "Exame complementar evidenciando [descri\xE7\xE3o morfol\xF3gica do achado]."
  }
]`;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });
    const rawText = response.text || "[]";
    const cleaned = extractJsonBlock(rawText);
    const parsed = JSON.parse(cleaned);
    const candidates = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.images) ? parsed.images : [];
    const validationChecks = await Promise.all(
      candidates.slice(0, 8).map(async (item, idx) => {
        const rawUrl = String(item.imageUrl || item.url || item.thumbUrl || "").trim();
        const check = await validateCandidateImageUrl(rawUrl);
        if (!check.ok) return null;
        const title = String(item.title || `Imagem M\xE9dica Google #${idx + 1}`).slice(0, 85);
        const desc = String(
          item.description || `Exame complementar referente a ${searchQuery}.`
        ).slice(0, 180);
        const source = String(item.source || "Google Search Grounding (Medical Web)");
        const ext = check.contentType.includes("png") ? ".png" : check.contentType.includes("svg") ? ".svg" : check.contentType.includes("webp") ? ".webp" : ".jpg";
        const rawSuggested = String(item.suggestedFilename || title).toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
        return {
          id: `google-grounding-${idx}-${Date.now()}`,
          title,
          thumbUrl: rawUrl,
          fullUrl: rawUrl,
          description: desc,
          suggestedFilename: `${rawSuggested || `google_med_${idx + 1}`}${ext}`,
          defaultLegend: String(
            item.defaultLegend || `Exame complementar demonstrando ${desc.slice(0, 125)}.`
          ),
          source
        };
      })
    );
    return validationChecks.filter((item) => item !== null);
  } catch {
    return [];
  }
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
          "User-Agent": "InternatoFirstCardArchitect/2.0 (https://aistudio.google.com; medical-education)"
        },
        signal: AbortSignal.timeout(4e3)
      });
      if (!resp.ok) return null;
      const arrBuf = await resp.arrayBuffer();
      return Buffer.from(arrBuf);
    } catch {
      return null;
    }
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(sourceUrl) && sourceUrl.length > 64) {
    try {
      return Buffer.from(sourceUrl.replace(/\s+/g, ""), "base64");
    } catch {
      return null;
    }
  }
  return null;
}
async function resolveDeckMediaFiles(mediaManifest, mediaAssets = {}) {
  const normalizedAssetMap = /* @__PURE__ */ new Map();
  for (const [key, val] of Object.entries(mediaAssets || {})) {
    if (key && typeof val === "string" && val) {
      const cleanKey = key.trim().toLowerCase();
      normalizedAssetMap.set(cleanKey, val);
      const base = cleanKey.split(/[\\/]/).pop();
      if (base) normalizedAssetMap.set(base, val);
    }
  }
  const seenFilenames = /* @__PURE__ */ new Set();
  const resolvedMedia = [];
  const missingMedia = [];
  if (Array.isArray(mediaManifest)) {
    for (const item of mediaManifest) {
      const filename = String(item?.filename || item?.localFilename || "").trim();
      const sourceUrl = String(item?.sourceUrl || "").trim();
      if (!filename || seenFilenames.has(filename)) continue;
      seenFilenames.add(filename);
      const lowerName = filename.toLowerCase();
      const uploadedDataUri = normalizedAssetMap.get(lowerName) || normalizedAssetMap.get(sourceUrl.toLowerCase());
      let buf = null;
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
          reason: /^(?:https?:\/\/)/i.test(sourceUrl) ? `Falha ao baixar URL externa (${sourceUrl.slice(0, 80)})` : "Arquivo local n\xE3o encontrado nos assets carregados (04_M\xEDdias)"
        });
      }
    }
  }
  for (const [rawName, dataUri] of Object.entries(mediaAssets || {})) {
    const cleanName = rawName.trim().split(/[\\/]/).pop() || "";
    if (!cleanName || seenFilenames.has(cleanName)) continue;
    const buf = await resolveMediaSourceToBuffer(dataUri);
    if (buf && buf.length > 0) {
      seenFilenames.add(cleanName);
      resolvedMedia.push({ filename: cleanName, data: buf });
    }
  }
  return { resolvedMedia, missingMedia };
}
var CLOZE_MODEL_ID = 1738331521911;
var CLOZE_MODEL_NAME = "Med_Cloze_Inverted_v2";
var BASIC_MODEL_ID = 1738331521912;
var BASIC_MODEL_NAME = "Med_Basic_Inverted_v2";
var GUID_SALT = "criador-de-cards";
var ANKI_CLINICAL_CSS = `.card {
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
var BASE91_TABLE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";
function genankiGuidFor(deckId, deckKey, noteId) {
  const key = `${deckKey}:id:${noteId}`;
  const hashStr = `${GUID_SALT}__${deckId}__${key}`;
  const digest = import_crypto.default.createHash("sha256").update(hashStr, "utf8").digest();
  let hashInt = 0n;
  for (let i = 0; i < 8; i++) {
    hashInt = hashInt << 8n | BigInt(digest[i]);
  }
  const base = BigInt(BASE91_TABLE.length);
  let rv = "";
  while (hashInt > 0n) {
    rv = BASE91_TABLE[Number(hashInt % base)] + rv;
    hashInt = hashInt / base;
  }
  return rv || `id${noteId}`;
}
function ankiFieldChecksum(sfld) {
  const hex = import_crypto.default.createHash("sha1").update(sfld || "", "utf8").digest("hex").slice(0, 8);
  return parseInt(hex, 16) >>> 0;
}
function computeDeckIdFromKey(deckKey) {
  const digest = import_crypto.default.createHash("sha256").update(deckKey || "deck", "utf8").digest();
  const val = digest.readUInt32BE(0);
  return 173e10 + val % 9e8;
}
var sqlJsPromise = null;
function getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = (0, import_sql.default)();
  }
  return sqlJsPromise;
}
async function buildAnkiApkgBuffer(params) {
  const SQL = await getSqlJs();
  const db = new SQL.Database();
  const nowSec = Math.floor(Date.now() / 1e3);
  const cleanDeckKey = (params.deckKey || "internato_deck").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_") || "internato_deck";
  const deckId = typeof params.deckId === "number" && params.deckId > 1 ? params.deckId : computeDeckIdFromKey(cleanDeckKey);
  const deckName = (params.deckName || cleanDeckKey.replace(/_/g, " ")).trim();
  const updatedRegistry = { ...params.guidRegistry || {} };
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
  const fieldDefs = ["Question", "Topic", "Answer", "Hint"].map((name, ord) => ({
    name,
    ord,
    sticky: false,
    rtl: false,
    font: "Arial",
    size: 20,
    media: []
  }));
  const modelsObj = {
    [String(CLOZE_MODEL_ID)]: {
      id: CLOZE_MODEL_ID,
      name: CLOZE_MODEL_NAME,
      type: 1,
      // Cloze
      mod: nowSec,
      usn: -1,
      sortf: 0,
      did: deckId,
      tmpls: [
        {
          name: "Cloze",
          ord: 0,
          qfmt: '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="cloze-text">{{cloze:Question}}</div></div>',
          afmt: '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="cloze-text">{{cloze:Question}}</div>{{#Hint}}<hr id="answer" class="med-divider"><div class="extra-box">{{Hint}}</div>{{/Hint}}</div><script>(document.querySelector(".cloze") || document.getElementById("answer"))?.scrollIntoView({behavior: "smooth", block: "center"});</script>',
          bqfmt: "",
          bafmt: "",
          did: null,
          bfont: "",
          bsize: 0
        }
      ],
      flds: fieldDefs,
      css: ANKI_CLINICAL_CSS,
      latexPre: "",
      latexPost: "",
      latexsvg: false,
      req: [[0, "all", [0]]],
      tags: [],
      vers: []
    },
    [String(BASIC_MODEL_ID)]: {
      id: BASIC_MODEL_ID,
      name: BASIC_MODEL_NAME,
      type: 0,
      // Standard Basic
      mod: nowSec,
      usn: -1,
      sortf: 0,
      did: deckId,
      tmpls: [
        {
          name: "Basic",
          ord: 0,
          qfmt: '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="front-content">{{Question}}</div></div>',
          afmt: '<div class="med-card"><div class="topic-box">{{Topic}}</div><div class="front-content">{{Question}}</div><hr id="answer" class="med-divider"><div class="back-content"><div class="main-answer"><b>{{Answer}}</b></div>{{#Hint}}<div class="extra-box">{{Hint}}</div>{{/Hint}}</div></div><script>document.getElementById("answer")?.scrollIntoView({behavior: "smooth", block: "nearest"});</script>',
          bqfmt: "",
          bafmt: "",
          did: null,
          bfont: "",
          bsize: 0
        }
      ],
      flds: fieldDefs,
      css: ANKI_CLINICAL_CSS,
      latexPre: "",
      latexPost: "",
      latexsvg: false,
      req: [[0, "all", [0]]],
      tags: [],
      vers: []
    }
  };
  const decksObj = {
    "1": {
      id: 1,
      mod: nowSec,
      name: "Default",
      usn: -1,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: false,
      browserCollapsed: false,
      desc: "",
      dyn: 0,
      conf: 1,
      extendNew: 10,
      extendRev: 50
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
      desc: `Baralho Can\xF4nico Internato-First (${cleanDeckKey})`,
      dyn: 0,
      conf: 1,
      extendNew: 10,
      extendRev: 50
    }
  };
  const confObj = {
    nextPos: 1,
    estTimes: true,
    activeDecks: [deckId],
    sortType: "noteFld",
    timeLim: 0,
    sortBackwards: false,
    addToCur: true,
    curDeck: deckId,
    newBury: true,
    newSpread: 0,
    dueCounts: true,
    curModel: String(BASIC_MODEL_ID),
    collapseTime: 1200
  };
  const dconfObj = {
    "1": {
      id: 1,
      mod: 0,
      name: "Default",
      usn: 0,
      maxTaken: 60,
      autoplay: true,
      timer: 0,
      replayq: true,
      new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20 },
      rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 },
      lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
      dyn: false
    }
  };
  db.run(
    `INSERT INTO col VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      1,
      nowSec,
      nowSec * 1e3,
      nowSec * 1e3,
      11,
      0,
      0,
      0,
      JSON.stringify(confObj),
      JSON.stringify(modelsObj),
      JSON.stringify(decksObj),
      JSON.stringify(dconfObj),
      "{}"
    ]
  );
  const insertNoteStmt = db.prepare(
    `INSERT OR REPLACE INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertCardStmt = db.prepare(
    `INSERT OR REPLACE INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const usedCardIds = /* @__PURE__ */ new Set();
  params.notes.forEach((note, index) => {
    const nid = Number(note.id) > 0 ? Number(note.id) : 171000101 + index;
    const regKey = `${cleanDeckKey}:id:${nid}`;
    const guid = updatedRegistry[regKey] || genankiGuidFor(deckId, cleanDeckKey, nid);
    updatedRegistry[regKey] = guid;
    const isCloze = note.type === "cloze";
    const mid = isCloze ? CLOZE_MODEL_ID : BASIC_MODEL_ID;
    const qField = String(note.question || "");
    const tField = String(note.topic || "");
    const aField = isCloze ? "" : String(note.answer || "");
    const hField = String(note.hint || "");
    const flds = [qField, tField, aField, hField].join("");
    const sfld = qField.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const csum = ankiFieldChecksum(sfld);
    const noteTags = Array.from(
      /* @__PURE__ */ new Set([
        cleanDeckKey,
        ...Array.isArray(note.tags) ? note.tags.map((t) => String(t).trim()).filter((t) => t && !/\s/.test(t)) : []
      ])
    );
    const tagsStr = ` ${noteTags.join(" ")} `;
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
      ""
    ]);
    let cid = nid < 1e11 ? nid * 10 + 1 : nid + index + 1;
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
      ""
    ]);
  });
  insertNoteStmt.free();
  insertCardStmt.free();
  const sqliteBytes = Buffer.from(db.export());
  db.close();
  const zipEntries = [
    { name: "collection.anki21", data: sqliteBytes },
    { name: "collection.anki2", data: sqliteBytes }
  ];
  const mediaJsonMap = {};
  params.resolvedMedia.forEach((mediaItem, idx) => {
    const numKey = String(idx);
    mediaJsonMap[numKey] = mediaItem.filename;
    zipEntries.push({
      name: numKey,
      data: mediaItem.data
    });
  });
  zipEntries.push({
    name: "media",
    data: Buffer.from(JSON.stringify(mediaJsonMap), "utf8")
  });
  return {
    apkgBuffer: buildZipArchive(zipEntries),
    updatedRegistry
  };
}
async function startServer() {
  const app = (0, import_express.default)();
  app.use(import_express.default.json({ limit: "50mb" }));
  app.post("/api/media/search-medical-images", async (req, res) => {
    try {
      const { query = "", topic = "", question = "", preferGoogleGrounding = true } = req.body || {};
      const rawSearch = (query || topic || question || "clinical diagnosis").trim();
      const [googleSettled, wikiSettled, openiSettled] = await Promise.allSettled([
        preferGoogleGrounding ? searchGoogleMedicalImagesViaGrounding(rawSearch, topic, question) : Promise.resolve([]),
        searchWikimediaCommonsMedical(rawSearch),
        searchNlmOpenIMedical(rawSearch)
      ]);
      const googleImages = googleSettled.status === "fulfilled" ? googleSettled.value : [];
      const wikiRaw = wikiSettled.status === "fulfilled" ? wikiSettled.value : [];
      const openiRaw = openiSettled.status === "fulfilled" ? openiSettled.value : [];
      const [wikiValidated, openiValidated] = await Promise.all([
        Promise.all(
          wikiRaw.slice(0, 6).map(async (img) => {
            const check = await validateCandidateImageUrl(img.thumbUrl || img.fullUrl);
            return check.ok ? img : null;
          })
        ),
        Promise.all(
          openiRaw.slice(0, 6).map(async (img) => {
            const check = await validateCandidateImageUrl(img.thumbUrl || img.fullUrl);
            return check.ok ? img : null;
          })
        )
      ]);
      const wikiImages = wikiValidated.filter((x) => x !== null);
      const openiImages = openiValidated.filter((x) => x !== null);
      const combined = [];
      const seenUrls = /* @__PURE__ */ new Set();
      const maxLen = Math.max(googleImages.length, wikiImages.length, openiImages.length);
      for (let i = 0; i < maxLen; i++) {
        for (const candidate of [googleImages[i], wikiImages[i], openiImages[i]]) {
          if (candidate && !seenUrls.has(candidate.thumbUrl)) {
            seenUrls.add(candidate.thumbUrl);
            combined.push(candidate);
          }
        }
      }
      return res.json({
        query: rawSearch,
        images: combined.slice(0, 12)
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
          "User-Agent": "InternatoFirstCardArchitect/2.0 (https://aistudio.google.com; medical-education)"
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
        mediaManifest = [],
        mediaAssets = {},
        guidRegistry = {}
      } = req.body || {};
      const cleanDeckKey = String(deckKey || "internato_deck").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
      const { resolvedMedia, missingMedia } = await resolveDeckMediaFiles(
        mediaManifest,
        mediaAssets
      );
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
      for (const mediaItem of resolvedMedia) {
        zipEntries.push({
          name: `collection.media/${mediaItem.filename}`,
          data: mediaItem.data
        });
        zipEntries.push({
          name: `04_M\xEDdias/${cleanDeckKey}/${mediaItem.filename}`,
          data: mediaItem.data
        });
      }
      if (guidRegistry && typeof guidRegistry === "object") {
        zipEntries.push({
          name: "data/registry/note_guid_registry.json",
          data: Buffer.from(
            JSON.stringify({ version: 1, entries: guidRegistry }, null, 2),
            "utf8"
          )
        });
      }
      const mediaReport = {
        deckKey: cleanDeckKey,
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        resolvedCount: resolvedMedia.length,
        missingCount: missingMedia.length,
        resolvedFiles: resolvedMedia.map((m) => m.filename),
        missingMedia
      };
      zipEntries.push({
        name: "RELATORIO_MIDIAS.json",
        data: Buffer.from(JSON.stringify(mediaReport, null, 2), "utf8")
      });
      const readmeText = [
        `PACOTE OFFLINE ANKI \u2014 ${cleanDeckKey.toUpperCase()}`,
        "==========================================================",
        `1. Arquivo de Notas JSON (com <img src="nome_arquivo_local"> sem links externos):`,
        `   - ${cleanDeckKey}_notes.json`,
        `   - 01_Notas/${cleanDeckKey}_notes.json`,
        "",
        `2. Auditoria de M\xEDdias (${resolvedMedia.length} resolvida(s) / ${missingMedia.length} faltante(s)):`,
        "   - Pasta collection.media/ : copie os arquivos diretamente para a pasta collection.media do seu Anki.",
        `   - Pasta 04_M\xEDdias/${cleanDeckKey}/ : pronta para o gerador desktop (uv run cards).`,
        ...missingMedia.length > 0 ? [
          "",
          "\u26A0\uFE0F ATEN\xC7\xC3O \u2014 M\xCDDIAS AUSENTES N\xC3O INCLU\xCDDAS NO PACOTE:",
          ...missingMedia.map(
            (m) => `   - ${m.filename} (Card ID: ${m.cardId ?? "?"}) -> ${m.reason}`
          )
        ] : ["   - Todas as m\xEDdias referenciadas foram embutidas com sucesso!"],
        ""
      ].join("\n");
      zipEntries.push({
        name: "LEIA-ME_ANKI_OFFLINE.txt",
        data: Buffer.from(readmeText, "utf8")
      });
      const zipBuffer = buildZipArchive(zipEntries);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("X-Resolved-Media-Count", String(resolvedMedia.length));
      res.setHeader("X-Missing-Media-Count", String(missingMedia.length));
      res.setHeader(
        "X-Missing-Media",
        encodeURIComponent(JSON.stringify(missingMedia.map((m) => m.filename)))
      );
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
  app.post("/api/export/apkg", async (req, res) => {
    try {
      const {
        deckKey = "internato_deck",
        deckName = "",
        deckId,
        notes = [],
        mediaManifest = [],
        mediaAssets = {},
        guidRegistry = {}
      } = req.body || {};
      const cleanDeckKey = String(deckKey || "internato_deck").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
      const { resolvedMedia, missingMedia } = await resolveDeckMediaFiles(
        mediaManifest,
        mediaAssets
      );
      const { apkgBuffer, updatedRegistry } = await buildAnkiApkgBuffer({
        deckKey: cleanDeckKey,
        deckName: deckName || cleanDeckKey.replace(/_/g, " "),
        deckId: typeof deckId === "number" ? deckId : void 0,
        notes: Array.isArray(notes) ? notes : [],
        resolvedMedia,
        guidRegistry: guidRegistry && typeof guidRegistry === "object" ? guidRegistry : {}
      });
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("X-Resolved-Media-Count", String(resolvedMedia.length));
      res.setHeader("X-Missing-Media-Count", String(missingMedia.length));
      res.setHeader(
        "X-Missing-Media",
        encodeURIComponent(JSON.stringify(missingMedia.map((m) => m.filename)))
      );
      res.setHeader(
        "X-Updated-Guid-Count",
        String(Object.keys(updatedRegistry).length)
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${cleanDeckKey}.apkg"`
      );
      return res.send(apkgBuffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao gerar arquivo .apkg";
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
        if (pdf?.textContent && typeof pdf.textContent === "string") {
          parts.push({
            text: `DOCUMENTO ANEXADO (${pdf.name || "Texto/Quest\xF5es"}):
${pdf.textContent.slice(0, 6e4)}`
          });
        } else if (pdf?.base64Data) {
          parts.push({
            inlineData: {
              mimeType: pdf.mimeType || "application/pdf",
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
        if (pdf?.textContent && typeof pdf.textContent === "string") {
          parts.push({
            text: `DOCUMENTO ANEXADO (${pdf.name || "Texto/Quest\xF5es"}):
${pdf.textContent.slice(0, 6e4)}`
          });
        } else if (pdf?.base64Data) {
          parts.push({
            inlineData: {
              mimeType: pdf.mimeType || "application/pdf",
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
- Resumo Compacto dos Cards Originais (voc\xEA DEVE: 1) EXCLUIR os IDs de cards duplicados/redundantes/fracos; 2) REFAZER os sobreviventes mantendo o n\xFAmero "id" original daquele conceito; 3) CONVERTER basic <-> cloze para atingir estritamente 45% a 55% basic / 45% a 55% cloze; 4) CRIAR novos cards com IDs >= ${maxExistingId + 1} para cobrir conceitos P1-P4 ausentes):
${rawCardsSummary}

MAPA CL\xCDNICO APROVADO (P1 a P4):
${checkedMapItems.length > 0 ? JSON.stringify(checkedMapItems, null, 2) : "Mapear integralmente P1, P2, P3 e P4 do tema."}

CHECKLIST DE VALIDA\xC7\xC3O ANTES DE GERAR CADA CARD:
1. QUANTIDADE ADEQUADA AO TEMA + PROPOR\xC7\xC3O 45% A 55%: N\xE3o devolva o mesmo n\xFAmero de cards por in\xE9rcia. Pode excluir IDs redundantes ou criar novos IDs sequenciais. O baralho final DEVE ter estritamente entre 45% e 55% "basic" e entre 45% e 55% "cloze".
2. Se "basic":
   - "question": no m\xE1ximo 45 a 50 palavras, seguindo a Matriz de Tripla Ancoragem ([CEN\xC1RIO + IDADE/IG] + [CL\xCDNICA + SINAIS VITAIS] + [COMANDO TEMPORAL FECHADO: minuto zero / exame inicial vs padr\xE3o-ouro / 1\xAA escolha / 2\xAA linha ap\xF3s falha]). PROIBIDO "Qual a conduta?".
   - "answer": 1 a 12 palavras (M\xC1XIMO ESTRITO 15 palavras e <= 110 caracteres), terminado em ponto final (.), SEM ponto-e-v\xEDrgula (;) e SEM tag <b> externo envolvendo toda a resposta.
3. Se "cloze":
   - "question": cont\xE9m ESTRITAMENTE UMA lacuna {{c1::...}} com 1 a 5 palavras dentro da lacuna, unidades de medida FORA da lacuna, SEM preposi\xE7\xE3o pendurada no final, SEM "::dica".
   - "answer": "" (string vazia).
4. Zero M\xEDdias \xD3rf\xE3s: NUNCA invente nomes de arquivos locais inexistentes em <img src="..."> ou <audio>.
5. Duplo Salto Cognitivo Impl\xEDcito: NUNCA fa\xE7a pergunta composta ("Qual o diagn\xF3stico e a conduta?"). Apresente o caso cl\xEDnico e pergunte apenas 1 decis\xE3o at\xF4mica.
6. "topic": formato "Tema - Subtema", ZERO spoiler por palavra ou radical (ex.: proibido "Manobras" no topic se a resposta come\xE7a com "Manobra de...") e NUNCA repita o topic em negrito dentro do question.
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
Mantenha rigorosamente o mesmo "id" num\xE9rico e qualquer tag de m\xEDdia v\xE1lida de cada card. N\xC3O inclua o campo "sources".

REGRAS DE CORRE\xC7\xC3O CIR\xDARGICA:
- Se "type": "basic" -> "question" com <= 50 palavras e Tripla Ancoragem (comando temporal fechado: minuto zero, exame inicial vs padr\xE3o-ouro, 1\xAA escolha ou 2\xAA linha ap\xF3s falha); "answer" DEVE ter entre 1 e 12 palavras (m\xE1x 15 palavras / 110 chars), terminar com ".", N\xC3O conter ";" e N\xC3O ter <b> envolvendo tudo.
- Se "type": "cloze" -> "question" DEVE ter estritamente 1 lacuna {{c1::...}} com 1 a 5 palavras, unidades fora da lacuna, sem preposi\xE7\xE3o pendurada no final, SEM "::dica", e "answer" DEVE ser "".
- Se pergunta composta -> transforme em pergunta at\xF4mica com Duplo Salto Cognitivo Impl\xEDcito (apenas 1 ponto de interroga\xE7\xE3o).
- Se spoiler por radical ou palavra no "topic" ou entre par\xEAnteses na "question" -> remova imediatamente a palavra/radical da resposta (ex.: "Manobras" quando a resposta \xE9 "Manobra de...") mantendo formato "Tema - Subtema".
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
