// server.ts
import "dotenv/config";
import express3 from "express";
import path2 from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

// server/routes/gemini.ts
import fs2 from "fs";
import express from "express";

// server/localMediaIndex.ts
import fs from "fs";
import path from "path";
var DEFAULT_LOCAL_MEDIA_ROOT = "/home/wagmoraes/Projetos IA/Criador de Cards/04_M\xEDdias";
var IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;
var CACHE_TTL_MS = 6e4;
var cachedRoot = "";
var cachedAt = 0;
var cachedEntries = [];
function getLocalMediaRoot() {
  const configured = (process.env.LOCAL_MEDIA_ROOT || "").trim();
  const candidate = configured || DEFAULT_LOCAL_MEDIA_ROOT;
  try {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return path.resolve(candidate);
    }
  } catch {
  }
  return null;
}
function tokenizeText(raw) {
  return raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((t) => t.length >= 3);
}
function loadManifestCaptions(dirPath) {
  const map = /* @__PURE__ */ new Map();
  try {
    const entries = fs.readdirSync(dirPath);
    for (const file of entries) {
      if (!file.endsWith("_extraction_manifest.json")) continue;
      const raw = fs.readFileSync(path.join(dirPath, file), "utf8");
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.images) ? parsed.images : Array.isArray(parsed?.figures) ? parsed.figures : [];
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const fname = String(it.filename || it.file || it.name || "").trim();
        const cap = String(it.caption || it.captionHint || it.description || it.context || "").trim();
        if (fname && cap) {
          map.set(fname.toLowerCase(), cap.slice(0, 220));
        }
      }
    }
  } catch {
  }
  return map;
}
function getLocalMediaIndex(forceRefresh = false) {
  const root = getLocalMediaRoot();
  if (!root) return [];
  const now = Date.now();
  if (!forceRefresh && cachedRoot === root && now - cachedAt < CACHE_TTL_MS && cachedEntries.length > 0) {
    return cachedEntries;
  }
  const entries = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let items = [];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const manifestCaptions = loadManifestCaptions(dir);
    const relDir = path.relative(root, dir);
    const deckFolder = relDir ? relDir.split(path.sep)[0] : "";
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        walk(full, depth + 1);
      } else if (item.isFile() && IMAGE_EXT_RE.test(item.name)) {
        const relPath = path.relative(root, full).split(path.sep).join("/");
        const captionHint = manifestCaptions.get(item.name.toLowerCase()) || "";
        const cleanName = item.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
        const searchTokens = Array.from(
          new Set(tokenizeText(`${deckFolder} ${cleanName} ${captionHint}`))
        );
        entries.push({
          relPath,
          absPath: full,
          filename: item.name,
          deckFolder,
          searchTokens,
          captionHint: captionHint || cleanName
        });
      }
    }
  };
  walk(root, 0);
  cachedRoot = root;
  cachedAt = now;
  cachedEntries = entries;
  return entries;
}
function resolveSafeLocalMediaPath(relPath) {
  const root = getLocalMediaRoot();
  if (!root || !relPath) return null;
  const cleanRel = String(relPath).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleanRel || cleanRel.includes("..")) return null;
  const resolved = path.resolve(root, cleanRel);
  if (!resolved.startsWith(root + path.sep)) return null;
  try {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return resolved;
    }
  } catch {
    return null;
  }
  return null;
}
function searchLocalMediaArchive(params) {
  const index = getLocalMediaIndex();
  if (index.length === 0) return [];
  const queryTokens = new Set(
    tokenizeText(`${params.query} ${params.topic || ""} ${params.answer || ""} ${params.question || ""}`)
  );
  if (queryTokens.size === 0) return [];
  const cleanDeck = (params.deckKey || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_]+/g, "_");
  const scored = [];
  for (const entry of index) {
    let overlap = 0;
    for (const tok of entry.searchTokens) {
      if (queryTokens.has(tok)) overlap++;
    }
    if (overlap === 0) continue;
    let score = overlap * 10;
    if (cleanDeck && entry.deckFolder.toLowerCase().includes(cleanDeck)) {
      score += 18;
    }
    if (overlap >= 2) score += 8;
    scored.push({ entry, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, params.limit || 6);
}

// server/routes/gemini.ts
import { ThinkingLevel as ThinkingLevel2, Type } from "@google/genai";

// src/utils/domainProfiles.ts
var DOMAIN_PROFILE_CONFIGS = {
  emergencia: {
    id: "emergencia",
    label: "Urg\xEAncia & Emerg\xEAncia",
    shortLabel: "Emerg\xEAncia",
    description: "Sala Vermelha, minuto zero, estabiliza\xE7\xE3o hemodin\xE2mica, drogas de emerg\xEAncia, p\xF3s-estabiliza\xE7\xE3o e fisiopatologia aplicada.",
    priorityLabels: {
      P1: "P1 \xB7 Sala Vermelha / Minuto Zero",
      P2: "P2 \xB7 Diagn\xF3stico & Reconhecimento",
      P3: "P3 \xB7 P\xF3s-Estabiliza\xE7\xE3o & Alta/UTI",
      P4: "P4 \xB7 Fisiopatologia & Diferenciais"
    },
    priorityPrompts: {
      P1: "Sala Vermelha / Minuto Zero: sinais de alarme (red flags), crit\xE9rios de instabilidade, estabiliza\xE7\xE3o imediata, manobras salvadoras, 1\xAA droga (dose/via), conduta na refratariedade (2\xAA linha), ant\xEDdotos e contraindica\xE7\xF5es fatais.",
      P2: 'Decis\xE3o Diagn\xF3stica & Reconhecimento Visual: exame inicial \xE0 beira-leito vs. padr\xE3o-ouro confirmat\xF3rio, interpreta\xE7\xE3o de exames reais em image_mode: "recognition" (ECG, RX, TC, USG, CTG) e escores/cortes de gravidade.',
      P3: "P\xF3s-Estabiliza\xE7\xE3o, Enfermaria & Preven\xE7\xE3o Secund\xE1ria: transi\xE7\xE3o de via, terapias de manuten\xE7\xE3o p\xF3s-alta, profilaxias, popula\xE7\xF5es especiais e crit\xE9rios de interna\xE7\xE3o em UTI ou alta segura.",
      P4: "Fisiopatologia Aplicada & Diferenciais: mecanismos causais que explicam sinais cl\xEDnicos/condutas agudas e armadilhas cl\xE1ssicas das bancas."
    },
    scenarioGuidance: "[CEN\xC1RIO (Sala Vermelha / Pronto-Socorro / UTI / Centro Obst\xE9trico) + PERFIL (idade, sexo, comorbidades ou IG se aplic\xE1vel)] + [CL\xCDNICA + SINAIS VITAIS] + [COMANDO TEMPORAL INEQU\xCDVOCO].",
    closedCommands: [
      "Qual \xE9 a conduta imediata de minuto zero \xE0 beira do leito antes de exames complementares?",
      "Qual \xE9 o primeiro exame a ser solicitado na sala de emerg\xEAncia (ou o exame padr\xE3o-ouro confirmat\xF3rio)?",
      "Qual \xE9 a prescri\xE7\xE3o farmacol\xF3gica imediata de primeira escolha (f\xE1rmaco, dose e via)?",
      "Ap\xF3s falha da primeira linha ou estabiliza\xE7\xE3o inicial, qual \xE9 o pr\xF3ximo passo terap\xEAutico indicado?"
    ]
  },
  ambulatorio: {
    id: "ambulatorio",
    label: "Ambulat\xF3rio, Cr\xF4nicos & H\xEDbridos",
    shortLabel: "Ambulat\xF3rio",
    description: "UBS/ambulat\xF3rio, rastreio, diagn\xF3stico, metas terap\xEAuticas, popula\xE7\xF5es especiais e eventuais descompensa\xE7\xF5es agudas.",
    priorityLabels: {
      P1: "P1 \xB7 Seguran\xE7a, Red Flags & Descompensa\xE7\xF5es",
      P2: "P2 \xB7 Diagn\xF3stico, Rastreio & Estratifica\xE7\xE3o",
      P3: "P3 \xB7 1\xAA Linha, Metas & Popula\xE7\xF5es Especiais",
      P4: "P4 \xB7 Fisiopatologia & Diferenciais"
    },
    priorityPrompts: {
      P1: "Seguran\xE7a do Paciente, Contraindica\xE7\xF5es Absolutas & Descompensa\xE7\xF5es: erros iatrog\xEAnicos graves (ex.: f\xE1rmacos proscritos, categoria 4, teratog\xEAnicos), sinais de alarme para encaminhamento/interna\xE7\xE3o e manejo de descompensa\xE7\xF5es agudas do tema quando presentes no material (ex.: crise hipertensiva, CAD/EHH, crise asm\xE1tica, pr\xE9-ecl\xE2mpsia grave).",
      P2: 'Diagn\xF3stico, Rastreamento & Estratifica\xE7\xE3o: crit\xE9rios diagn\xF3sticos exatos, exames iniciais vs. confirmat\xF3rios, fluxogramas de rastreio/seguimento, interpreta\xE7\xE3o visual de exames (image_mode: "recognition") e pontos de corte num\xE9ricos.',
      P3: "Manejo de 1\xAA Linha, Metas & Popula\xE7\xF5es Especiais: terapia inicial, escalonamento/2\xAA linha, metas cl\xEDnicas/laboratoriais, preven\xE7\xE3o/profilaxias e ajustes em popula\xE7\xF5es especiais (crian\xE7as/peso, idosos, gestantes, nefropatas, hepatopatas, al\xE9rgicos).",
      P4: "Fisiopatologia Aplicada & Diferenciais: mecanismos que explicam sinais, efeitos adversos ou escolhas terap\xEAuticas e diagn\xF3sticos diferenciais g\xEAmeos."
    },
    scenarioGuidance: "[CEN\xC1RIO (UBS / Ambulat\xF3rio / Enfermaria / Pronto-Atendimento se descompensado) + PERFIL DO PACIENTE (idade, sexo, comorbidades, peso ou IG apenas se aplic\xE1vel)] + [DADOS CL\xCDNICOS/EXAMES] + [COMANDO INEQU\xCDVOCO].",
    closedCommands: [
      "Qual \xE9 a contraindica\xE7\xE3o absoluta (ou sinal de alarme que indica interna\xE7\xE3o imediata) neste cen\xE1rio?",
      "Qual \xE9 o exame confirmat\xF3rio padr\xE3o-ouro (ou crit\xE9rio diagn\xF3stico) indicado para este caso?",
      "Qual \xE9 a terapia de primeira linha (ou ajuste em popula\xE7\xE3o especial) indicada para controle e seguimento?",
      "Ap\xF3s falha ou intoler\xE2ncia ao esquema inicial, qual \xE9 a conduta de segunda linha recomendada?"
    ]
  },
  cirurgico: {
    id: "cirurgico",
    label: "Cir\xFArgico & Trauma",
    shortLabel: "Cir\xFArgico",
    description: "Indica\xE7\xE3o cir\xFArgica vs. conservadora, ATLS, proped\xEAutica armada, estadiamento, pr\xE9/p\xF3s-operat\xF3rio e complica\xE7\xF5es.",
    priorityLabels: {
      P1: "P1 \xB7 Indica\xE7\xE3o Cir\xFArgica & Trauma",
      P2: "P2 \xB7 Proped\xEAutica Armada & Estadiamento",
      P3: "P3 \xB7 Pr\xE9/P\xF3s-Op, T\xE9cnica & Complica\xE7\xF5es",
      P4: "P4 \xB7 Anatomia Cir\xFArgica & Diferenciais"
    },
    priorityPrompts: {
      P1: "Indica\xE7\xE3o Cir\xFArgica Imediata vs. Manejo Conservador & Sala de Trauma: crit\xE9rios de laparotomia/toracotomia/drenagem imediata, sequ\xEAncia ABCDE/ATLS, choque hemorr\xE1gico, abdome agudo perfurativo/isqu\xEAmico e medidas salvadoras no minuto zero.",
      P2: 'Proped\xEAutica Armada & Estadiamento: indica\xE7\xE3o de e-FAST, TC, USG ou RX (incluindo image_mode: "recognition"), classifica\xE7\xF5es e escores cir\xFArgicos (Hinchey, T\xF3quio, AAST, Alvarado, risco cir\xFArgico).',
      P3: "Pr\xE9-Operat\xF3rio, T\xE9cnica Essencial, P\xF3s-Operat\xF3rio & Complica\xE7\xF5es: jejum/preparo, antibioticoprofilaxia e profilaxia de TEV, via de acesso/princ\xEDpio cir\xFArgico e manejo de complica\xE7\xF5es (f\xEDstulas, deisc\xEAncia, infec\xE7\xE3o de s\xEDtio, \xEDleo).",
      P4: "Anatomia Cir\xFArgica Aplicada, Fisiopatologia & Diferenciais: rela\xE7\xF5es anat\xF4micas que evitam les\xE3o iatrog\xEAnica, mecanismos fisiopatol\xF3gicos e diferenciais cir\xFArgicos."
    },
    scenarioGuidance: "[CEN\xC1RIO (Sala de Trauma / Pronto-Socorro Cir\xFArgico / Enfermaria P\xF3s-Op / Ambulat\xF3rio Cir\xFArgico) + PERFIL DO PACIENTE] + [EXAME F\xCDSICO / SINAIS VITAIS / IMAGEM] + [COMANDO CIR\xDARGICO INEQU\xCDVOCO].",
    closedCommands: [
      "Qual \xE9 a indica\xE7\xE3o cir\xFArgica imediata (ou medida invasiva priorit\xE1ria) diante destes achados?",
      "Qual \xE9 o exame de imagem inicial (ou padr\xE3o-ouro para estadiamento) indicado ap\xF3s a estabiliza\xE7\xE3o?",
      "Qual \xE9 a conduta padronizada no pr\xE9-operat\xF3rio (ou no manejo da complica\xE7\xE3o p\xF3s-operat\xF3ria apresentada)?",
      "Qual \xE9 o crit\xE9rio que contraindica o manejo conservador e imp\xF5e abordagem cir\xFArgica?"
    ]
  },
  preventiva_normativo: {
    id: "preventiva_normativo",
    label: "Preventiva, \xC9tica, SUS & Conceitual",
    shortLabel: "Preventiva / \xC9tica",
    description: "\xC9tica m\xE9dica, documenta\xE7\xE3o (DO/CAT), SUS/PNAB, epidemiologia, bioestat\xEDstica, vigil\xE2ncia e calend\xE1rio vacinal.",
    priorityLabels: {
      P1: "P1 \xB7 Deveres Legais, \xC9tica & Notifica\xE7\xE3o",
      P2: "P2 \xB7 Crit\xE9rios, F\xF3rmulas & Epidemiologia",
      P3: "P3 \xB7 Regras Pr\xE1ticas, Fluxos & Exce\xE7\xF5es",
      P4: "P4 \xB7 Fundamentos & Armadilhas de Banca"
    },
    priorityPrompts: {
      P1: "Deveres \xC9tico-Legais Inegoci\xE1veis, Documenta\xE7\xE3o & Notifica\xE7\xE3o Urgente: quem preenche Declara\xE7\xE3o de \xD3bito (DO) vs. SVO vs. IML, emiss\xE3o de CAT, hip\xF3teses taxativas de quebra de sigilo, notifica\xE7\xE3o compuls\xF3ria imediata (\u2264 24h) e proibi\xE7\xF5es \xE9ticas graves.",
      P2: "Crit\xE9rios, F\xF3rmulas, Desenhos de Estudo & M\xE9tricas: sensibilidade, especificidade, VPP/VPN, raz\xE3o de verossimilhan\xE7a, RR vs. OR vs. NNT, desenhos epidemiol\xF3gicos e seus vieses principais, n\xEDveis de preven\xE7\xE3o e testes estat\xEDsticos.",
      P3: "Regras Pr\xE1ticas, Fluxos do SUS, Prazos & Exce\xE7\xF5es: princ\xEDpios e diretrizes do SUS/PNAB, calend\xE1rio vacinal e bloqueios p\xF3s-exposi\xE7\xE3o, rastreamentos populacionais, prazos legais e exce\xE7\xF5es cl\xE1ssicas.",
      P4: "Fundamentos Conceituais, Interpreta\xE7\xE3o Cr\xEDtica & Armadilhas de Banca: interpreta\xE7\xE3o correta de p-valor/intervalo de confian\xE7a, confus\xE3o vs. modifica\xE7\xE3o de efeito e pegadinhas conceituais das bancas."
    },
    scenarioGuidance: "[CEN\xC1RIO INSTITUCIONAL OU EPIDEMIOL\xD3GICO (UBS / Plant\xE3o / IML / Estudo / Gest\xE3o SUS)] + [FATOS OBJETIVOS OU DADOS NUM\xC9RICOS] + [COMANDO NORMATIVO OU ANAL\xCDTICO INEQU\xCDVOCO].",
    closedCommands: [
      "A qual m\xE9dico ou \xF3rg\xE3o compete legalmente a emiss\xE3o do documento (ou a notifica\xE7\xE3o imediata) neste caso?",
      "Qual \xE9 a medida epidemiol\xF3gica (ou desenho de estudo / teste diagn\xF3stico) mais adequada para esta situa\xE7\xE3o?",
      "Qual \xE9 a conduta \xE9tica/normativa correta (ou exce\xE7\xE3o legal aplic\xE1vel) segundo o CFM / Minist\xE9rio da Sa\xFAde?",
      "Por que o par\xE2metro ou vi\xE9s citado altera a validade (ou interpreta\xE7\xE3o) dos resultados apresentados?"
    ]
  }
};
function inferDomainProfile(deckKey, textHint = "") {
  const combined = `${deckKey} ${textHint}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[_-]+/g, " ");
  if (/\b(etica|bioetica|declaracao de obito|sigilo|prontuario|cfm|cat|sus|pnab|saude coletiva|preventiva|epidemiolog[a-z]*|bioestatistica|sensibilidade|especificidade|coorte|caso controle|ensaio clinico|vigilancia|notificacao compulsoria|calendario vacinal|imunizac[a-z]*|saude do trabalhador|financiamento sus|atencao primaria)\b/.test(
    combined
  )) {
    return "preventiva_normativo";
  }
  if (/\b(cirurg[a-z]*|abdome agudo|apendicite|colecistite|diverticulite|pancreatite|hernia|trauma|atls|pneumotorax|hemotorax|obstrucao intestinal|queimadura|vias biliares|pos operatorio|laparotom[a-z]*|urologia|ortopedia|fratura|traumatologia)\b/.test(
    combined
  )) {
    return "cirurgico";
  }
  if (/\b(emergencia|emergencias|urgencia|urgencias|sala vermelha|sala de parto|assistencia ao parto|parto|distocia|prolapso de cordao|descolamento prematuro|placenta previa|rotura uterina|pre eclampsia|sindrome hellp|sofrimento fetal|reanimacao neonatal|pcr|acls|pals|arritmia|arritmias|coronariana|coronarianas|sca|iam|choque|sepse|anafilaxia|avc|intoxicacao|cetoacidose|hemorragia pos parto|hpp|eclampsia|crise hipertensiva|parada cardiorrespiratoria)\b/.test(
    combined
  )) {
    return "emergencia";
  }
  return "ambulatorio";
}
function formatProfilePromptBlock(profile) {
  const cfg = DOMAIN_PROFILE_CONFIGS[profile];
  return `PERFIL DE DOM\xCDNIO ATIVO: ${cfg.label.toUpperCase()} (${cfg.id})
Estrutura de Prioriza\xE7\xE3o P1 \u2192 P4 espec\xEDfica para este perfil:
- P1 (${cfg.priorityLabels.P1}): ${cfg.priorityPrompts.P1}
- P2 (${cfg.priorityLabels.P2}): ${cfg.priorityPrompts.P2}
- P3 (${cfg.priorityLabels.P3}): ${cfg.priorityPrompts.P3}
- P4 (${cfg.priorityLabels.P4}): ${cfg.priorityPrompts.P4}

Molde de Salience Prompt para este perfil:
- ${cfg.scenarioGuidance}
- Comandos fechados recomendados (use ou adapte com a mesma precis\xE3o temporal/decis\xF3ria; proibido perguntar apenas "Qual a conduta?"):
${cfg.closedCommands.map((c) => `  * "${c}"`).join("\n")}`;
}

// src/utils/wozniakLinter.ts
var MAX_CLOZE_WORDS = 5;
var MAX_BASIC_ANSWER_WORDS = 15;
var MAX_BASIC_ANSWER_CHARS = 110;
var MAX_QUESTION_WORDS = 50;
var MAX_COMMENT_CHARS = 320;
var MIN_VISUAL_LEGEND_WORDS = 6;
var DANGLING_STOPWORDS = /* @__PURE__ */ new Set([
  "a",
  "ao",
  "aos",
  "as",
  "com",
  "contra",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "entre",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "os",
  "ou",
  "para",
  "pela",
  "pelas",
  "pelo",
  "pelos",
  "por",
  "que",
  "se",
  "sem",
  "sob",
  "sobre",
  "um",
  "uma"
]);
var PROHIBITED_CLOZE_HINTS = /* @__PURE__ */ new Set([
  "f\xE1rmaco",
  "farmaco",
  "droga",
  "conduta",
  "classe",
  "subst\xE2ncia",
  "substancia",
  "momento",
  "tempo",
  "dose",
  "quantidade",
  "n\xFAmero",
  "numero",
  "deriva\xE7\xF5es",
  "derivacoes",
  "valor",
  "valores",
  "crit\xE9rio",
  "criterio",
  "aumento",
  "diminui\xE7\xE3o",
  "diminuicao"
]);
var MEDICAL_UNITS_AND_STOPWORDS = /* @__PURE__ */ new Set([
  "para",
  "com",
  "sem",
  "por",
  "que",
  "dos",
  "das",
  "uma",
  "como",
  "mais",
  "menos",
  "qual",
  "quais",
  "onde",
  "quando",
  "caso",
  "sobre",
  "entre",
  "apos",
  "antes",
  "anos",
  "ano",
  "dias",
  "dia",
  "meses",
  "mes",
  "horas",
  "hora",
  "minutos",
  "minuto",
  "segundos",
  "segundo",
  "grau",
  "tipo",
  "fase",
  "nivel",
  "risco",
  "dose",
  "doses",
  "sao",
  "este",
  "esta",
  "isto",
  "esses",
  "essas",
  "pelo",
  "pela",
  "pelos",
  "pelas",
  "mmhg",
  "bpm",
  "cpm",
  "mg",
  "mcg",
  "kg",
  "ml",
  "cm",
  "mm",
  "meq",
  "meql",
  "ui",
  "se",
  "ou",
  "nao",
  "sim",
  "uso",
  "via",
  "oral",
  "intravenosa",
  "intramuscular",
  "paciente",
  "quadro",
  "clinico",
  "clinica",
  "medica",
  "medico",
  "emergencia",
  "urgencia",
  "conduta",
  "tratamento",
  "manejo",
  "exame",
  "avaliacao",
  "resposta",
  "diagnostico",
  "inicial",
  "primeira",
  "segunda",
  "linha",
  "escolha",
  "sindrome",
  "doenca",
  "agudo",
  "aguda",
  "cronico",
  "cronica",
  "grave",
  "leve",
  "moderado",
  "moderada"
]);
var SYNONYM_SPOILERS = {
  adrenalina: ["epinefrina"],
  epinefrina: ["adrenalina"],
  noradrenalina: ["norepinefrina"],
  norepinefrina: ["noradrenalina"],
  vasopressina: ["adh"],
  adh: ["vasopressina"],
  pelvimetria: ["plano", "zero", "planos", "delee", "lee", "hodges", "bacia", "espinhas", "isquiaticas", "conjugata"],
  pelvimetr: ["plano", "zero", "planos", "delee", "lee", "hodges", "bacia", "espinhas"],
  plano: ["pelvimetria", "delee", "hodges"],
  planos: ["pelvimetria", "plano", "zero", "delee", "hodges"],
  manobra: ["manobras", "mcroberts", "rubin", "woods", "jacquemier", "zavanelli", "kristeller", "leopold", "ritgen", "brandt"],
  manobras: ["manobra", "mcroberts", "rubin", "woods", "jacquemier", "zavanelli", "kristeller", "leopold", "ritgen", "brandt"]
};
function stripClozeMarkup(text) {
  if (!text) return "";
  return text.replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, (_m, inner) => {
    return (inner || "").split("::")[0] || "";
  });
}
function stripHtml(htmlText) {
  if (!htmlText) return "";
  const withoutAudio = htmlText.replace(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi, " ");
  return withoutAudio.replace(/<\/?[a-zA-Z!][^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&le;/gi, "\u2264").replace(/&ge;/gi, "\u2265").replace(/&plusmn;/gi, "\xB1").replace(/&times;/gi, "\xD7").replace(/&divide;/gi, "\xF7").replace(/&deg;/gi, "\xB0").replace(/&rarr;/gi, "\u2192").replace(/&larr;/gi, "\u2190").replace(/&uarr;/gi, "\u2191").replace(/&darr;/gi, "\u2193").replace(/&ndash;/gi, "\u2013").replace(/&mdash;/gi, "\u2014").replace(/&alpha;/gi, "\u03B1").replace(/&beta;/gi, "\u03B2").replace(/&gamma;/gi, "\u03B3").replace(/&delta;/g, "\u03B4").replace(/&Delta;/g, "\u0394").replace(/&mu;|&micro;/gi, "\u03BC").replace(/&apos;|&#0*39;/gi, "'").replace(/&quot;/gi, '"').replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_m, dec) => {
    const code = Number(dec);
    return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
  }).replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
    const code = parseInt(hex, 16);
    return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
  }).replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}
function extractCommentVisibleText(hint) {
  if (!hint) return "";
  let cleaned = hint.replace(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi, " ");
  cleaned = cleaned.replace(/<table[\s\S]*?<\/table>/gi, " ");
  cleaned = cleaned.replace(/<table\b[\s\S]*$/gi, " ");
  cleaned = cleaned.replace(/^(?:\s*<img\b[^>]*>\s*(?:<br\s*\/?>\s*)*)+/i, " ");
  const parts = cleaned.split(/Coment[áa]rio:/i);
  const afterComment = parts.length > 1 ? parts.slice(1).join("Coment\xE1rio:") : cleaned.replace(/^\s*<i>[\s\S]*?<\/i>(?:\s*<br\s*\/?>\s*)*/i, " ");
  return stripHtml(afterComment);
}
function countWords(text) {
  const cleaned = stripHtml(stripClozeMarkup(text));
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}
function resolveLocalMediaFilename(rawImgTag, rawSrc, cardId, imgIndex = 0, deckKey = "deck") {
  const cleanDeck = (deckKey || "deck").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_") || "deck";
  const attrMatch = rawImgTag.match(/\bdata-anki-file=["']([^"']+)["']/i);
  if (attrMatch && attrMatch[1]) {
    const cleanAttr = attrMatch[1].trim().replace(/[\s"<>|?*\\/]+/g, "_").replace(/_{2,}/g, "_").replace(/^_+|_+$/g, "");
    if (cleanAttr) return cleanAttr;
  }
  const src = (rawSrc || "").trim();
  if (src && !/^(?:https?:|data:|blob:|pdfimg:|buscar_imagem:|\/)/i.test(src)) {
    const base = (src.split(/[\\/]/).pop() || src).trim();
    return base.replace(/[\s"<>|?*]+/g, "_");
  }
  if (src.startsWith("data:image/svg")) {
    return `${cleanDeck}_${cardId}_img${imgIndex + 1}.svg`;
  }
  if (src.startsWith("data:image/png")) {
    return `${cleanDeck}_${cardId}_img${imgIndex + 1}.png`;
  }
  if (src.startsWith("data:image/webp")) {
    return `${cleanDeck}_${cardId}_img${imgIndex + 1}.webp`;
  }
  if (src.startsWith("data:image/")) {
    return `${cleanDeck}_${cardId}_img${imgIndex + 1}.jpg`;
  }
  if (/^https?:\/\//i.test(src)) {
    try {
      const u = new URL(src);
      const rawLast = decodeURIComponent(u.pathname.split("/").pop() || "").replace(/^\d+px-/i, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
      if (rawLast && /\.(?:jpg|jpeg|png|svg|webp|gif)$/i.test(rawLast)) {
        return rawLast.slice(0, 72);
      }
    } catch {
    }
  }
  return `${cleanDeck}_${cardId}_img${imgIndex + 1}.jpg`;
}
function resolveLocalAudioFilename(rawTag, rawSrc, cardId, audioIndex = 0, deckKey = "deck") {
  const cleanDeck = (deckKey || "deck").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_") || "deck";
  const attrMatch = rawTag.match(/\bdata-anki-file=["']([^"']+)["']/i);
  if (attrMatch && attrMatch[1]) {
    const cleanAttr = attrMatch[1].trim().replace(/[\s"<>|?*\\/]+/g, "_");
    if (cleanAttr) return cleanAttr;
  }
  const src = (rawSrc || "").trim();
  if (src && !/^(?:https?:|data:|blob:|\/)/i.test(src)) {
    const base = (src.split(/[\\/]/).pop() || src).trim();
    return base.replace(/[\s"<>|?*]+/g, "_");
  }
  if (src.startsWith("data:audio/wav")) {
    return `${cleanDeck}_${cardId}_audio${audioIndex + 1}.wav`;
  }
  if (src.startsWith("data:audio/ogg")) {
    return `${cleanDeck}_${cardId}_audio${audioIndex + 1}.ogg`;
  }
  return `${cleanDeck}_${cardId}_audio${audioIndex + 1}.mp3`;
}
function extractCardMediaReferences(card, deckKey = "deck") {
  const refs = [];
  const fields = [
    ["question", card.question || ""],
    ["hint", card.hint || ""]
  ];
  for (const [fieldName, htmlText] of fields) {
    let imgIdx = 0;
    const imgRegex = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = imgRegex.exec(htmlText)) !== null) {
      const fullTag = m[0];
      const srcVal = m[1];
      const filename = resolveLocalMediaFilename(fullTag, srcVal, card.id, imgIdx++, deckKey);
      refs.push({
        filename,
        sourceUrl: srcVal,
        field: fieldName,
        kind: "image",
        rawTag: fullTag
      });
    }
    let audioIdx = 0;
    const audioSourceRegex = /<audio\b[^>]*>[\s\S]*?<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/audio>/gi;
    while ((m = audioSourceRegex.exec(htmlText)) !== null) {
      const fullTag = m[0];
      const srcVal = m[1];
      const filename = resolveLocalAudioFilename(fullTag, srcVal, card.id, audioIdx++, deckKey);
      refs.push({
        filename,
        sourceUrl: srcVal,
        field: fieldName,
        kind: "audio",
        rawTag: fullTag
      });
    }
    const directAudioRegex = /<audio\b(?![^>]*>[\s\S]*?<source\b)[^>]*\bsrc=["']([^"']+)["'][^>]*>(?:[\s\S]*?<\/audio>)?/gi;
    while ((m = directAudioRegex.exec(htmlText)) !== null) {
      const fullTag = m[0];
      const srcVal = m[1];
      const filename = resolveLocalAudioFilename(fullTag, srcVal, card.id, audioIdx++, deckKey);
      refs.push({
        filename,
        sourceUrl: srcVal,
        field: fieldName,
        kind: "audio",
        rawTag: fullTag
      });
    }
    const soundBracketRegex = /\[sound:([^\]]+)\]/gi;
    while ((m = soundBracketRegex.exec(htmlText)) !== null) {
      const fullTag = m[0];
      const srcVal = m[1].trim();
      const filename = resolveLocalAudioFilename(fullTag, srcVal, card.id, audioIdx++, deckKey);
      refs.push({
        filename,
        sourceUrl: srcVal,
        field: fieldName,
        kind: "audio",
        rawTag: fullTag
      });
    }
  }
  return refs;
}
function normalizeForSpoiler(text) {
  return stripHtml(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
var NON_SPOILER_ACRONYMS = /* @__PURE__ */ new Set([
  "IV",
  "EV",
  "VO",
  "IM",
  "SC",
  "DU",
  "MG",
  "ML",
  "KG",
  "CM",
  "MM",
  "UI",
  "PA",
  "FC",
  "FR",
  "PH",
  "RN",
  "DE",
  "DA",
  "DO",
  "EM",
  "NO",
  "NA",
  "OS",
  "AS"
]);
function extractAcronymTokens(text) {
  const plain = stripHtml(text);
  const matches = plain.match(/\b[A-Z]{2,5}\b/g) || [];
  return Array.from(new Set(matches.filter((tok) => !NON_SPOILER_ACRONYMS.has(tok))));
}
function extractCoreKeywords(text) {
  const norm = normalizeForSpoiler(text);
  if (!norm) return [];
  return norm.split(/\s+/).filter((w) => w.length > 3 && !MEDICAL_UNITS_AND_STOPWORDS.has(w));
}
function stemsCollideForSpoiler(a, b) {
  if (a.length < 4 || b.length < 4) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 6) {
    if (a.startsWith(b) || b.startsWith(a)) return true;
    let common = 0;
    const limit = Math.min(a.length, b.length);
    while (common < limit && a[common] === b[common]) {
      common++;
    }
    if (common >= 7) return true;
  }
  return false;
}
var PORTUGUESE_STEM_SUFFIXES = [
  "amentos",
  "amento",
  "acoes",
  "acao",
  "icoes",
  "icao",
  "mente",
  "idades",
  "idade",
  "ismos",
  "ismo",
  "istas",
  "ista",
  "ulares",
  "ular",
  "icos",
  "icas",
  "ico",
  "ica",
  "ores",
  "oras",
  "ador",
  "adora",
  "antes",
  "ante",
  "entes",
  "ente",
  "oes",
  "aes",
  "ais",
  "eis",
  "ois",
  "es",
  "is",
  "os",
  "as",
  "s",
  "a",
  "o"
];
function stemPortugueseWord(word) {
  const w = normalizeForSpoiler(word).replace(/\s+/g, "");
  if (w.length <= 4) return w;
  for (const suffix of PORTUGUESE_STEM_SUFFIXES) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 4) {
      return w.slice(0, w.length - suffix.length);
    }
  }
  return w;
}
function expandWithSynonyms(words) {
  const out = /* @__PURE__ */ new Set();
  for (const w of words) {
    out.add(w);
    const syns = SYNONYM_SPOILERS[w];
    if (syns) {
      syns.forEach((s) => out.add(s));
    }
  }
  return out;
}
var DIAGNOSTIC_MODALITY_PATTERNS = [
  {
    modality: "USG",
    label: "USG / Ultrassonografia",
    pattern: /\b(?:usg|ultrassonografia|ultrassom|ultrassonogr[aá]fic[ao]|ecografia|ecogr[aá]fic[ao]|e-?fast|doppler|ultrasound|sonography)\b/i
  },
  {
    modality: "ECOCARDIOGRAMA",
    label: "Ecocardiograma",
    pattern: /\b(?:ecocardiograma|ecocardiografia|ecocardiogr[aá]fic[ao]|echocardiogra(?:m|phy))\b/i
  },
  {
    modality: "TC",
    label: "TC / Tomografia Computadorizada",
    pattern: /\b(?:tc|tomografia(?:\s+computadorizada)?|angiotomografia|angio-?tc|urotomografia|ct\s+scan|computed\s+tomography)\b/i
  },
  {
    modality: "RM",
    label: "RM / Resson\xE2ncia Magn\xE9tica",
    pattern: /\b(?:rm|rnm|resson[aâ]ncia(?:\s+magn[eé]tica)?|colangiorresson[aâ]ncia|angiorresson[aâ]ncia|mri|magnetic\s+resonance)\b/i
  },
  {
    modality: "RX",
    label: "RX / Radiografia",
    pattern: /\b(?:rx|raio-?x|raios-?x|radiografia|radiogr[aá]fic[ao]|teleradiografia|telerradiografia|x-?ray|chest\s+radiograph)\b/i
  },
  {
    modality: "ECG",
    label: "ECG / Eletrocardiograma",
    pattern: /\b(?:ecg|eletrocardiograma|eletrocardiogr[aá]fic[ao]|electrocardiogra(?:m|phy))\b/i
  },
  {
    modality: "ECOCARDIOGRAMA",
    label: "Ecocardiograma / Doppler Card\xEDaco",
    pattern: /\b(?:ecocardiograma|ecocardiografia|ecocardiogr[aá]fic[ao]|echocardiogra(?:m|phy)|ecodoppler\s+card[ií]aco|modo[\s-]?m)\b/i
  },
  {
    modality: "CTG",
    label: "CTG / Cardiotocografia",
    pattern: /\b(?:ctg|cardiotocografia|cardiotocogr[aá]fic[ao]|cardiotocograma|cardiotocography)\b/i
  },
  {
    modality: "LAPAROSCOPIA",
    label: "Laparoscopia / Videolaparoscopia",
    pattern: /\b(?:laparoscopia|videolaparoscopia|laparosc[oó]pic[ao]|videolaparosc[oó]pic[ao]|laparoscopy)\b/i
  },
  {
    modality: "EDA",
    label: "EDA / Endoscopia Digestiva",
    pattern: /\b(?:eda|endoscopia(?:\s+digestiva(?:\s+alta)?)?|endosc[oó]pic[ao])\b/i
  },
  {
    modality: "COLONOSCOPIA",
    label: "Colonoscopia / Retossigmoidoscopia",
    pattern: /\b(?:colonoscopia|retossigmoidoscopia|colonosc[oó]pic[ao])\b/i
  },
  {
    modality: "HISTEROSCOPIA",
    label: "Histeroscopia",
    pattern: /\b(?:histeroscopia|histerosc[oó]pic[ao])\b/i
  },
  {
    modality: "COLPOSCOPIA",
    label: "Colposcopia",
    pattern: /\b(?:colposcopia|colposc[oó]pic[ao])\b/i
  },
  {
    modality: "BRONCOSCOPIA",
    label: "Broncoscopia",
    pattern: /\b(?:broncoscopia|broncosc[oó]pic[ao])\b/i
  },
  {
    modality: "FUNDOSCOPIA",
    label: "Fundoscopia / Retinografia",
    pattern: /\b(?:fundoscopia|fundo\s+de\s+olho|mapeamento\s+de\s+retina|retinografia|fundoscopy)\b/i
  },
  {
    modality: "DERMATOSCOPIA",
    label: "Dermatoscopia",
    pattern: /\b(?:dermatoscopia|dermatosc[oó]pic[ao]|dermoscopy)\b/i
  },
  {
    modality: "OTOSCOPIA",
    label: "Otoscopia",
    pattern: /\b(?:otoscopia|otosc[oó]pic[ao]|otoscopy)\b/i
  },
  {
    modality: "HISTOPATOLOGIA",
    label: "Histopatologia / Bi\xF3psia / Esfrega\xE7o",
    pattern: /\b(?:histopatol[oó]gic[ao]|anatomopatol[oó]gic[ao]|histologia|l[aâ]mina\s+histol[oó]gica|esfrega[cç]o\s+(?:de\s+)?sangue|blood\s+smear|microscopia|bi[oó]psia)\b/i
  },
  {
    modality: "MAMOGRAFIA",
    label: "Mamografia",
    pattern: /\b(?:mamografia|mamogr[aá]fic[ao]|mammogra(?:m|phy))\b/i
  },
  {
    modality: "ESPIROMETRIA",
    label: "Espirometria",
    pattern: /\b(?:espirometria|espirom[eé]tric[ao]|curva\s+fluxo-?volume)\b/i
  },
  {
    modality: "PARTOGRAMA",
    label: "Partograma",
    pattern: /\b(?:partograma|partogram)\b/i
  },
  {
    modality: "ARTERIOGRAFIA",
    label: "Arteriografia / Cateterismo",
    pattern: /\b(?:arteriografia|angiografia|cineangiocoronariografia|cateterismo\s+card[ií]aco)\b/i
  }
];
var VISUAL_OVERLAP_STOPWORDS = /* @__PURE__ */ new Set([
  "paciente",
  "gestante",
  "parturiente",
  "lactente",
  "escolar",
  "idoso",
  "idosa",
  "adulto",
  "adulta",
  "mulher",
  "homem",
  "crianca",
  "clinico",
  "clinica",
  "diagnostico",
  "diagnostica",
  "conduta",
  "exame",
  "imagem",
  "figura",
  "foto",
  "abaixo",
  "acima",
  "anexo",
  "mostrado",
  "mostrada",
  "apresentado",
  "apresentada",
  "evidencia",
  "evidenciando",
  "demonstra",
  "demonstrando",
  "mostra",
  "mostrando",
  "revela",
  "revelando",
  "observa",
  "nota",
  "indica",
  "indicando",
  "correlacao",
  "padrao",
  "caracteristico",
  "caracteristica",
  "achado",
  "achados",
  "sinal",
  "sinais",
  "aspecto",
  "lesao",
  "alteracao",
  "alteracoes",
  "normal",
  "agudo",
  "aguda",
  "cronico",
  "cronica",
  "direito",
  "direita",
  "esquerdo",
  "esquerda",
  "bilateral",
  "anterior",
  "posterior",
  "inferior",
  "superior",
  "torax",
  "toracico",
  "toracica",
  "abdome",
  "abdominal",
  "pelve",
  "pelvico",
  "pelvica",
  "cranio",
  "cerebral",
  "pulmonar",
  "cardiaco",
  "cardiaca",
  "renal",
  "hepatico",
  "hepatica",
  "uterino",
  "uterina",
  "fetal",
  "intraparto",
  "obstetrico",
  "obstetrica",
  "emergencia",
  "pronto",
  "socorro",
  "sala",
  "ambulatorio",
  "enfermaria",
  "centro",
  "qual",
  "quais",
  "imediata",
  "imediato",
  "primeira",
  "segunda",
  "escolha",
  "linha",
  "ecg",
  "usg",
  "tc",
  "rm",
  "rx",
  "ctg",
  "eda",
  "eletrocardiograma",
  "ultrassonografia",
  "ultrassom",
  "tomografia",
  "computadorizada",
  "ressonancia",
  "magnetica",
  "radiografia",
  "cardiotocografia",
  "cardiotocografico",
  "laparoscopia",
  "videolaparoscopia",
  "endoscopia",
  "colonoscopia",
  "derivacoes",
  "ortostase",
  "contraste",
  "tracado",
  "corte",
  "incidencia",
  "legenda",
  "visual",
  "complementar",
  "internato",
  "medico",
  "medica",
  "caso",
  "quadro",
  "realiza",
  "realizou",
  "submetida",
  "submetido",
  "dor",
  "febre",
  "dispneia",
  "sudorese",
  "cefaleia",
  "nausea",
  "vomito",
  "vomitos",
  "palpitacoes",
  "semanas",
  "meses",
  "anos",
  "horas",
  "minutos",
  "tipica",
  "tipico",
  "suspeita",
  "avaliacao",
  "manejo",
  "tratamento",
  "abordagem",
  "classificacao",
  "fisiologica",
  "patologica",
  "compat\xEDvel",
  "compativel",
  "presenca",
  "ausencia",
  "doppler",
  "colorido",
  "colorida",
  "axial",
  "coronal",
  "sagital",
  "transversal",
  "longitudinal",
  "eletrocardiografico",
  "eletrocardiografica",
  "classico",
  "classica",
  "utero",
  "gravidico",
  "gravidica",
  "biliar",
  "vesicula",
  "onda",
  "ondas",
  "intervalo",
  "complexo",
  "segmento",
  "taquicardia",
  "bradicardia",
  "irregular",
  "regular",
  "sinusal",
  "ritmo",
  "conducao",
  "todas",
  "todos",
  "toda",
  "todo",
  "partograma",
  "apresentacao",
  "apresentando",
  "apresenta",
  "contracao",
  "contracoes",
  "eficaz",
  "eficazes",
  "dilatacao",
  "trabalho",
  "parto"
]);
var VISUAL_FINDING_PATTERNS = [
  /\bsupradesnivelamento\s+(?:convexo\s+)?(?:do\s+segmento\s+|de\s+)?st\b/i,
  /\binfradesnivelamento\s+(?:do\s+segmento\s+|de\s+)?st\b/i,
  /\bonda\s+q\s+patol[oó]gica\b/i,
  /\bpneumoperit[oô]nio\b/i,
  /\bn[ií]vel\s+hidroa[eé]reo\b/i,
  /\bempilhamento\s+de\s+moedas\b/i,
  /\bpar[aá]bola\s+de\s+damoiseau\b/i,
  /\bsinal\s+d[aoe]\s+(?:roda\s+dentada|alvo|menisco|duplo\s+contorno|dupla\s+bolha|gr[aã]o\s+de\s+caf[eé]|tartaruga|campan[aá]rio|polegar|anel\s+de\s+fogo|halo|contas\s+de\s+ros[aá]rio)\b/i,
  /\bcordas\s+de\s+violino\b/i,
  /\bdesacelera[cç][õo]es?\s+tardias?\b/i,
  /\bvariabilidade\s+ausente\b/i,
  /\bvidro\s+fosco\b/i,
  /\bconsolida[cç][aã]o\s+lobar\b/i,
  /\bborramento\s+da\s+gordura\b/i,
  /\bespessamento\s+(?:parietal|tub[aá]rio|endometrial)\b/i,
  /\bsombra\s+ac[uú]stica\b/i,
  /\bhipotranspar[eê]ncia\b/i,
  /\bhipertranspar[eê]ncia\b/i,
  /\bimagem\s+(?:hipoecoica|hiperecoica|anecoica|hiperdensa|hipodensa)\b/i,
  /\bvelamento\s+d[eo]\s+seio\b/i,
  /\balargamento\s+(?:de\s+|do\s+)?mediastino\b/i,
  /\blente\s+biconvexa\b/i,
  /\bforma\s+de\s+crescente\b/i,
  /\bcole[cç][aã]o\s+peric[oó]lica\b/i
];
function extractVisualLegendEntries(card) {
  const entries = [];
  const rawHint = (card.hint || "").replace(/<table[\s\S]*?<\/table>/gi, " ").replace(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi, " ");
  const commentSplit = rawHint.split(/<b>\s*Coment[áa]rio:\s*<\/b>/i);
  const preCommentHint = commentSplit[0] || "";
  const hasCommentSplit = commentSplit.length > 1;
  const sourcesToScan = [
    hasCommentSplit ? preCommentHint : rawHint,
    card.question || ""
  ];
  const seenRaw = /* @__PURE__ */ new Set();
  for (const srcHtml of sourcesToScan) {
    const italicRegex = /<i\b[^>]*>([\s\S]*?)<\/i>/gi;
    let m;
    while ((m = italicRegex.exec(srcHtml)) !== null) {
      const rawHtml = m[0];
      if (seenRaw.has(rawHtml)) continue;
      seenRaw.add(rawHtml);
      const text = stripHtml(m[1] || "").replace(/\s+/g, " ").trim();
      const descriptiveText = text.replace(/^(?:legenda(?:\s+visual)?|achado(?:\s+visual)?|imagem)\s*:\s*/i, "").trim();
      const wordCount = descriptiveText ? descriptiveText.split(/\s+/).filter(Boolean).length : 0;
      entries.push({ rawHtml, text, descriptiveText, wordCount });
    }
  }
  if (entries.length === 0 && hasCommentSplit && /<img\b/i.test(commentSplit.slice(1).join(" "))) {
    const postComment = commentSplit.slice(1).join(" ");
    const italicRegex = /<i\b[^>]*>([\s\S]*?)<\/i>/gi;
    let m;
    while ((m = italicRegex.exec(postComment)) !== null) {
      const text = stripHtml(m[1] || "").replace(/\s+/g, " ").trim();
      const descriptiveText = text.replace(/^(?:legenda(?:\s+visual)?|achado(?:\s+visual)?|imagem)\s*:\s*/i, "").trim();
      const wordCount = descriptiveText ? descriptiveText.split(/\s+/).filter(Boolean).length : 0;
      entries.push({ rawHtml: m[0], text, descriptiveText, wordCount });
    }
  }
  return entries;
}
function extractDiagnosticModalities(text) {
  const plain = stripHtml(stripClozeMarkup(text || ""));
  if (!plain) return [];
  const found = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of DIAGNOSTIC_MODALITY_PATTERNS) {
    if (entry.pattern.test(plain) && !seen.has(entry.modality)) {
      seen.add(entry.modality);
      found.push({ modality: entry.modality, label: entry.label });
    }
  }
  return found;
}
function detectModalityConflict(card) {
  const legendEntries = extractVisualLegendEntries(card);
  const legendCombined = legendEntries.map((e) => e.text).join(" ");
  const legendMods = extractDiagnosticModalities(legendCombined);
  if (legendMods.length === 0) {
    return { hasConflict: false, cardModalities: [], legendModalities: [] };
  }
  const cardTextCombined = [card.topic || "", card.question || ""].join(" ");
  const cardMods = extractDiagnosticModalities(cardTextCombined);
  if (cardMods.length === 0) {
    return {
      hasConflict: false,
      cardModalities: [],
      legendModalities: legendMods.map((m) => m.label)
    };
  }
  const legendSet = new Set(legendMods.map((m) => m.modality));
  const hasOverlap = cardMods.some((m) => legendSet.has(m.modality));
  if (hasOverlap) {
    return {
      hasConflict: false,
      cardModalities: cardMods.map((m) => m.label),
      legendModalities: legendMods.map((m) => m.label)
    };
  }
  const cardLabels = cardMods.map((m) => m.label).join(" / ");
  const legendLabels = legendMods.map((m) => m.label).join(" / ");
  return {
    hasConflict: true,
    cardModalities: cardMods.map((m) => m.label),
    legendModalities: legendMods.map((m) => m.label),
    message: `Conflito de modalidade texto \xD7 legenda: texto do card cita ${cardLabels}, mas a legenda visual descreve ${legendLabels}.`
  };
}
function extractVisualFindingStems(text) {
  const norm = stripHtml(stripClozeMarkup(text || "")).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ");
  const stems = /* @__PURE__ */ new Set();
  for (const tok of norm.split(/\s+/)) {
    if (tok.length >= 5 && !DANGLING_STOPWORDS.has(tok) && !MEDICAL_UNITS_AND_STOPWORDS.has(tok) && !VISUAL_OVERLAP_STOPWORDS.has(tok)) {
      stems.add(stemPortugueseWord(tok));
    }
  }
  return stems;
}
function detectRedundantVisualDescription(card) {
  if (card.type !== "basic" || !/<img\b/i.test(card.question || "")) {
    return { isRedundant: false };
  }
  const qWithoutImgs = (card.question || "").replace(/<img\b[^>]*>/gi, " ");
  const qVisible = stripHtml(stripClozeMarkup(qWithoutImgs));
  if (!qVisible) return { isRedundant: false };
  for (const pattern of VISUAL_FINDING_PATTERNS) {
    const match = qVisible.match(pattern);
    if (match) {
      return {
        isRedundant: true,
        reason: `Enunciado descreve textualmente o achado visual ("${match[0]}") em card Med_Basic_Inverted_v2 com imagem na pergunta.`
      };
    }
  }
  const legendEntries = extractVisualLegendEntries(card);
  const legendText = legendEntries.map((e) => e.descriptiveText).join(" ");
  if (legendText) {
    const qStems = extractVisualFindingStems(qVisible);
    const legendStems = extractVisualFindingStems(legendText);
    const shared = [];
    for (const st of legendStems) {
      if (qStems.has(st)) shared.push(st);
    }
    if (shared.length >= 2) {
      return {
        isRedundant: true,
        reason: `Enunciado antecipa textualmente o achado da legenda visual (${shared.slice(0, 3).join(", ")}) em card Med_Basic_Inverted_v2 com imagem na pergunta.`
      };
    }
  }
  const sentences = qVisible.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    if (/^(?:qual|quais|o\s+que|como|por\s+que|quando|onde)\b/i.test(sentence)) {
      continue;
    }
    const narrationMatch = sentence.match(
      /\b(?:exame|imagem|figura|foto|tra[cç]ado|ecg|ctg|rx|radiografia|tc|tomografia|rm|resson[aâ]ncia|usg|ultrassonografia|laparoscopia|videolaparoscopia|endoscopia|eda|fundoscopia|dermatoscopia|l[aâ]mina)\s+(?:abaixo|acima|anexo|apresentad[ao]|mostrad[ao])?[^,]*?\b(?:mostra|mostrando|evidencia|evidenciando|revela|revelando|demonstra|demonstrando|exibe|exibindo|observa-se|nota-se|visualiza-se|identifica-se)\s+(.+)$/i
    );
    if (narrationMatch && narrationMatch[1]) {
      const findingStems = extractVisualFindingStems(narrationMatch[1]);
      if (findingStems.size >= 2) {
        return {
          isRedundant: true,
          reason: `Enunciado narra o achado visual da imagem ("${narrationMatch[1].slice(0, 60).trim()}") em card Med_Basic_Inverted_v2.`
        };
      }
    }
  }
  return { isRedundant: false };
}
function lintCard(card, availableMediaNames) {
  const warnings = [];
  const cardType = String(card.type || "basic").toLowerCase() === "cloze" ? "cloze" : "basic";
  const questionText = card.question || "";
  const answerText = card.answer || "";
  const hintText = card.hint || "";
  const topicText = card.topic || "";
  const availableMediaSet = /* @__PURE__ */ new Set();
  if (availableMediaNames) {
    for (const name of availableMediaNames) {
      if (name) {
        const clean = String(name).trim().toLowerCase();
        availableMediaSet.add(clean);
        const base = clean.split(/[\\/]/).pop();
        if (base) availableMediaSet.add(base);
        const srcMatch = clean.match(/\bsrc=["']([^"']+)["']/i);
        if (srcMatch && srcMatch[1]) {
          const srcBase = srcMatch[1].trim().split(/[\\/]/).pop();
          if (srcBase) availableMediaSet.add(srcBase);
        }
        const soundMatch = clean.match(/\[sound:([^\]]+)\]/i);
        if (soundMatch && soundMatch[1]) {
          const soundBase = soundMatch[1].trim().split(/[\\/]/).pop();
          if (soundBase) availableMediaSet.add(soundBase);
        }
      }
    }
  }
  const mediaRefs = extractCardMediaReferences(card, card.deck_key || "deck");
  const missingMediaFiles = [];
  if (!card.isResolvingImage) {
    for (const ref of mediaRefs) {
      const raw = (ref.sourceUrl || "").trim();
      const isSelfContainedOrWeb = /^(?:https?:\/\/|data:)/i.test(raw);
      const isLoadedLocally = availableMediaSet.has(ref.filename.toLowerCase()) || availableMediaSet.has(raw.toLowerCase());
      if (!isSelfContainedOrWeb && !isLoadedLocally) {
        if (!missingMediaFiles.includes(ref.filename)) {
          missingMediaFiles.push(ref.filename);
        }
        warnings.push({
          code: "MISSING_MEDIA",
          field: ref.field,
          severity: "error",
          message: `M\xEDdia local n\xE3o encontrada ("${ref.filename}"): clique em "Buscar no Google/Web" ou remova a refer\xEAncia.`
        });
      }
    }
  }
  const questionWordCount = countWords(questionText);
  const visibleAnswer = stripHtml(answerText);
  const answerWordCount = cardType === "basic" ? countWords(answerText) : 0;
  const answerCharCount = visibleAnswer.length;
  const commentVisibleCharCount = extractCommentVisibleText(hintText).length;
  if (questionWordCount > MAX_QUESTION_WORDS) {
    warnings.push({
      code: "QUESTION_TOO_LONG",
      field: "question",
      severity: "warning",
      message: `Enunciado com ${questionWordCount} palavras (Matuschak & Nielsen Anti-Pattern-Matching: m\xE1x. ${MAX_QUESTION_WORDS} palavras para evitar memoriza\xE7\xE3o superficial da forma da frase).`
    });
  }
  const visibleTopic = stripHtml(topicText);
  if (visibleTopic) {
    const mPrefix = questionText.match(/^\s*(?:\*\*|<b>)([\s\S]*?)(?:\*\*|<\/b>)[:.]?\s*/i);
    if (mPrefix && mPrefix[1]) {
      const pfx = stripHtml(mPrefix[1]).toLowerCase();
      const topClean = visibleTopic.toLowerCase();
      const subtop = topClean.includes(" - ") ? topClean.split(" - ").pop().trim() : topClean;
      if (pfx === topClean || pfx === subtop || pfx.length > 5 && (topClean.includes(pfx) || pfx.includes(topClean) || subtop.includes(pfx) || pfx.includes(subtop))) {
        warnings.push({
          code: "TOPIC_DUPLICATED_IN_QUESTION",
          field: "question",
          severity: "error",
          message: `A pergunta inicia repetindo o t\xF3pico "${stripHtml(mPrefix[1])}" em negrito.`
        });
      }
    }
  }
  const allFieldsText = `${questionText} ${answerText} ${hintText} ${topicText}`;
  if (/\$/.test(allFieldsText) || /\\[a-zA-Z([]/.test(allFieldsText)) {
    warnings.push({
      code: "LATEX_PROHIBITED",
      field: "question",
      severity: "error",
      message: 'Sintaxe LaTeX/MathJax n\xE3o renderizada ("$" ou "\\"). Use caracteres Unicode diretos (\u2265, \u2264, \u03B2, \u03B1, \u2192).'
    });
  }
  if (/\bcategoria\s+[ABCDX]\b/i.test(allFieldsText)) {
    warnings.push({
      code: "FDA_OBSOLETE_CATEGORY",
      field: "hint",
      severity: "warning",
      message: "Evite categorias obsoletas da FDA (A/B/C/D/X); descreva o risco teratog\xEAnico espec\xEDfico."
    });
  }
  const clozeRegex = /\{\{c(\d+)::([\s\S]*?)\}\}/g;
  const clozeMatches = Array.from(questionText.matchAll(clozeRegex));
  const clozeCount = clozeMatches.length;
  let maxClozeWords = 0;
  const clozeTargets = [];
  for (const match of clozeMatches) {
    const inner = match[2] || "";
    const parts = inner.split("::");
    const targetText = (parts[0] || "").trim();
    clozeTargets.push(targetText);
    const wordsList = stripHtml(targetText).split(/\s+/).filter(Boolean);
    const wCount = wordsList.length;
    if (wCount > maxClozeWords) {
      maxClozeWords = wCount;
    }
    if (wCount >= 3 && DANGLING_STOPWORDS.has(wordsList[wordsList.length - 1].toLowerCase())) {
      warnings.push({
        code: "CLOZE_DANGLING_PARTICLE",
        field: "question",
        severity: "error",
        message: `Lacuna cloze termina com part\xEDcula truncada ("${wordsList[wordsList.length - 1]}").`
      });
    }
    if (parts.length > 1) {
      const dica = (parts[1] || "").trim().toLowerCase();
      const hasProhibitedDica = Array.from(PROHIBITED_CLOZE_HINTS).some((h) => dica.includes(h)) || dica.includes(" ou ") || dica.length > 0;
      if (hasProhibitedDica) {
        warnings.push({
          code: "CLOZE_HAS_HINT",
          field: "question",
          severity: "error",
          message: `Proibido usar ::dica dentro da lacuna {{c1::...}} (encontrado "::${parts[1]}").`
        });
      }
    }
    if (match[1] !== "1") {
      warnings.push({
        code: "CLOZE_COUNT_INVALID",
        field: "question",
        severity: "error",
        message: `Usar estritamente {{c1::...}} (encontrado {{c${match[1]}::...}}).`
      });
    }
  }
  if (/\{\{c\d+::[\s\S]*?\}\}\s*\((?:crit[eé]rios?|pontos?|dias?|anos?|itens?|sinais?)\)/i.test(questionText)) {
    warnings.push({
      code: "CLOZE_HAS_HINT",
      field: "question",
      severity: "warning",
      message: 'Evite muletas p\xF3s-lacuna entre par\xEAnteses como "{{c1::...}} (crit\xE9rios)".'
    });
  }
  if (cardType === "basic") {
    if (answerWordCount === 0) {
      warnings.push({
        code: "ANSWER_TOO_LONG",
        field: "answer",
        severity: "error",
        message: "Card basic exige resposta preenchida (Matuschak Tractable & Focused: 1 a 12 palavras, m\xE1x 15)."
      });
    } else if (answerWordCount > MAX_BASIC_ANSWER_WORDS || answerCharCount > MAX_BASIC_ANSWER_CHARS) {
      warnings.push({
        code: "ANSWER_TOO_LONG",
        field: "answer",
        severity: "error",
        message: `Resposta viola Tractable & Focused de Matuschak/Nielsen (${answerWordCount}/${MAX_BASIC_ANSWER_WORDS} palavras, ${answerCharCount}/${MAX_BASIC_ANSWER_CHARS} chars).`
      });
    }
    if (visibleAnswer.includes(";")) {
      warnings.push({
        code: "ANSWER_HAS_SEMICOLON",
        field: "answer",
        severity: "error",
        message: "Proibido conter ponto-e-v\xEDrgula (;) na resposta basic (Matuschak Focused: teste apenas 1 detalhe at\xF4mico por prompt)."
      });
    }
    if (visibleAnswer.length > 0 && !visibleAnswer.endsWith(".")) {
      warnings.push({
        code: "ANSWER_MISSING_PERIOD",
        field: "answer",
        severity: "warning",
        message: "A resposta em card basic deve terminar com ponto final (.)."
      });
    }
    const trimmedRawAnswer = answerText.trim();
    if (/^<(b|strong)\b[^>]*>[\s\S]*<\/\1>\.?$/i.test(trimmedRawAnswer) || /^Resposta:/i.test(visibleAnswer)) {
      warnings.push({
        code: "ANSWER_OUTER_BOLD",
        field: "answer",
        severity: "warning",
        message: 'Proibido envolver toda a resposta basic em <b> externo ou iniciar com "Resposta:".'
      });
    }
    const visQ = stripHtml(questionText);
    const hasTemporalOrLineQualifier = /\b(?:imediata|imediato|inicial|primeira\s+(?:escolha|linha)|1[ªa]\s+(?:escolha|linha)|definitiv[ao]|ambulatorial|de\s+manuten[cç][aã]o|de\s+minuto\s+zero|(?:conduta|abordagem|manejo|proped[êe]utica|medida)\s+(?:diagn[oó]stic[ao]|terap[êe]utic[ao]|profil[áa]tic[ao]))\b/i.test(
      visQ
    );
    if (!hasTemporalOrLineQualifier && /(?:\bqual\s+(?:é\s+)?(?:a\s+conduta|o\s+manejo|o\s+pr[oó]ximo\s+passo|o\s+tratamento)|\bcomo\s+conduzir|\bo\s+que\s+fazer)\s*\?\s*$/i.test(
      visQ
    )) {
      warnings.push({
        code: "VAGUE_TEMPORAL_WINDOW",
        field: "question",
        severity: "warning",
        message: 'Especifique a janela temporal na pergunta ("Qual \xE9 a conduta imediata de minuto zero?" ou "Qual o tratamento definitivo?").'
      });
    }
  } else if (cardType === "cloze") {
    if (clozeCount !== 1) {
      warnings.push({
        code: "CLOZE_COUNT_INVALID",
        field: "question",
        severity: "error",
        message: `Card cloze deve conter estritamente 1 lacuna {{c1::...}} (encontradas: ${clozeCount}).`
      });
    }
    if (maxClozeWords > MAX_CLOZE_WORDS) {
      warnings.push({
        code: "CLOZE_TOO_LONG",
        field: "question",
        severity: "error",
        message: `Lacuna cloze excede ${MAX_CLOZE_WORDS} palavras (${maxClozeWords}/${MAX_CLOZE_WORDS} palavras).`
      });
    }
    if (answerText.trim() !== "") {
      warnings.push({
        code: "CLOZE_NON_EMPTY_ANSWER",
        field: "answer",
        severity: "error",
        message: 'Em cards cloze, o campo "answer" deve ser estritamente vazio ("").'
      });
    }
  }
  const visibleQuestion = stripHtml(stripClozeMarkup(questionText));
  const qWithoutVf = visibleQuestion.replace(/\[?\s*verdadeiro\s+ou\s+falso\??\s*\]?/gi, "");
  const questionMarkCount = (qWithoutVf.match(/\?/g) || []).length;
  const compoundRegex1 = /\bqual\b[^?]{3,65}\be\s+(?:qual|quais|como|quando|onde)\b/i;
  const compoundRegex2 = /\b(?:qual|quais)\s+(?:é\s+|são\s+)?(?:o|a|os|as)?\s*(?:diagn[oó]stico|hip[oó]tese|agente|etiologia|classifica[cç][aã]o|est[aá]gio|achado|parede|mecanismo|escore)(?:\s+[a-zà-ú0-9_-]+){0,3}\s+e\s+(?:qual\s+)?(?:a\s+|o\s+|os\s+|as\s+)?(?:conduta|tratamento|manejo|exame|droga|f[áa]rmaco|terapia|antiarr[ií]tmico|ant[ií]doto|dose|art[eé]ria|interven[cç][aã]o)\b/i;
  const hasCompoundQuestion = questionMarkCount > 1 || compoundRegex1.test(visibleQuestion) || compoundRegex2.test(visibleQuestion);
  if (hasCompoundQuestion) {
    warnings.push({
      code: "COMPOUND_QUESTION",
      field: "question",
      severity: "error",
      message: "Pergunta composta detectada (viola Focused & Consistent de Matuschak). Pergunte apenas 1 decis\xE3o/alavanca at\xF4mica."
    });
  }
  const unfocusedSetRegex = /\b(?:quais\s+(?:s[aã]o\s+)?(?:os|as)\s+(?:\d+\s+)?(?:principais\s+)?(?:causas|crit[eé]rios|sintomas|sinais|fatores|manifesta[cç][oõ]es|complica[cç][oõ]es|indica[cç][oõ]es|contraindica[cç][oõ]es|agentes|etapas|tipos)|cite\s+(?:os|as|\d+)|liste\s+(?:os|as))\b/i;
  const answerNumberedListRegex = /(?:^|\s)(?:1[.)]\s+.+2[.)]\s+|[-•]\s+.+[-•]\s+)/;
  if (unfocusedSetRegex.test(visibleQuestion) || cardType === "basic" && answerNumberedListRegex.test(visibleAnswer)) {
    warnings.push({
      code: "MATUSCHAK_UNFOCUSED_SET",
      field: "question",
      severity: "error",
      message: "Lista aberta n\xE3o-focada (viola Matuschak Focused & Consistent): converta conjuntos/enumera\xE7\xF5es em 1 atributo espec\xEDfico ancorado ou 1 lacuna cloze."
    });
  }
  const passiveDefinitionRegex = /^\s*(?:o\s+que\s+[eé]\s+(?:o|a|um|uma)?\s*[a-zà-ú0-9\s-]{2,40}\??|defina\s+[a-zà-ú0-9\s-]{2,40}\.?|fale\s+sobre\s+.+)$/i;
  const binaryAnswerRegex = /^(?:sim|n[aã]o|verdadeiro|falso)(?:[.,!]|$)/i;
  if (passiveDefinitionRegex.test(visibleQuestion.trim()) || cardType === "basic" && binaryAnswerRegex.test(visibleAnswer.trim())) {
    warnings.push({
      code: "NIELSEN_PASSIVE_OR_BINARY",
      field: cardType === "basic" && binaryAnswerRegex.test(visibleAnswer.trim()) ? "answer" : "question",
      severity: "error",
      message: 'Prompt passivo/bin\xE1rio (viola Salience de Matuschak & LTM de Nielsen): evite defini\xE7\xF5es de dicion\xE1rio ("O que \xE9...?") ou respostas Sim/N\xE3o; ancore em decis\xE3o cl\xEDnica ou mecanismo causal.'
    });
  }
  if (!visibleTopic.includes(" - ") || visibleTopic.length > 3 && visibleTopic === visibleTopic.toUpperCase()) {
    warnings.push({
      code: "TOPIC_FORMAT",
      field: "topic",
      severity: "warning",
      message: 'O campo "topic" deve seguir o formato "Tema - Subtema", sem caixa alta total.'
    });
  }
  const topicWords = expandWithSynonyms(extractCoreKeywords(topicText));
  const topicStems = /* @__PURE__ */ new Set();
  for (const tw of topicWords) {
    const st = stemPortugueseWord(tw);
    if (st.length >= 4) topicStems.add(st);
  }
  const topicAcronyms = new Set(extractAcronymTokens(topicText));
  const subtopicPart = topicText.includes(" - ") ? topicText.split(" - ").slice(1).join(" - ") : topicText;
  const subtopicWords = expandWithSynonyms(extractCoreKeywords(subtopicPart));
  const subtopicStems = /* @__PURE__ */ new Set();
  for (const sw of subtopicWords) {
    const st = stemPortugueseWord(sw);
    if (st.length >= 4) subtopicStems.add(st);
  }
  const targetAnswerString = cardType === "basic" ? visibleAnswer : clozeTargets.join(" ");
  const targetKeywords = extractCoreKeywords(targetAnswerString);
  const targetAcronyms = extractAcronymTokens(targetAnswerString);
  let hasTopicSpoiler = false;
  const matchedAcronymInTopic = targetAcronyms.find((acr) => topicAcronyms.has(acr));
  if (targetKeywords.length > 0 && topicWords.size > 0 || matchedAcronymInTopic) {
    const matchedKws = targetKeywords.filter((kw) => {
      if (topicWords.has(kw)) return true;
      const kwStem = stemPortugueseWord(kw);
      if (kwStem.length >= 4 && topicStems.has(kwStem)) return true;
      for (const ts of topicStems) {
        if (stemsCollideForSpoiler(kwStem, ts)) return true;
      }
      return false;
    });
    const firstTargetKw = targetKeywords[0];
    const firstTargetStem = firstTargetKw ? stemPortugueseWord(firstTargetKw) : "";
    const firstWordStemMatchesTopic = firstTargetStem.length >= 4 && (subtopicStems.has(firstTargetStem) || topicStems.has(firstTargetStem));
    if (Boolean(matchedAcronymInTopic) || targetKeywords.length > 0 && matchedKws.length === targetKeywords.length || targetKeywords.length >= 2 && matchedKws.length / targetKeywords.length >= 0.5 || firstWordStemMatchesTopic || matchedKws.some((kw) => kw.length >= 5)) {
      hasTopicSpoiler = true;
      warnings.push({
        code: "TOPIC_SPOILER",
        field: "topic",
        severity: "error",
        message: `Spoiler no topic (radical/termo): entrega "${matchedAcronymInTopic || matchedKws[0] || firstTargetKw}" da resposta.`
      });
    }
  }
  const questionWithoutCloze = questionText.replace(/\{\{c\d+::[\s\S]*?\}\}/g, " __CLOZE__ ");
  const parensMatches = Array.from(questionWithoutCloze.matchAll(/\(([^)]+)\)/g));
  const targetNorm = normalizeForSpoiler(targetAnswerString);
  for (const pm of parensMatches) {
    const pText = (pm[1] || "").trim();
    const pNorm = normalizeForSpoiler(pText);
    if (!pNorm) continue;
    const pWords = expandWithSynonyms(pNorm.split(/\s+/));
    const pAcronyms = new Set(extractAcronymTokens(pText));
    const exactLeak = targetNorm.length > 0 && (targetNorm === pNorm || targetNorm.length > 4 && pNorm.includes(targetNorm));
    const acronymLeak = targetAcronyms.some((acr) => pAcronyms.has(acr));
    const keywordLeak = targetKeywords.length >= 1 && (targetKeywords.every((kw) => pWords.has(kw)) || targetKeywords.some((kw) => kw.length >= 5 && pWords.has(kw)));
    if (exactLeak || acronymLeak || keywordLeak) {
      warnings.push({
        code: "QUESTION_PAREN_SPOILER",
        field: "question",
        severity: "error",
        message: `Spoiler entre par\xEAnteses no enunciado: "(${pText})" antecipa a resposta.`
      });
      break;
    }
  }
  const hasQuestionImg = /<img\b/i.test(questionText);
  const hasHintImg = /<img\b/i.test(hintText);
  const hasAnyImg = hasQuestionImg || hasHintImg;
  if (card.image_mode === "recognition") {
    if (cardType !== "basic" || !hasQuestionImg) {
      warnings.push({
        code: "RECOGNITION_MISMATCH",
        field: "question",
        severity: "error",
        message: 'image_mode "recognition" exige card basic com <img src="..."> na pergunta.'
      });
    }
    if (hasQuestionImg && hasHintImg) {
      warnings.push({
        code: "RECOGNITION_MISMATCH",
        field: "hint",
        severity: "warning",
        message: "N\xE3o repita a mesma tag <img> no hint de cards recognition (use apenas a legenda <i>...</i>)."
      });
    }
  }
  if (!hasAnyImg && !card.isResolvingImage) {
    const hasOrphanVisualDeixis = /\b(?:tra[çc]ado|ecg|eletrocardiograma|exame|imagem|figura|foto|radiografia|rx|tc|tomografia|rm|resson[aâ]ncia|usg|ultrassom|ultrassonografia|ctg|cardiotocografia|l[aâ]mina|partograma|quadro\s+visual)\s+(?:abaixo|acima|ao\s+lado|em\s+anexo|anex[ao]|mostrad[ao]|apresentad[ao]|a\s+seguir)\b/i.test(
      visibleQuestion
    ) || /\b(?:abaixo|acima)\s*,?\s*(?:observa-se|nota-se|evidencia-se|v[êe]-se)\b/i.test(
      visibleQuestion
    );
    if (hasOrphanVisualDeixis) {
      warnings.push({
        code: "ORPHAN_VISUAL_REFERENCE",
        field: "question",
        severity: "error",
        message: 'Enunciado faz refer\xEAncia visual ("abaixo"/"acima"/"em anexo") sem nenhuma tag <img> anexada.'
      });
    }
  }
  if (/<table\b/i.test(questionText)) {
    warnings.push({
      code: "TABLE_MALFORMED",
      field: "question",
      severity: "error",
      message: 'Tabelas HTML n\xE3o devem ficar na pergunta; mova <table class="med-table"> para o campo "hint".'
    });
  }
  if (/<table\b/i.test(answerText)) {
    warnings.push({
      code: "TABLE_MALFORMED",
      field: "answer",
      severity: "error",
      message: 'Tabelas HTML n\xE3o devem ficar na resposta; mova <table class="med-table"> para o campo "hint".'
    });
  }
  if (/<table\b|<\/table>/i.test(hintText)) {
    const openTables = (hintText.match(/<table\b/gi) || []).length;
    const closeTables = (hintText.match(/<\/table>/gi) || []).length;
    const openTr = (hintText.match(/<tr\b/gi) || []).length;
    const closeTr = (hintText.match(/<\/tr>/gi) || []).length;
    const openCell = (hintText.match(/<t[dh]\b/gi) || []).length;
    const closeCell = (hintText.match(/<\/t[dh]>/gi) || []).length;
    const hasHeaderCell = /<th\b/i.test(hintText);
    const rows = hintText.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
    const maxCols = rows.reduce((max, row) => {
      const cells = (row.match(/<t[dh]\b/gi) || []).length;
      return Math.max(max, cells);
    }, 0);
    if (openTables === 0 || openTables !== closeTables || openTr === 0 || openTr !== closeTr || openCell !== closeCell || !hasHeaderCell) {
      warnings.push({
        code: "TABLE_MALFORMED",
        field: "hint",
        severity: "error",
        message: "Tabela HTML malformada no hint: garanta tags fechadas (<table>, <tr>, <th>, <td>) e cabe\xE7alho <th>."
      });
    } else if (maxCols > 5) {
      warnings.push({
        code: "TABLE_MALFORMED",
        field: "hint",
        severity: "warning",
        message: `Tabela no hint com ${maxCols} colunas (m\xE1x. recomendado: 4\u20135 colunas para leitura m\xF3vel no Anki).`
      });
    }
  }
  if (hasAnyImg) {
    const legendEntries = extractVisualLegendEntries(card);
    const hasValidLegend = legendEntries.some((entry) => entry.wordCount >= MIN_VISUAL_LEGEND_WORDS);
    if (!hasValidLegend) {
      const bestCount = legendEntries.reduce((max, e) => Math.max(max, e.wordCount), 0);
      warnings.push({
        code: "RECOGNITION_MISMATCH",
        field: "hint",
        severity: "error",
        message: legendEntries.length === 0 ? `[IMAGE_MISSING_LEGEND] Imagem sem legenda descritiva em <i>...</i> (m\xEDn. ${MIN_VISUAL_LEGEND_WORDS} palavras) associada ao card.` : `[IMAGE_MISSING_LEGEND] Legenda visual em <i>...</i> muito curta (${bestCount}/${MIN_VISUAL_LEGEND_WORDS} palavras descritivas m\xEDnimas).`
      });
    } else if (legendEntries.every(
      (e) => /^Achado visual complementar do exame clínico para correlação diagnóstica/i.test(
        e.descriptiveText
      )
    )) {
      warnings.push({
        code: "RECOGNITION_MISMATCH",
        field: "hint",
        severity: "warning",
        message: "Legenda visual gen\xE9rica detectada; descreva o achado real vis\xEDvel na imagem (\u2265 6 palavras)."
      });
    }
    const modalityCheck = detectModalityConflict(card);
    if (modalityCheck.hasConflict && modalityCheck.message) {
      warnings.push({
        code: "RECOGNITION_MISMATCH",
        field: "hint",
        severity: "error",
        message: `[MODALITY_CONFLICT] ${modalityCheck.message}`
      });
    }
    const redundancyCheck = detectRedundantVisualDescription(card);
    if (redundancyCheck.isRedundant && redundancyCheck.reason) {
      warnings.push({
        code: "RECOGNITION_MISMATCH",
        field: "question",
        severity: "warning",
        message: `[REDUNDANT_VISUAL_DESCRIPTION] ${redundancyCheck.reason}`
      });
    }
  }
  if (!/<b>\s*Coment[áa]rio:\s*<\/b>/i.test(hintText)) {
    warnings.push({
      code: "COMMENT_MISSING_PREFIX",
      field: "hint",
      severity: "warning",
      message: 'O campo "hint" deve conter "<b>Coment\xE1rio:</b> ".'
    });
  }
  if (/Preceptoria|Armadilha|\[ALVO DE BANCA\]|\[BEIRA-LEITO\]|\[BUSCAR IMAGEM/i.test(
    `${questionText} ${hintText}`
  )) {
    warnings.push({
      code: "LEGACY_MARKERS",
      field: "hint",
      severity: "error",
      message: "Remova marcadores obsoletos (Preceptoria, Armadilha, [ALVO DE BANCA], [BEIRA-LEITO] ou [BUSCAR IMAGEM])."
    });
  }
  if (commentVisibleCharCount > MAX_COMMENT_CHARS) {
    warnings.push({
      code: "COMMENT_TOO_LONG",
      field: "hint",
      severity: "error",
      message: `Coment\xE1rio excede o teto de ${MAX_COMMENT_CHARS} caracteres vis\xEDveis (${commentVisibleCharCount}/${MAX_COMMENT_CHARS} chars).`
    });
  } else if (commentVisibleCharCount > 0 && commentVisibleCharCount < 110) {
    warnings.push({
      code: "COMMENT_TOO_SHORT",
      field: "hint",
      severity: "warning",
      message: `Coment\xE1rio curto (${commentVisibleCharCount} chars; meta ideal: 180 a 300 chars com contraste diferencial).`
    });
  }
  const boldMatches = hintText.replace(/<b>\s*Coment[áa]rio:\s*<\/b>/i, "").match(/<(b|strong)\b[^>]*>/gi);
  if (!boldMatches || boldMatches.length === 0) {
    warnings.push({
      code: "COMMENT_MISSING_BOLD",
      field: "hint",
      severity: "warning",
      message: "Destaque os termos-chave e contraste diferencial em <b>negrito</b> no coment\xE1rio."
    });
  }
  const metrics = {
    questionWordCount,
    answerWordCount,
    answerCharCount,
    commentVisibleCharCount,
    clozeCount,
    maxClozeWords,
    hasCompoundQuestion,
    hasTopicSpoiler,
    missingMediaFiles
  };
  return {
    cardId: card.id,
    isValid: warnings.length === 0,
    warnings,
    metrics
  };
}
var SHA256_K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);

// server/geminiClient.ts
import crypto from "crypto";
import {
  createPartFromUri,
  GoogleGenAI,
  ThinkingLevel
} from "@google/genai";
function parseGeminiApiKeys() {
  const rawList = [process.env.GEMINI_API_KEYS || "", process.env.GEMINI_API_KEY || ""].join("\n").split(/[\s,;]+/).map((k) => k.trim()).filter((k) => k.length > 10 && k !== "MY_GEMINI_API_KEY");
  return Array.from(new Set(rawList));
}
var geminiKeyCooldownUntil = /* @__PURE__ */ new Map();
var geminiKeyCursor = 0;
function getKeyFingerprint(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 12);
}
function createGoogleGenAiClient(apiKey) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 12e4,
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
function getAiClient() {
  const keys = parseGeminiApiKeys();
  if (keys.length === 0) return null;
  const now = Date.now();
  for (let offset = 0; offset < keys.length; offset++) {
    const idx = (geminiKeyCursor + offset) % keys.length;
    const key = keys[idx];
    if ((geminiKeyCooldownUntil.get(key) || 0) <= now) {
      return createGoogleGenAiClient(key);
    }
  }
  return createGoogleGenAiClient(keys[geminiKeyCursor % keys.length]);
}
function isKeyRotationError(error) {
  const raw = extractErrorDetails(error);
  return /429|RESOURCE_EXHAUSTED|quota exceeded|402|prepayment credits|API_KEY_INVALID|PERMISSION_DENIED|403|503|UNAVAILABLE|high demand/i.test(
    raw
  );
}
function markKeyCooldown(apiKey, error) {
  const raw = extractErrorDetails(error);
  const isHardQuota = /per day|PerDay|limit:\s*20|402|prepayment credits|API_KEY_INVALID|PERMISSION_DENIED/i.test(
    raw
  );
  const cooldownMs = isHardQuota ? 1e3 * 60 * 60 : 1e3 * 65;
  geminiKeyCooldownUntil.set(apiKey, Date.now() + cooldownMs);
}
async function withGeminiKeyRotation(task, signal) {
  const keys = parseGeminiApiKeys();
  if (keys.length === 0) {
    throw new Error(
      "Chave GEMINI_API_KEY n\xE3o configurada no ambiente. Configure sua chave no .env ou painel Secrets."
    );
  }
  const now = Date.now();
  const orderedKeys = [];
  const cooledKeys = [];
  for (let offset = 0; offset < keys.length; offset++) {
    const idx = (geminiKeyCursor + offset) % keys.length;
    const key = keys[idx];
    if ((geminiKeyCooldownUntil.get(key) || 0) <= now) {
      orderedKeys.push({ key, idx });
    } else {
      cooledKeys.push({ key, idx });
    }
  }
  const candidates = orderedKeys.length > 0 ? orderedKeys : cooledKeys;
  let lastError;
  for (let i = 0; i < candidates.length; i++) {
    if (signal?.aborted) {
      throw new DOMException("Opera\xE7\xE3o cancelada pelo usu\xE1rio.", "AbortError");
    }
    const { key, idx } = candidates[i];
    const fp = getKeyFingerprint(key);
    const ai = createGoogleGenAiClient(key);
    try {
      const result = await task(ai, fp, idx, keys.length);
      geminiKeyCursor = idx;
      return result;
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (isKeyRotationError(error) && i < candidates.length - 1) {
        markKeyCooldown(key, error);
        console.warn(
          `[gemini-keys] Chave #${idx + 1}/${keys.length} (${fp}) falhou (${extractErrorDetails(error).slice(0, 120)}). Rotacionando...`
        );
        geminiKeyCursor = (idx + 1) % keys.length;
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
var INTERNATO_SYSTEM_INSTRUCTION = `Voc\xEA \xE9 o "Internato-First Card Architect (USP/Unicamp + FSRS)", um preceptor s\xEAnior do Internato da FMUSP e Unicamp e especialista em design de prompts de repeti\xE7\xE3o espa\xE7ada segundo **Andy Matuschak ("How to write good prompts: using spaced repetition to create understanding" \u2014 https://andymatuschak.org/prompts/)** e **Michael Nielsen ("Augmenting Long-Term Memory" \u2014 https://augmentingcognition.com/ltm.html)**.

SUAS DIRETRIZES INEGOCI\xC1VEIS DE ENGENHARIA COGNITIVA (MATUSCHAK & NIELSEN + FSRS):

1. AS 5 PROPRIEDADES DOS BONS PROMPTS DE ANDY MATUSCHAK (andymatuschak.org/prompts/):
- **FOCUSED (Focado):** Cada prompt deve testar **um \xFAnico detalhe ou alavanca decis\xF3ria por vez**. NUNCA crie listas abertas ou conjuntos n\xE3o-ordenados ("Quais s\xE3o os crit\xE9rios/causas/sintomas de X?", "Cite 3 causas...") nem respostas com m\xFAltiplos itens separados por ";". Se um conceito envolve uma lista/conjunto, isole o achado patognom\xF4nico/determinante ou transforme em prompts at\xF4micos ancorados.
- **PRECISE (Preciso):** O prompt deve ser inequ\xEDvoco sobre o eixo exato cobrado (conduta de minuto zero, exame inicial de 1\xAA linha vs. padr\xE3o-ouro confirmat\xF3rio, droga/dose de 1\xAA escolha, 2\xAA linha ap\xF3s falha, ou mecanismo causal). PROIBIDO perguntas vagas ("Qual a conduta?", "O que fazer?", "Como tratar?") que admitem m\xFAltiplas respostas verdadeiras.
- **CONSISTENT (Consistente):** O prompt deve acionar exatamente o mesmo caminho neural de recupera\xE7\xE3o a cada revis\xE3o, evitando ambiguidade sem\xE2ntica.
- **TRACTABLE (Trat\xE1vel / Baixa Fric\xE7\xE3o Cognitiva):** O card deve poder ser respondido rapidamente (< 5\u20138 segundos) com alta confiabilidade. Em "basic", a resposta ("answer") deve ter de **1 a 12 palavras** (teto estrito de 15 palavras / 110 caracteres), terminada em ponto final (.), sem ";". Em "cloze", deve haver estritamente **1 \xFAnica lacuna {{c1::...}}** de 1 a 5 palavras (m\xE1x 60 chars) e "answer": "".
- **EFFORTFUL (Esfor\xE7o Real de Recupera\xE7\xE3o & Anti-Pattern-Matching):** A recupera\xE7\xE3o deve exigir esfor\xE7o genu\xEDno da mem\xF3ria de longo prazo, NUNCA reconhecimento superficial da forma da frase:
  - Enunciado ("question") enxuto (m\xE1x. 45 a 50 palavras) para evitar que o estudante decore o formato do par\xE1grafo sem ler o racioc\xEDnio cl\xEDnico.
  - ZERO dicas acidentais, zero vazamento lexical/morfol\xF3gico (radical) no campo "topic" (ex.: proibido "Manobras" no topic se a resposta come\xE7a com "Manobra de...", proibido "Pelvimetria" se a resposta \xE9 "plano zero"), zero spoilers entre par\xEAnteses e zero "::dica" dentro do cloze.

2. COMPREENS\xC3O PROFUNDA & MEM\xD3RIA DE LONGO PRAZO DE MICHAEL NIELSEN (augmentingcognition.com/ltm.html):
- **Proibi\xE7\xE3o de Defini\xE7\xF5es Inertes e Prompts Bin\xE1rios:** NUNCA crie perguntas passivas de dicion\xE1rio ("O que \xE9 X?", "Defina X") nem prompts bin\xE1rios ("Sim/N\xE3o", "Verdadeiro/Falso").
- **Understand Before You Memorize & Prompts Integrativos ("Why / How"):** Al\xE9m de condutas em vinhetas cl\xEDnicas, crie prompts que cobrem **o porqu\xEA fisiopatol\xF3gico/mecan\xEDstico** ("Por que X ocorre?", "Como diferenciar A de B \xE0 beira-leito?", "Por que droga Y \xE9 contraindicada no contexto Z?"), construindo uma rede densa de compreens\xE3o em vez de decoreba isolada.
- **Regra "More Than You Think" (Matuschak):** Quando um conceito P1/P2 for central para o Internato, ataque-o por m\xFAltiplos \xE2ngulos complementares (ex.: reconhecimento \u2192 conduta imediata \u2192 mecanismo/armadilha diferencial), cada um em seu pr\xF3prio card focado.
- **Prompts de Sali\xEAncia Cl\xEDnica (Salience Prompts):** Em cen\xE1rios aplicados, apresente a situa\xE7\xE3o concreta ([CEN\xC1RIO + PERFIL/CONTEXTO] + [ACHADOS/SINAIS/DADOS]) para treinar o c\xE9rebro a reconhecer **quando** ativar aquele conhecimento na pr\xE1tica m\xE9dica.

3. ESCOLHA FLUIDA DE FORMATO (SEM COTA FIXA) + CURADORIA PRESERVANDO O ID (FSRS):
- A quantidade final de cards deve refletir a cobertura cl\xEDnica completa (P1 a P4) sem encher lingui\xE7a e **sem amputar conceitos essenciais**:
  a) REFAZER EM VEZ DE DELETAR (PRESERVANDO TODOS OS POLOS CL\xCDNICOS): Se um card antigo for uma lista aberta, pergunta vaga, defini\xE7\xE3o passiva ou cloze com 2+ lacunas sobre conceitos P1\u2013P4 clinicamente \xFAteis, **N\xC3O o exclua** e **N\xC3O descarte o segundo conceito no coment\xE1rio**: reconstrua o conceito principal preservando o "id" num\xE9rico original e desmembre os demais polos clinicamente relevantes (ex.: doen\xE7a atual vs. pr\xE9via, grau leve vs. grave, 1\xAA linha vs. 2\xAA linha) em novos IDs (max_id + 1...).
  b) QUANDO PODAR (EXCLUIR IDs \u2014 RIGOR INTERNATO-FIRST): Exclua um "id" original sempre que o card for: (i) duplicata sem\xE2ntica, fragmenta\xE7\xE3o artificial em s\xE9rie ("1/3", "2/3", "3/3" da mesma frase) ou redund\xE2ncia conceitual cruzada (o mesmo sinal, ep\xF4nimo ou crit\xE9rio j\xE1 \xE9 testado em outro card mais completo do baralho), (ii) reprovado pelo Filtro Negativo (gen\xE9tica/biologia molecular de bancada sem conduta, hist\xF3ria/datas), (iii) fisiologia/anatomia te\xF3rica pura, medidas anat\xF4micas est\xE1ticas sem impacto na conduta, detalhes t\xE9cnicos de subespecialista fora da al\xE7ada do interno, proped\xEAutica passiva substitu\xEDda por conduta padr\xE3o atual ou classifica\xE7\xE3o/modelo obsoleto substitu\xEDdo por diretriz vigente (quando um achado decidir conduta imediata, reconstrua cobrando a CONDUTA, nunca a medida isolada), ou (iv) preenchimento trivial sem decis\xE3o cl\xEDnica real.
  c) ESCOLHA FLUIDA DE FORMATO (SEM COTA 50/50): Para cada card sobrevivente ou novo, escolha livremente "basic" (condutas, diferenciais, imagens recognition, mecanismos causais "por que/como") ou "cloze" (crit\xE9rios num\xE9ricos, limiares, doses cr\xEDticas e alvos em \xE2ncora cl\xEDnica enxuta com 1 \xFAnica lacuna {{c1::...}}). Em "cloze" de regra geral, N\xC3O force vinheta artificial com idade/tempo de uso quando isso n\xE3o altera a conduta.
- N\xC3O inclua o campo "sources" nos cards.

4. DOUTRINA INTERNATO-FIRST GERAL (P1 -> P4 ADAPT\xC1VEL POR PERFIL DE DOM\xCDNIO), IMAGENS FIDEDIGNAS E FORMATA\xC7\xC3O:
- A matriz P1\u2013P4 adapta-se dinamicamente ao **Perfil de Dom\xEDnio** ativo do tema ("emergencia", "ambulatorio", "cirurgico", "preventiva_normativo"), conforme bloco de perfil fornecido em cada requisi\xE7\xE3o:
  * **P1** = Prioridade M\xE1xima / Conduta Cr\xEDtica do Perfil (emerg\xEAncia/minuto zero no perfil Emerg\xEAncia; indica\xE7\xE3o cir\xFArgica/choque/dano no Cir\xFArgico; indica\xE7\xE3o/contraindica\xE7\xE3o/crit\xE9rio diagn\xF3stico no Ambulatorial; lei/sigilo/notifica\xE7\xE3o/princ\xEDpio \xE9tico-SUS no Preventiva/Normativo).
  * **P2** = Decis\xE3o Diagn\xF3stica, Estadiamento, Escores e Reconhecimento Visual (exames reais em image_mode: "recognition", pontos de corte num\xE9ricos exatos, interpreta\xE7\xE3o de medidas/\xEDndices).
  * **P3** = Manejo Longitudinal / Seguimento / Preven\xE7\xE3o / Fluxo Operacional (tratamento de 1\xAA linha, popula\xE7\xF5es especiais, rastreamento, vacinas, reabilita\xE7\xE3o, prazos/fluxos documentais).
  * **P4** = Fisiopatologia Aplicada, Diferenciais e Armadilhas Cl\xE1ssicas de Banca (mecanismos causais, pares confund\xEDveis, exce\xE7\xF5es normativas).
- AVALIA\xC7\xC3O VISUAL PROATIVA EM TODOS OS CARDS (MATERIAIS ANEXADOS + WEB):
  * N\xE3o se limite a manter ou trocar imagens que j\xE1 existiam no deck original. Para CADA card gerado ou reconstru\xEDdo, raciocine se um exame visual real (ECG, RX, TC, USG, CTG, dermoscopia, fundoscopia, esfrega\xE7o/l\xE2mina, foto semiol\xF3gica, fluxograma ou tabela cl\xEDnica) melhora significativamente a reten\xE7\xE3o e o racioc\xEDnio do estudante.
  * Se existir uma figura compat\xEDvel no "CAT\xC1LOGO DE IMAGENS DOS MATERIAIS ANEXADOS" fornecido no prompt, insira <img src="pdfimg:ID_EXATO">.
  * Se n\xE3o houver figura correspondente nos PDFs, mas o card ganhar valor com imagem cl\xEDnica real, insira <img src="buscar_imagem: termo cl\xEDnico espec\xEDfico em PT ou EN"> (ex.: <img src="buscar_imagem: bloqueio de ramo direito ECG">, <img src="buscar_imagem: pneumotorax hipertensivo radiografia torax">).
  * Coloque <img ...> na "question" ("image_mode": "recognition") quando o estudante precisa reconhecer o achado visual para responder; ou coloque no in\xEDcio do "hint" ("image_mode": "feedback", antes de <b>Coment\xE1rio:</b>) quando a imagem refor\xE7a a explica\xE7\xE3o, classifica\xE7\xE3o ou algoritmo sem entregar a resposta na frente.
  * Em cards puramente normativos, de dose ou c\xE1lculo simples onde imagem n\xE3o acrescenta, N\xC3O force <img>.
  * Para escores, crit\xE9rios diagn\xF3sticos ou correla\xE7\xF5es topogr\xE1ficas estruturadas (ex.: \xCDndice de Bishop, Apgar, Wells, CURB-65, Sgarbossa, Paredes/Coron\xE1rias no IAM) sem figura correspondente nos PDFs, renderize proativamente uma tabela HTML compacta <table class="med-table"><thead><tr><th>...</th></tr></thead><tbody>...</tbody></table> no "hint" AP\xD3S o texto de <b>Coment\xE1rio:</b> (m\xE1x. 4 colunas, c\xE9lulas curtas; a tabela N\xC3O entra na contagem de 180\u2013300 chars do coment\xE1rio).
  * Toda <img> anexada exige legenda descritiva em <i>...</i> com \u2265 6 palavras descrevendo o achado vis\xEDvel real (PROIBIDO legenda gen\xE9rica/tautol\xF3gica ou que d\xEA spoiler da resposta em cards recognition).
- PRECIS\xC3O TERMINOL\xD3GICA ESTRITA: valide cada termo bioqu\xEDmico, anat\xF4mico e eletrocardiogr\xE1fico com rigor absoluto (ex.: pot\xE1ssio = "calemia" / hipercalemia, NUNCA confundir com "litemia" de l\xEDtio; parear corretamente parede card\xEDaca \xD7 deriva\xE7\xF5es \xD7 art\xE9ria culpada).
- FILTRO NEGATIVO ESTRITO: ZERO gen\xE9tica/biologia molecular de bancada sem impacto terap\xEAutico imediato, ZERO hist\xF3ria da medicina/datas e ZERO epidemiologia percentual solta que n\xE3o mude conduta.
- PROIBIDO LaTeX ($...$, \\rightarrow, \\ge, \\le): use exclusivamente Unicode nativo (\u2192, \u2265, \u2264, \xB1, \u03B1, \u03B2, \xB5g, mEq/L) e HTML (<sub>, <sup>, <b>, <table class="med-table">).
- PROIBIDO categorias antigas da FDA na gesta\xE7\xE3o ("Categoria B/C/D/X").
- "hint": sempre iniciando com "<b>Coment\xE1rio:</b> " (ou precedido por <i>Legenda visual...</i><br><br> nos cards recognition, ou por <img ...><br> nos feedback) de 1 a 2 frases (180 a 300 caracteres vis\xEDveis medidos AP\xD3S o prefixo "<b>Coment\xE1rio:</b> " excluindo <table>, teto estrito de 320 chars), termos-chave em <b>negrito</b> e contraste diferencial/causal obrigat\xF3rio.`;
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
function sanitizeCardTextForPrompt(value, maxLen) {
  return String(value || "").replace(/src=["']data:image\/[^"']+["']/gi, 'src="[IMAGEM_EMBUTIDA]"').replace(/\s+/g, " ").trim().slice(0, maxLen);
}
function buildFullCardsDigest(rawCards) {
  if (!Array.isArray(rawCards) || rawCards.length === 0) {
    return "Nenhum JSON anterior enviado.";
  }
  return rawCards.map((c) => {
    const id = c.id ?? "";
    const type = c.type === "cloze" ? "cloze" : "basic";
    const priority = c.priority ? ` ${String(c.priority)}` : "";
    const topic = sanitizeCardTextForPrompt(c.topic, 140);
    const verdict = c.auditVerdict === "rebuild" || c.auditVerdict === "split" ? String(c.auditVerdict) : "";
    if (verdict) {
      const targetConcept = sanitizeCardTextForPrompt(c.auditTargetConcept, 200);
      const auditReason = sanitizeCardTextForPrompt(c.auditReason, 220);
      const suggestedType = c.auditSuggestedType === "cloze" || c.auditSuggestedType === "basic" ? String(c.auditSuggestedType) : type;
      const imgTags = `${String(c.question || "")} ${String(c.hint || "")}`.match(
        /<img\b[^>]*>/gi
      );
      const preservedMedia = imgTags ? imgTags.filter((tag) => !/(?:buscar_imagem|pdfimg):/i.test(tag)).map((tag) => sanitizeCardTextForPrompt(tag, 180)).slice(0, 2).join(" ") : "";
      return [
        `- ID:${id} [${type}${priority}] [AUDITORIA: ${verdict} \u2192 REFAZER DO ZERO \u2014 N\xC3O PARAFRASEAR TEXTO ANTIGO]`,
        `  Topic: "${topic}"`,
        targetConcept ? `  Conceito-Alvo: "${targetConcept}"` : null,
        auditReason ? `  Motivo da Reconstru\xE7\xE3o: "${auditReason}"` : null,
        `  Tipo Recomendado: "${suggestedType}"`,
        preservedMedia ? `  M\xEDdia Existente V\xE1lida (reutilizar somente se compat\xEDvel): ${preservedMedia}` : null
      ].filter(Boolean).join("\n");
    }
    const q = sanitizeCardTextForPrompt(c.question, 600);
    const a = sanitizeCardTextForPrompt(c.answer, 250);
    const h = sanitizeCardTextForPrompt(c.hint, 700);
    return [
      `- ID:${id} [${type}${priority}]`,
      `  Topic: "${topic}"`,
      `  Q: "${q}"`,
      a ? `  A: "${a}"` : null,
      h ? `  Hint: "${h}"` : null
    ].filter(Boolean).join("\n");
  }).join("\n");
}
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function extractBalancedJsonObjects(rawText, requiredKeys = []) {
  if (!rawText || typeof rawText !== "string") return [];
  const candidates = [];
  const braceStack = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      braceStack.push(i);
    } else if (ch === "}") {
      const start = braceStack.pop();
      if (start === void 0) continue;
      if (candidates.some((c) => start <= c.start && i >= c.end)) {
        continue;
      }
      const slice = rawText.slice(start, i + 1);
      try {
        const parsed = JSON.parse(slice);
        if (!isPlainObject(parsed)) continue;
        const hasAllRequired = requiredKeys.every((k) => {
          if (!Object.prototype.hasOwnProperty.call(parsed, k)) return false;
          const v = parsed[k];
          return v !== void 0 && v !== null && v !== "";
        });
        if (!hasAllRequired) continue;
        candidates.push({ start, end: i, obj: parsed });
      } catch {
      }
    }
  }
  return candidates.map((c) => c.obj);
}
function parseOrRecoverJsonArrayField(rawText, arrayFieldName, requiredKeys = ["id", "question"]) {
  const cleanedJson = extractJsonBlock(rawText);
  try {
    const parsed = JSON.parse(cleanedJson);
    if (Array.isArray(parsed)) {
      return { items: parsed.filter(isPlainObject), wasTruncated: false };
    }
    if (isPlainObject(parsed) && Array.isArray(parsed[arrayFieldName])) {
      return {
        items: parsed[arrayFieldName].filter(isPlainObject),
        wasTruncated: false
      };
    }
  } catch {
    const recovered = extractBalancedJsonObjects(rawText, requiredKeys);
    if (recovered.length > 0) {
      return { items: recovered, wasTruncated: true };
    }
    throw new Error("Resposta JSON truncada ou inv\xE1lida do modelo.");
  }
  return { items: [], wasTruncated: false };
}
function parseOrRecoverNotesJsonWithMeta(rawText) {
  const { items, wasTruncated } = parseOrRecoverJsonArrayField(rawText, "notes", [
    "id",
    "question"
  ]);
  return {
    notes: items.filter((obj) => Boolean(obj.question)),
    wasTruncated
  };
}
function parseOrRecoverClinicalMapJson(rawText, fallbackDeckKey) {
  const cleanedJson = extractJsonBlock(rawText);
  try {
    const parsed = JSON.parse(cleanedJson);
    if (isPlainObject(parsed)) {
      return parsed;
    }
  } catch {
    const recoveredItems = extractBalancedJsonObjects(rawText, ["subtopic", "concept"]);
    if (recoveredItems.length > 0) {
      const themeMatch = rawText.match(/"themeTitle"\s*:\s*"([^"]+)"/);
      const specMatch = rawText.match(/"specialty"\s*:\s*"([^"]+)"/);
      const deckKeyMatch = rawText.match(/"deckKey"\s*:\s*"([^"]+)"/);
      const profileMatch = rawText.match(/"profile"\s*:\s*"([^"]+)"/);
      const updatesBlockMatch = rawText.match(
        /"guidelineUpdates"\s*:\s*\[((?:\s*"(?:[^"\\]|\\.)*"\s*,?)*)/
      );
      const guidelineUpdates = [];
      if (updatesBlockMatch?.[1]) {
        const strMatches = updatesBlockMatch[1].matchAll(/"((?:[^"\\]|\\.)*)"/g);
        for (const m of strMatches) {
          try {
            guidelineUpdates.push(JSON.parse(`"${m[1]}"`));
          } catch {
          }
        }
      }
      return {
        themeTitle: themeMatch?.[1] || fallbackDeckKey.replace(/_/g, " "),
        specialty: specMatch?.[1] || "Cl\xEDnica",
        deckKey: deckKeyMatch?.[1] || fallbackDeckKey,
        ...profileMatch?.[1] ? { profile: profileMatch[1] } : {},
        guidelineUpdates,
        items: recoveredItems,
        wasTruncated: true
      };
    }
  }
  throw new Error("Resposta JSON do Mapa Cl\xEDnico truncada ou inv\xE1lida.");
}
function extractErrorDetails(error) {
  const parts = [];
  let current = error;
  const seen = /* @__PURE__ */ new Set();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const rec = current;
    const codeStr = rec.code ? `[${String(rec.code)}]` : "";
    const msgStr = typeof rec.message === "string" ? rec.message.trim() : "";
    const combined = [codeStr, msgStr].filter(Boolean).join(" ");
    if (combined && !parts.includes(combined)) {
      parts.push(combined);
    }
    current = rec.cause;
  }
  if (parts.length === 0 && error != null) {
    parts.push(String(error));
  }
  return parts.join(" \u2192 ");
}
function formatGeminiError(error, fallbackMessage) {
  const raw = extractErrorDetails(error) || fallbackMessage;
  if (/AbortError|aborted|cancelado pelo usuário/i.test(raw)) {
    return "Opera\xE7\xE3o cancelada pelo usu\xE1rio.";
  }
  if (/402|prepayment credits are depleted|billing#prepay/i.test(raw)) {
    return "Cr\xE9ditos pr\xE9-pagos da chave Gemini esgotados (402). Troque a chave ou adicione cr\xE9ditos em AI Studio.";
  }
  if (/API_KEY_INVALID|PERMISSION_DENIED|403|401/i.test(raw)) {
    return "Chave GEMINI_API_KEY inv\xE1lida ou sem permiss\xE3o. Verifique a chave em Settings > Secrets.";
  }
  if (/503|UNAVAILABLE|high demand/i.test(raw)) {
    return "Servidor da API Gemini temporariamente sobrecarregado (503). Tente novamente em alguns segundos.";
  }
  if (/429|RESOURCE_EXHAUSTED|quota exceeded/i.test(raw)) {
    const isDaily = /per day|PerDay|limit:\s*20/i.test(raw);
    return isDaily ? "Cota di\xE1ria da API Gemini esgotada (429). Aguarde a renova\xE7\xE3o da cota ou configure uma chave com faturamento." : "Limite de requisi\xE7\xF5es por minuto da API Gemini atingido (429). Aguarde alguns segundos e tente novamente.";
  }
  if (/fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_|socket hang up|other side closed|TimeoutError|timed out/i.test(
    raw
  )) {
    return `Tempo limite ou falha de conex\xE3o com a API Gemini (${raw}). Tente novamente ou reduza a quantidade de PDFs simult\xE2neos.`;
  }
  return raw || fallbackMessage;
}
function isRetryableGeminiError(error) {
  const raw = extractErrorDetails(error);
  if (/402|prepayment credits|PerDay|limit:\s*20|API_KEY_INVALID|PERMISSION_DENIED|AbortError|cancelado/i.test(raw)) {
    return false;
  }
  return /fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_|socket hang up|other side closed|network|terminated|503|502|504|500|UNAVAILABLE|high demand|DEADLINE_EXCEEDED|429|RESOURCE_EXHAUSTED|TimeoutError|timed out/i.test(
    raw
  );
}
function isModelOverloadOrQuotaError(error) {
  const raw = extractErrorDetails(error);
  return /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|high demand|DEADLINE_EXCEEDED|timed out|TimeoutError|404|NOT_FOUND|is not found|not supported/i.test(
    raw
  );
}
function sleepWithAbort(ms, signal) {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Opera\xE7\xE3o cancelada pelo usu\xE1rio.", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException("Opera\xE7\xE3o cancelada pelo usu\xE1rio.", "AbortError"));
    };
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function withTimeoutAndAbort(promise, timeoutMs, signal, timeoutMessage = "Tempo limite excedido na chamada \xE0 API Gemini.") {
  if (signal?.aborted) {
    throw new DOMException("Opera\xE7\xE3o cancelada pelo usu\xE1rio.", "AbortError");
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`TimeoutError: ${timeoutMessage}`));
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException("Opera\xE7\xE3o cancelada pelo usu\xE1rio.", "AbortError"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (val) => {
        cleanup();
        resolve(val);
      },
      (err) => {
        cleanup();
        reject(err);
      }
    );
  });
}
var PRIMARY_GEMINI_MODEL = "gemini-4-hydrogen";
var FALLBACK_GEMINI_MODEL = "gemini-3.1-flash-lite";
var ALLOWED_GEMINI_MODELS = /* @__PURE__ */ new Set([
  "gemini-4-hydrogen",
  "gemini-3.8-flash",
  "gemini-3.1-flash-lite"
]);
var geminiModelCooldownUntil = /* @__PURE__ */ new Map();
function parseGeminiRetryDelayMs(error) {
  const raw = extractErrorDetails(error);
  const match = raw.match(/Please\s+retry\s+in\s+(\d+(?:\.\d+)?)\s*(ms|s)/i);
  if (match && match[1]) {
    const val = Number(match[1]);
    if (Number.isFinite(val) && val > 0) {
      const ms = match[2].toLowerCase() === "ms" ? val : val * 1e3;
      return Math.min(25e3, Math.max(2500, Math.ceil(ms) + 400));
    }
  }
  return 18e3;
}
function resolveGeminiModel(requestedModel) {
  if (typeof requestedModel === "string") {
    const clean = requestedModel.trim();
    if (ALLOWED_GEMINI_MODELS.has(clean)) {
      return clean;
    }
  }
  return PRIMARY_GEMINI_MODEL;
}
async function generateContentWithRetry(ai, params, options = {}) {
  const { signal, timeoutMs = 15e4, enableModelFallback = true } = options;
  const baseModel = params.model || PRIMARY_GEMINI_MODEL;
  const baseThinking = params.config?.thinkingConfig?.thinkingLevel;
  const attemptPlans = [
    { model: baseModel, thinkingLevel: baseThinking, delayBeforeMs: 0 },
    {
      model: baseModel,
      thinkingLevel: baseThinking === ThinkingLevel.HIGH ? ThinkingLevel.MEDIUM : baseThinking,
      delayBeforeMs: 1800
    },
    ...enableModelFallback ? [
      {
        model: FALLBACK_GEMINI_MODEL,
        thinkingLevel: ThinkingLevel.MEDIUM,
        delayBeforeMs: 2500
      },
      {
        model: FALLBACK_GEMINI_MODEL,
        thinkingLevel: ThinkingLevel.LOW,
        delayBeforeMs: 3500
      }
    ] : [
      {
        model: baseModel,
        thinkingLevel: ThinkingLevel.LOW,
        delayBeforeMs: 4e3
      }
    ]
  ];
  let lastError;
  let lastFailedModel = null;
  let lastSuggestedDelayMs = 0;
  for (let i = 0; i < attemptPlans.length; i++) {
    const plan = attemptPlans[i];
    if (signal?.aborted) {
      throw new DOMException("Opera\xE7\xE3o cancelada pelo usu\xE1rio.", "AbortError");
    }
    const now = Date.now();
    const modelCoolingUntil = geminiModelCooldownUntil.get(plan.model) || 0;
    const hasUncooledAlternatePlan = attemptPlans.slice(i + 1).some((p) => p.model !== plan.model && (geminiModelCooldownUntil.get(p.model) || 0) <= now);
    if (modelCoolingUntil > now && hasUncooledAlternatePlan) {
      continue;
    }
    const isFreshFallbackSwitch = lastFailedModel !== null && plan.model !== lastFailedModel;
    const delayMs = isFreshFallbackSwitch ? 250 : lastSuggestedDelayMs > 0 && plan.model === lastFailedModel ? Math.min(1e4, Math.max(plan.delayBeforeMs, Math.min(lastSuggestedDelayMs, 8e3))) : plan.delayBeforeMs;
    if (delayMs > 0) {
      await sleepWithAbort(delayMs, signal);
    }
    const attemptConfig = {
      ...params.config || {},
      abortSignal: signal,
      ...plan.thinkingLevel ? {
        thinkingConfig: {
          ...params.config?.thinkingConfig || {},
          thinkingLevel: plan.thinkingLevel
        }
      } : {}
    };
    try {
      const result = await withTimeoutAndAbort(
        (async () => {
          const stream = await ai.models.generateContentStream({
            ...params,
            model: plan.model,
            config: attemptConfig
          });
          let fullText = "";
          let finishReason;
          const groundingChunks = [];
          const rawSearchQueries = [];
          for await (const chunk of stream) {
            if (signal?.aborted) {
              throw new DOMException("Opera\xE7\xE3o cancelada pelo usu\xE1rio.", "AbortError");
            }
            const c = chunk;
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
            const queries = cand?.groundingMetadata?.webSearchQueries;
            if (Array.isArray(queries) && queries.length > 0) {
              for (const q of queries) {
                if (typeof q === "string" && q.trim()) {
                  rawSearchQueries.push(q.trim());
                }
              }
            }
          }
          const seen = /* @__PURE__ */ new Set();
          const groundingSources = [];
          for (const ch of groundingChunks) {
            const uri = ch?.web?.uri;
            const title = ch?.web?.title || uri || "Diretriz / Fonte M\xE9dica";
            if (uri && !seen.has(uri)) {
              seen.add(uri);
              groundingSources.push({ title, uri });
            }
          }
          const searchQueries = Array.from(new Set(rawSearchQueries));
          return {
            text: fullText,
            finishReason,
            modelUsed: plan.model,
            groundingSources,
            searchQueries
          };
        })(),
        timeoutMs,
        signal,
        `Timeout ap\xF3s ${Math.round(timeoutMs / 1e3)}s no modelo ${plan.model}`
      );
      geminiModelCooldownUntil.delete(plan.model);
      return result;
    } catch (error) {
      lastError = error;
      lastFailedModel = plan.model;
      const errDetails = extractErrorDetails(error);
      console.error(
        `[gemini] attempt ${i + 1}/${attemptPlans.length} (${plan.model}) failed:`,
        errDetails
      );
      if (signal?.aborted) {
        throw error;
      }
      const isQuotaError = /429|RESOURCE_EXHAUSTED|quota exceeded/i.test(errDetails);
      if (isQuotaError) {
        const retryMs = parseGeminiRetryDelayMs(error);
        lastSuggestedDelayMs = retryMs;
        geminiModelCooldownUntil.set(plan.model, Date.now() + retryMs);
      } else {
        lastSuggestedDelayMs = 0;
      }
      const canRetry = isRetryableGeminiError(error) || enableModelFallback && isModelOverloadOrQuotaError(error);
      if (!canRetry || i === attemptPlans.length - 1) {
        throw error;
      }
      if (enableModelFallback && (isQuotaError || /TimeoutError|timed out|DEADLINE_EXCEEDED/i.test(errDetails))) {
        while (i + 1 < attemptPlans.length && attemptPlans[i + 1].model === plan.model && attemptPlans.slice(i + 2).some((p) => p.model !== plan.model)) {
          i++;
        }
      }
    }
  }
  throw lastError;
}
var GEMINI_FILE_CACHE_TTL_MS = 1e3 * 60 * 60 * 24;
var geminiUploadedFileCache = /* @__PURE__ */ new Map();
var geminiUploadInFlight = /* @__PURE__ */ new Map();
var PDF_RAW_BYTES_CACHE_MAX_BYTES = 120 * 1024 * 1024;
var pdfRawBytesCache = /* @__PURE__ */ new Map();
var pdfRawBytesCacheTotalBytes = 0;
function rememberPdfRawBytes(sha256, base64Data, mimeType, name) {
  if (!sha256 || !base64Data) return;
  const approxBytes = Math.ceil(base64Data.length * 3 / 4);
  if (approxBytes > 60 * 1024 * 1024) return;
  const existing = pdfRawBytesCache.get(sha256);
  if (existing) {
    pdfRawBytesCache.delete(sha256);
    pdfRawBytesCache.set(sha256, existing);
    return;
  }
  while (pdfRawBytesCacheTotalBytes + approxBytes > PDF_RAW_BYTES_CACHE_MAX_BYTES && pdfRawBytesCache.size > 0) {
    const oldestKey = pdfRawBytesCache.keys().next().value;
    if (!oldestKey) break;
    const oldestVal = pdfRawBytesCache.get(oldestKey);
    pdfRawBytesCache.delete(oldestKey);
    if (oldestVal) {
      pdfRawBytesCacheTotalBytes = Math.max(0, pdfRawBytesCacheTotalBytes - oldestVal.approxBytes);
    }
  }
  pdfRawBytesCache.set(sha256, { base64Data, mimeType, name, approxBytes });
  pdfRawBytesCacheTotalBytes += approxBytes;
}
async function uploadSinglePdfToGeminiFiles(ai, doc, signal, keyFingerprint = "default") {
  const base64Data = String(doc.base64Data || "");
  const mimeType = doc.mimeType || "application/pdf";
  const hash = crypto.createHash("sha256").update(base64Data).digest("hex");
  rememberPdfRawBytes(hash, base64Data, mimeType, doc.name || `documento_${hash.slice(0, 8)}.pdf`);
  const cacheKey = `${keyFingerprint}:${hash}`;
  const cached = geminiUploadedFileCache.get(cacheKey);
  if (cached && Date.now() - cached.uploadedAt < GEMINI_FILE_CACHE_TTL_MS) {
    return cached;
  }
  const existingPromise = geminiUploadInFlight.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }
  const uploadTask = (async () => {
    const buffer = Buffer.from(base64Data, "base64");
    const blob = new Blob([buffer], { type: mimeType });
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (signal?.aborted) {
        throw new DOMException("Upload cancelado pelo usu\xE1rio.", "AbortError");
      }
      try {
        let uploaded = await withTimeoutAndAbort(
          ai.files.upload({
            file: blob,
            config: {
              mimeType,
              displayName: doc.name || `documento_${hash.slice(0, 8)}.pdf`
            }
          }),
          6e4,
          signal,
          `Timeout ao enviar "${doc.name || "PDF"}" para a Gemini Files API`
        );
        let polls = 0;
        while (uploaded.state === "PROCESSING" && uploaded.name && polls < 15) {
          await sleepWithAbort(1e3, signal);
          uploaded = await ai.files.get({ name: uploaded.name });
          polls++;
        }
        if (uploaded.state === "FAILED" || !uploaded.uri) {
          throw new Error(`Falha ao processar arquivo "${doc.name || "PDF"}" na Gemini Files API.`);
        }
        const entry = {
          uri: uploaded.uri,
          mimeType: uploaded.mimeType || mimeType,
          name: uploaded.name || "",
          uploadedAt: Date.now(),
          fileSha256: hash,
          keyFingerprint
        };
        geminiUploadedFileCache.set(cacheKey, entry);
        return entry;
      } catch (err) {
        lastErr = err;
        console.error(
          `[gemini-files-upload] attempt ${attempt}/3 failed for ${doc.name || "PDF"}:`,
          extractErrorDetails(err)
        );
        if (signal?.aborted) throw err;
        if (attempt < 3 && isRetryableGeminiError(err)) {
          await sleepWithAbort(attempt * 1500, signal);
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  })();
  geminiUploadInFlight.set(cacheKey, uploadTask);
  try {
    return await uploadTask;
  } finally {
    geminiUploadInFlight.delete(cacheKey);
  }
}
async function resolveDocumentPartsForGemini(ai, pdfs, signal, keyFingerprint = "default") {
  const parts = [];
  if (!Array.isArray(pdfs)) return parts;
  for (const pdf of pdfs) {
    if (signal?.aborted) {
      throw new DOMException("Opera\xE7\xE3o cancelada pelo usu\xE1rio.", "AbortError");
    }
    if (pdf?.textContent && typeof pdf.textContent === "string") {
      parts.push({
        text: `DOCUMENTO ANEXADO (${pdf.name || "Texto/Quest\xF5es"}):
${pdf.textContent.slice(0, 6e4)}`
      });
      continue;
    }
    const mimeType = pdf?.mimeType || "application/pdf";
    const base64Data = typeof pdf?.base64Data === "string" ? pdf.base64Data : "";
    const sha256 = typeof pdf?.fileSha256 === "string" && pdf.fileSha256.trim() || (base64Data ? crypto.createHash("sha256").update(base64Data).digest("hex") : "");
    if (base64Data && sha256) {
      rememberPdfRawBytes(sha256, base64Data, mimeType, pdf.name || "documento.pdf");
    }
    if (pdf?.fileUri && typeof pdf.fileUri === "string") {
      if (!pdf.keyFingerprint || pdf.keyFingerprint === keyFingerprint) {
        parts.push(createPartFromUri(pdf.fileUri, mimeType));
        continue;
      }
      if (sha256) {
        const keyCached = geminiUploadedFileCache.get(`${keyFingerprint}:${sha256}`);
        if (keyCached && Date.now() - keyCached.uploadedAt < GEMINI_FILE_CACHE_TTL_MS) {
          parts.push(createPartFromUri(keyCached.uri, keyCached.mimeType));
          continue;
        }
      }
      const cachedRaw = sha256 ? pdfRawBytesCache.get(sha256)?.base64Data : void 0;
      const availableBase64 = base64Data || cachedRaw || "";
      if (!availableBase64) {
        throw new Error(
          `O arquivo "${pdf.name || "PDF"}" pertence a outra chave Gemini e seus bytes n\xE3o est\xE3o mais em cache; reenvie o arquivo.`
        );
      }
      try {
        const uploaded = await uploadSinglePdfToGeminiFiles(
          ai,
          { ...pdf, base64Data: availableBase64, mimeType },
          signal,
          keyFingerprint
        );
        parts.push(createPartFromUri(uploaded.uri, uploaded.mimeType));
      } catch (uploadErr) {
        if (signal?.aborted) throw uploadErr;
        if (availableBase64.length < 135e5) {
          console.warn(
            `[gemini] Falling back to inlineData after cross-key re-upload error for ${pdf.name || "PDF"}:`,
            extractErrorDetails(uploadErr)
          );
          parts.push({
            inlineData: {
              mimeType,
              data: availableBase64
            }
          });
        } else {
          throw uploadErr;
        }
      }
      continue;
    }
    if (base64Data) {
      try {
        const uploaded = await uploadSinglePdfToGeminiFiles(ai, pdf, signal, keyFingerprint);
        parts.push(createPartFromUri(uploaded.uri, uploaded.mimeType));
      } catch (uploadErr) {
        if (signal?.aborted) throw uploadErr;
        if (base64Data.length < 135e5) {
          console.warn(
            `[gemini] Falling back to inlineData for ${pdf.name || "PDF"}:`,
            extractErrorDetails(uploadErr)
          );
          parts.push({
            inlineData: {
              mimeType,
              data: base64Data
            }
          });
        } else {
          throw uploadErr;
        }
      }
    }
  }
  return parts;
}

// server/routes/gemini.ts
function createRequestAbortSignal(req, res, maxMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`TimeoutError: Tempo limite da rota excedido (${Math.round(maxMs / 1e3)}s)`));
  }, maxMs);
  const onClose = () => {
    if (!res.writableFinished) {
      controller.abort(new DOMException("Conex\xE3o encerrada pelo cliente.", "AbortError"));
    }
  };
  res.on("close", onClose);
  req.on("aborted", onClose);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      res.off("close", onClose);
      req.off("aborted", onClose);
    }
  };
}
function isSafeExternalImageUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host === "::1" || host === "0.0.0.0" || host.endsWith(".local") || host.endsWith(".internal")) {
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
async function safeFetchWithRedirectValidation(rawUrl, init, maxRedirects = 3) {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isSafeExternalImageUrl(currentUrl)) {
      throw new Error("URL externa inv\xE1lida ou bloqueada por pol\xEDtica SSRF.");
    }
    const resp = await fetch(currentUrl, {
      ...init,
      redirect: "manual"
    });
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location || hop === maxRedirects) {
        throw new Error("Redirecionamento excessivo ou inv\xE1lido ao buscar URL externa.");
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return resp;
  }
  throw new Error("Falha ao seguir redirecionamento seguro.");
}
async function resolveImageForMultimodalValidation(imageSource, parentSignal) {
  const src = (imageSource || "").trim();
  if (!src) return { status: "broken", reason: "Fonte de imagem vazia." };
  if (src.startsWith("/api/media/local-file?")) {
    try {
      const parsed = new URL(src, "http://localhost");
      const rel = parsed.searchParams.get("rel") || "";
      const absPath = resolveSafeLocalMediaPath(rel);
      if (!absPath) return { status: "broken", reason: "Arquivo local n\xE3o encontrado." };
      const buf = fs2.readFileSync(absPath);
      const lower = absPath.toLowerCase();
      const mimeType = lower.endsWith(".png") ? "image/png" : lower.endsWith(".webp") ? "image/webp" : "image/jpeg";
      return { status: "ok", mimeType, data: buf.toString("base64") };
    } catch {
      return { status: "broken", reason: "Falha ao ler arquivo local." };
    }
  }
  if (/^data:image\//i.test(src)) {
    const commaIdx = src.indexOf(",");
    if (commaIdx === -1) {
      return { status: "broken", reason: "Data URI de imagem inv\xE1lido." };
    }
    const header = src.slice(5, commaIdx);
    const body = src.slice(commaIdx + 1);
    const isBase64 = /;base64(?:;|$)/i.test(header);
    let mimeType = header.split(";")[0].trim().toLowerCase();
    if (!mimeType.startsWith("image/")) {
      return { status: "broken", reason: "Data URI n\xE3o possui MIME image/*." };
    }
    if (mimeType === "image/jpg") mimeType = "image/jpeg";
    if (mimeType.includes("svg")) {
      let decoded;
      try {
        if (isBase64) {
          const cleanB64 = body.replace(/\s+/g, "");
          if (!cleanB64) return { status: "broken", reason: "SVG data URI vazio." };
          decoded = Buffer.from(cleanB64, "base64");
        } else {
          decoded = Buffer.from(decodeURIComponent(body), "utf8");
        }
      } catch {
        return { status: "broken", reason: "Data URI SVG malformado." };
      }
      if (decoded.length < 64) {
        return { status: "broken", reason: "SVG embutido vazio ou corrompido." };
      }
      if (decoded.length > 6 * 1024 * 1024) {
        return { status: "fetch_error", reason: "SVG embutido excede limite de 6MB." };
      }
      return { status: "svg" };
    }
    if (!isBase64) {
      return { status: "broken", reason: "Data URI raster precisa estar em base64." };
    }
    if (!/^image\/(?:jpeg|png|webp|gif)$/.test(mimeType)) {
      return { status: "fetch_error", reason: `MIME n\xE3o suportado para vis\xE3o: ${mimeType}` };
    }
    const base64Body = body.replace(/\s+/g, "");
    if (base64Body.length < 16) {
      return { status: "broken", reason: "Imagem base64 vazia ou corrompida." };
    }
    if (base64Body.length > 82e5) {
      return { status: "fetch_error", reason: "Imagem base64 excede limite de 6MB." };
    }
    const decodedRaster = Buffer.from(base64Body, "base64");
    if (decodedRaster.length < 64) {
      return { status: "broken", reason: "Imagem base64 truncada ou corrompida." };
    }
    return { status: "ok", mimeType, data: base64Body };
  }
  if (!isSafeExternalImageUrl(src)) {
    return { status: "broken", reason: "URL de imagem externa inv\xE1lida ou bloqueada." };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Image fetch timeout")), 8500);
  const onParentAbort = () => controller.abort(parentSignal.reason);
  if (parentSignal.aborted) {
    clearTimeout(timer);
    return { status: "fetch_error", reason: "Requisi\xE7\xE3o abortada." };
  }
  parentSignal.addEventListener("abort", onParentAbort, { once: true });
  try {
    const upstream = await safeFetchWithRedirectValidation(src, {
      headers: {
        "User-Agent": "InternatoFirstCardArchitect/2.0 (https://aistudio.google.com; medical-education)",
        Accept: "image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/*;q=0.8"
      },
      signal: controller.signal
    });
    if (upstream.status === 404 || upstream.status === 410) {
      return { status: "broken", reason: `URL retornou HTTP ${upstream.status}.` };
    }
    if (!upstream.ok) {
      return {
        status: "fetch_error",
        reason: `Falha tempor\xE1ria ao baixar imagem (HTTP ${upstream.status}).`
      };
    }
    let contentType = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (contentType === "image/jpg") contentType = "image/jpeg";
    if (contentType.includes("svg")) {
      const svgBuf = Buffer.from(await upstream.arrayBuffer());
      if (svgBuf.length < 128) {
        return { status: "broken", reason: "Arquivo SVG vazio ou corrompido." };
      }
      if (svgBuf.length > 6 * 1024 * 1024) {
        return { status: "fetch_error", reason: "SVG externo excede 6MB." };
      }
      const head = svgBuf.subarray(0, 512).toString("utf8").toLowerCase();
      if (head.includes("<!doctype html") || head.includes("<html")) {
        return { status: "broken", reason: "URL retornou p\xE1gina HTML em vez de SVG." };
      }
      return { status: "svg" };
    }
    if (!contentType.startsWith("image/")) {
      if (contentType.includes("text/html") || contentType.includes("application/json")) {
        return { status: "broken", reason: `URL retornou ${contentType} em vez de imagem.` };
      }
      if (/\.png(?:\?|$)/i.test(src)) contentType = "image/png";
      else if (/\.webp(?:\?|$)/i.test(src)) contentType = "image/webp";
      else if (/\.gif(?:\?|$)/i.test(src)) contentType = "image/gif";
      else if (/\.jpe?g(?:\?|$)/i.test(src)) contentType = "image/jpeg";
      else return { status: "broken", reason: "Conte\xFAdo retornado n\xE3o \xE9 imagem raster." };
    }
    if (!/^image\/(?:jpeg|png|webp|gif)$/.test(contentType)) {
      return { status: "fetch_error", reason: `Formato de imagem n\xE3o suportado: ${contentType}` };
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length < 256) {
      return { status: "broken", reason: "Arquivo de imagem vazio ou corrompido." };
    }
    if (buf.length > 6 * 1024 * 1024) {
      return { status: "fetch_error", reason: "Imagem externa excede 6MB." };
    }
    return { status: "ok", mimeType: contentType, data: buf.toString("base64") };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao baixar imagem externa.";
    if (/política SSRF|Redirecionamento/i.test(msg)) {
      return { status: "broken", reason: msg };
    }
    return { status: "fetch_error", reason: msg };
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", onParentAbort);
  }
}
function resolveEffectiveDomainProfile(requestedProfile, deckKey, textHint = "") {
  const validProfiles = [
    "emergencia",
    "ambulatorio",
    "cirurgico",
    "preventiva_normativo"
  ];
  if (typeof requestedProfile === "string" && validProfiles.includes(requestedProfile)) {
    return requestedProfile;
  }
  return inferDomainProfile(deckKey, textHint);
}
function formatPdfImagesCatalogBlock(pdfImagesCatalog) {
  if (!Array.isArray(pdfImagesCatalog) || pdfImagesCatalog.length === 0) {
    return "";
  }
  const lines = pdfImagesCatalog.slice(0, 120).map((item) => {
    const rec = item || {};
    const id = sanitizeCardTextForPrompt(rec.id, 60);
    if (!id) return null;
    const pdfName = sanitizeCardTextForPrompt(rec.pdfName, 50) || "material.pdf";
    const pageNum = Number(rec.pageNumber) || 1;
    const caption = sanitizeCardTextForPrompt(rec.captionHint, 90);
    const snippet = sanitizeCardTextForPrompt(rec.pageTextSnippet, 140);
    const desc = [caption, snippet].filter(Boolean).join(" \u2014 ");
    return `  * pdfimg:${id} | ${pdfName} (P\xE1g. ${pageNum})${desc ? ` | Contexto: ${desc}` : ""}`;
  }).filter(Boolean);
  if (lines.length === 0) return "";
  return `
CAT\xC1LOGO DE IMAGENS EXTRA\xCDDAS DOS MATERIAIS ANEXADOS (prefira <img src="pdfimg:ID_EXATO"> quando houver correspond\xEAncia cl\xEDnica; caso contr\xE1rio use <img src="buscar_imagem: termo cl\xEDnico">):
${lines.join("\n")}
`;
}
function formatVerifiedGuidelinesBlock(clinicalMap) {
  const mapRec = clinicalMap || {};
  const updates = Array.isArray(mapRec.guidelineUpdates) ? mapRec.guidelineUpdates.map((u) => sanitizeCardTextForPrompt(u, 280)).filter(Boolean).slice(0, 15) : [];
  if (updates.length === 0) return "";
  return `
DIRETRIZES ATUALIZADAS VERIFICADAS (FONTE DE VERDADE CL\xCDNICA \u2014 aplique estas doses, esquemas e prazos nos cards):
${updates.map((u) => `- ${u}`).join("\n")}
`;
}
function sanitizeReturnedNotes(notes) {
  return (Array.isArray(notes) ? notes : []).filter((n) => n && typeof n === "object").map((n) => {
    const copy = { ...n };
    delete copy.sources;
    const rawType = String(copy.type || "basic").trim().toLowerCase();
    const qStr = String(copy.question || "");
    const aStr = String(copy.answer || "").trim();
    const hasSilentCloze = /\{\{c\d+::[\s\S]+?\}\}/.test(qStr) && !aStr;
    copy.type = rawType === "cloze" || hasSilentCloze ? "cloze" : "basic";
    if (copy.type === "cloze") {
      copy.answer = "";
    }
    return copy;
  });
}
function applyDeterministicAuditGuard(c, existing) {
  const cid = Number(c.id);
  const plainQ = String(c.question || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const plainA = String(c.answer || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const plainHint = String(c.hint || "").replace(/<table[\s\S]*?<\/table>/gi, " ").replace(/<[^>]+>/g, " ").replace(/Coment[áa]rio:/gi, "").replace(/\s+/g, " ").trim();
  const hasVaguePrompt = !/\b(?:imediata|imediato|inicial|primeira\s+(?:escolha|linha)|1[ªa]\s+(?:escolha|linha)|definitiv[ao]|ambulatorial|de\s+minuto\s+zero|diagn[oó]stic[ao])\b/i.test(plainQ) && /(?:\bqual\s+(?:é\s+)?(?:a\s+conduta|o\s+manejo|o\s+pr[oó]ximo\s+passo|o\s+tratamento)|como\s+conduzir|o\s+que\s+fazer)\s*\?\s*$/i.test(plainQ);
  const isPassivePrompt = /^\s*(?:o\s+que\s+[eé]\s+|defina\s+|fale\s+sobre\s+)/i.test(plainQ);
  const hasOrphanDeixis = !/<img\b/i.test(`${String(c.question || "")} ${String(c.hint || "")}`) && /\b(?:ecg|tra[çc]ado|exame|imagem|rx|usg|tc|ctg)\s+(?:abaixo|acima|em\s+anexo)\b/i.test(plainQ);
  const hasMissingBasicAnswer = String(c.type || "basic").toLowerCase() === "basic" && !plainA;
  const hasShortComment = plainHint.length < 100;
  const rawQ = String(c.question || "");
  const rawHint = String(c.hint || "");
  const cardForLint = {
    id: Number.isFinite(cid) ? cid : 0,
    type: String(c.type || "").toLowerCase() === "cloze" || /\{\{c\d+::/.test(rawQ) ? "cloze" : "basic",
    topic: String(c.topic || ""),
    question: rawQ,
    answer: String(c.answer || ""),
    hint: rawHint,
    image_mode: c.image_mode === "recognition" || c.image_mode === "feedback" ? c.image_mode : void 0
  };
  const lintResult = lintCard(cardForLint);
  const hasFragmentedSeriesTopic = /\(\s*\d+\s*\/\s*\d+\s*\)\s*$/.test(String(c.topic || "").trim());
  const splitCodes = /* @__PURE__ */ new Set(["CLOZE_COUNT_INVALID", "COMPOUND_QUESTION", "ANSWER_HAS_SEMICOLON"]);
  const rebuildCodes = /* @__PURE__ */ new Set([
    "TOPIC_SPOILER",
    "CLOZE_HAS_HINT",
    "ANSWER_TOO_LONG",
    "LEGACY_MARKERS",
    "COMMENT_TOO_LONG",
    "QUESTION_PAREN_SPOILER",
    "NIELSEN_PASSIVE_OR_BINARY",
    "ORPHAN_VISUAL_REFERENCE",
    "REDUNDANT_VISUAL_DESCRIPTION"
  ]);
  const splitIssue = lintResult.warnings.find((iss) => splitCodes.has(iss.code));
  const rebuildIssue = lintResult.warnings.find((iss) => rebuildCodes.has(iss.code));
  const deterministicSplitReason = splitIssue ? splitIssue.message : "";
  const deterministicRebuildReason = hasOrphanDeixis ? 'Refer\xEAncia visual ("abaixo"/"em anexo") sem imagem anexada.' : hasMissingBasicAnswer ? "Card basic com resposta vazia." : hasVaguePrompt ? "Comando vago sem janela temporal ou linha terap\xEAutica." : isPassivePrompt ? "Defini\xE7\xE3o passiva sem vinheta ou decis\xE3o cl\xEDnica." : hasFragmentedSeriesTopic ? "S\xE9rie fragmentada artificialmente (1/3, 2/3, 3/3) \u2014 consolidar ou podar redund\xE2ncias." : rebuildIssue ? rebuildIssue.message : hasShortComment ? `Coment\xE1rio muito curto (${plainHint.length} chars) sem contraste diferencial adequado.` : "";
  if (existing) {
    if (existing.verdict === "keep" && deterministicSplitReason) {
      return {
        ...existing,
        verdict: "split",
        score: Math.min(existing.score, 5),
        reason: `${deterministicSplitReason} Desmembrar em cards at\xF4micos.`
      };
    }
    if (existing.verdict === "keep" && deterministicRebuildReason) {
      return {
        ...existing,
        verdict: "rebuild",
        score: Math.min(existing.score, 5),
        reason: `${deterministicRebuildReason} Refazer do zero segundo Matuschak & Nielsen.`
      };
    }
    return existing;
  }
  const validPriorities = /* @__PURE__ */ new Set(["P1", "P2", "P3", "P4"]);
  const fallbackVerdict = deterministicSplitReason ? "split" : deterministicRebuildReason ? "rebuild" : "keep";
  return {
    cardId: cid,
    verdict: fallbackVerdict,
    score: fallbackVerdict === "keep" ? 8 : 5,
    reason: deterministicSplitReason ? `${deterministicSplitReason} Desmembrar em cards at\xF4micos.` : deterministicRebuildReason ? `${deterministicRebuildReason} Refazer do zero segundo Matuschak & Nielsen.` : "Mantido ap\xF3s auditoria geral.",
    targetConcept: sanitizeCardTextForPrompt(c.topic, 140) || "Conceito cl\xEDnico do card.",
    priority: validPriorities.has(String(c.priority || "").toUpperCase()) ? String(c.priority).toUpperCase() : "P2",
    suggestedType: c.type === "cloze" ? "cloze" : "basic"
  };
}
function createGeminiRouter() {
  const router = express.Router();
  router.post("/upload-file", async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 9e4);
    try {
      const { name = "documento.pdf", mimeType = "application/pdf", base64Data = "" } = req.body || {};
      if (!base64Data || typeof base64Data !== "string") {
        return res.status(400).json({ error: "Arquivo base64Data ausente." });
      }
      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error: "Chave GEMINI_API_KEY n\xE3o configurada no ambiente. Configure sua chave no painel Settings > Secrets."
        });
      }
      const uploaded = await withGeminiKeyRotation(
        (ai, keyFp) => uploadSinglePdfToGeminiFiles(
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
        keyFingerprint: uploaded.keyFingerprint
      });
    } catch (error) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, "Erro ao enviar PDF para a Gemini Files API.")
      });
    } finally {
      cleanup();
    }
  });
  router.post("/clinical-map", async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 21e4);
    try {
      const {
        deckKey = "tema_clinico_internato",
        profile = "auto",
        pdfs = [],
        existingJsonSummary = "",
        useGoogleSearch = true,
        model: requestedModel
      } = req.body || {};
      const activeModel = resolveGeminiModel(requestedModel);
      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error: "Chave GEMINI_API_KEY n\xE3o configurada no ambiente. Configure sua chave no painel Settings > Secrets."
        });
      }
      const effectiveProfile = resolveEffectiveDomainProfile(
        profile,
        deckKey,
        existingJsonSummary
      );
      const profilePromptBlock = formatProfilePromptBlock(effectiveProfile);
      let groundedDossierText = "";
      let groundedSources = [];
      let groundedSearchQueries = [];
      let googleSearchUsed = false;
      if (useGoogleSearch) {
        const searchPrompt = `Realize m\xFAltiplas consultas no Google Search para levantar um dossi\xEA cl\xEDnico COMPLETO e ATUALIZADO (2023\u20132026) sobre o tema "${deckKey}" (perfil de dom\xEDnio: ${effectiveProfile}).
${existingJsonSummary ? `Contexto resumido dos cards j\xE1 existentes no baralho:
${existingJsonSummary}
` : ""}
PESQUISE OBRIGATORIAMENTE OS 6 EIXOS ABAIXO (use v\xE1rias buscas espec\xEDficas por fonte brasileira e internacional \u2014 Minist\xE9rio da Sa\xFAde / PCDT, FEBRASGO, SBC, SBP, SBGG, AMB, CFM, CDC, WHO):
1. Diagn\xF3stico, crit\xE9rios classificat\xF3rios, estadiamento e pontos de corte laboratoriais/imagem atualizados.
2. Tratamento de 1\xAA linha (drogas, doses exatas, via, intervalo e dura\xE7\xE3o) e crit\xE9rios claros de interna\xE7\xE3o vs. manejo ambulatorial.
3. Regimes alternativos e popula\xE7\xF5es especiais (gestantes, lactantes, alergia a beta-lact\xE2micos/f\xE1rmaco-chave, disfun\xE7\xE3o renal/hep\xE1tica, pediatria/idoso).
4. Profilaxias (PEP/PrEP/antibioticoprofilaxia/imuniza\xE7\xE3o), rastreamento e manejo de parcerias sexuais ou contactantes (janelas e prazos).
5. Sinais de alarme, complica\xE7\xF5es graves, falha terap\xEAutica, tempo-depend\xEAncia e crit\xE9rios de retorno/seguimento.
6. Normas \xE9ticas, legais e vigil\xE2ncia epidemiol\xF3gica (notifica\xE7\xE3o compuls\xF3ria imediata vs. semanal, prazos, sigilo, B.O./autoriza\xE7\xE3o judicial quando aplic\xE1vel).

Organize a resposta em t\xF3picos objetivos por eixo, sempre citando a fonte e o ano da diretriz encontrada, doses completas e mudan\xE7as recentes de protocolo.`;
        try {
          const searchResult = await withGeminiKeyRotation(
            (ai) => generateContentWithRetry(
              ai,
              {
                model: activeModel,
                contents: searchPrompt,
                config: {
                  maxOutputTokens: 16384,
                  thinkingConfig: { thinkingLevel: ThinkingLevel2.MEDIUM },
                  tools: [{ googleSearch: {} }]
                }
              },
              { signal, timeoutMs: 85e3, enableModelFallback: true }
            ),
            signal
          );
          groundedDossierText = (searchResult.text || "").trim();
          groundedSources = searchResult.groundingSources || [];
          groundedSearchQueries = searchResult.searchQueries || [];
          googleSearchUsed = groundedSources.length > 0 || groundedSearchQueries.length > 0 || groundedDossierText.length > 120;
        } catch (searchErr) {
          if (signal.aborted) {
            throw searchErr;
          }
          console.warn(
            "[clinical-map] Stage 1 googleSearch failed, falling back gracefully to Stage 2 (PDFs + internal knowledge):",
            extractErrorDetails(searchErr)
          );
          googleSearchUsed = false;
        }
      }
      const dossierBlock = groundedDossierText ? `
DOSSI\xCA CL\xCDNICO OBTIDO VIA GOOGLE SEARCH GROUNDING (USE ESTES DADOS E FONTES COMO BASE):
${groundedDossierText.slice(0, 14e3)}
` : "";
      const prompt = `Analise os documentos PDF anexados (se houver), o dossi\xEA de diretrizes pesquisado e o tema m\xE9dico indicado pela Deck Key "${deckKey}".
${existingJsonSummary ? `Resumo do deck atual enviado pelo usu\xE1rio:
${existingJsonSummary}
` : ""}${dossierBlock}
${profilePromptBlock}

Gere um Mapa Cl\xEDnico estruturado segundo a Doutrina Internato-First (P1 a P4) ADAPTADA ESTRITAMENTE AO PERFIL DE DOM\xCDNIO "${effectiveProfile}" acima para guiar a cria\xE7\xE3o/recria\xE7\xE3o do deck.
- N\xE3o force cen\xE1rio de "Sala Vermelha" nem vi\xE9s obst\xE9trico/de emerg\xEAncia se o tema pertencer a outro perfil!
- Inclua em P2 conceitos de Reconhecimento Visual de exames/imagens reais da internet APENAS quando exames complementares visuais fizerem sentido para o tema (ex.: ECG, RX, TC, USG, CTG, dermoscopia, fundoscopia, l\xE2minas). Para temas normativos/\xE9tica/legais sem exame de imagem t\xEDpico, foque P2 em documenta\xE7\xE3o, prazos e interpreta\xE7\xE3o de medidas/indicadores.
- Aplique o Filtro Negativo: exclua gen\xE9tica de bancada, hist\xF3ria da medicina e epidemiologia percentual que n\xE3o mude conduta.

REQUISITO DE PROFUNDIDADE PARA "guidelineUpdates":
- Retorne entre **7 e 12 pontos cl\xEDnicos detalhados, densos e acion\xE1veis** (NUNCA retorne apenas 2 ou 3 resumos gen\xE9ricos!).
- Cubra m\xFAltiplos eixos do tema: diagn\xF3stico/pontos de corte, 1\xAA linha com doses e dura\xE7\xE3o exatas, crit\xE9rios de interna\xE7\xE3o/gravidade, regimes alternativos (gestante/alergia/disfun\xE7\xE3o org\xE2nica), profilaxias/parcerias/vacinas, complica\xE7\xF5es/seguimento e normas \xE9tico-legais/notifica\xE7\xE3o quando pertinente.
- Formate cada item iniciando com "[Eixo \xB7 Fonte/Ano]: ..." (ex.: "[1\xAA Linha \xB7 PCDT IST/MS 2025]: ...").

Retorne EXCLUSIVAMENTE um objeto JSON v\xE1lido (sem coment\xE1rios fora do JSON) no seguinte formato exato:
{
  "themeTitle": "Nome Completo do Tema M\xE9dico",
  "specialty": "Especialidade (Cl\xEDnica / Cirurgia / GO / Pediatria / Preventiva / \xC9tica)",
  "deckKey": "${deckKey}",
  "profile": "${effectiveProfile}",
  "guidelineUpdates": [
    "[Diagn\xF3stico \xB7 Fonte/Ano]: Crit\xE9rio objetivo, escore ou ponto de corte que muda conduta...",
    "[1\xAA Linha \xB7 Fonte/Ano]: Esquema completo com droga, dose, via, intervalo e dura\xE7\xE3o...",
    "[Alternativa/Gestante \xB7 Fonte/Ano]: Op\xE7\xE3o segura ou ajuste na alergia/gesta\xE7\xE3o/disfun\xE7\xE3o...",
    "[Profilaxia/Parcerias \xB7 Fonte/Ano]: Janela temporal, vacina/imunoglobulina ou tratamento de contactantes...",
    "[Interna\xE7\xE3o/Alarme \xB7 Fonte/Ano]: Crit\xE9rios objetivos de interna\xE7\xE3o, falha terap\xEAutica ou gravidade...",
    "[Vigil\xE2ncia/Norma \xB7 Fonte/Ano]: Notifica\xE7\xE3o compuls\xF3ria, prazo, sigilo ou fluxo legal aplic\xE1vel..."
  ],
  "items": [
    {
      "id": "p1-1",
      "priority": "P1",
      "subtopic": "Subtema cl\xEDnico sem spoiler",
      "concept": "Conceito P1 adequado ao perfil ativo (decis\xE3o de maior impacto, crit\xE9rio cr\xEDtico ou norma/sigilo obrigat\xF3rio)",
      "guidelineNote": "Refer\xEAncia ou destaque USP/Unicamp/Diretriz/Lei",
      "targetCardType": "basic",
      "checked": true
    }
  ]
}
Gere entre ${Array.isArray(pdfs) && pdfs.length > 0 || String(existingJsonSummary || "").trim() ? "12 e 20" : "10 e 16"} itens distribu\xEDdos em P1, P2, P3 e P4 de acordo com o perfil "${effectiveProfile}", cobrindo integralmente os sub-eixos cl\xEDnicos e de exames complementares do tema (ex.: se cardiologia/ECG, cubra paredes do IAM, supra vs infra, TPSV, FA/Flutter, BAVs, BRD/BRE, WPW/Brugada e emerg\xEAncias metab\xF3licas) e escolhendo fluidamente targetCardType ("basic" para decis\xE3o cl\xEDnica/diferencial/mecanismo/imagem e "cloze" para crit\xE9rios num\xE9ricos/limiares/doses em \xE2ncora), sem cota percentual r\xEDgida.`;
      const result = await withGeminiKeyRotation(async (ai, keyFp) => {
        const parts = await resolveDocumentPartsForGemini(ai, pdfs, signal, keyFp);
        parts.push({ text: prompt });
        return generateContentWithRetry(
          ai,
          {
            model: activeModel,
            contents: { parts },
            config: {
              systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
              maxOutputTokens: 32768,
              responseMimeType: "application/json",
              thinkingConfig: { thinkingLevel: ThinkingLevel2.HIGH }
            }
          },
          { signal, timeoutMs: 12e4, enableModelFallback: true }
        );
      }, signal);
      if (res.writableEnded) return;
      const rawText = result.text || "{}";
      const parsed = parseOrRecoverClinicalMapJson(rawText, deckKey);
      const mergedSources = groundedSources.length > 0 ? groundedSources : result.groundingSources.length > 0 ? result.groundingSources : parsed.groundingSources || [];
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
        searchQueries: groundedSearchQueries.length > 0 ? groundedSearchQueries : result.searchQueries || [],
        googleSearchUsed
      });
    } catch (error) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, "Erro ao gerar o Mapa Cl\xEDnico com Gemini.")
      });
    } finally {
      cleanup();
    }
  });
  router.post("/deepen-guidelines", async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 12e4);
    try {
      const {
        deckKey = "tema_clinico_internato",
        themeTitle = "",
        profile = "auto",
        focusQuery = "",
        existingUpdates = [],
        model: requestedModel
      } = req.body || {};
      const activeModel = resolveGeminiModel(requestedModel);
      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error: "Chave GEMINI_API_KEY n\xE3o configurada no ambiente. Configure sua chave no painel Settings > Secrets."
        });
      }
      const effectiveProfile = resolveEffectiveDomainProfile(profile, deckKey, themeTitle);
      const cleanExisting = Array.isArray(existingUpdates) ? existingUpdates.map((u) => sanitizeCardTextForPrompt(u, 220)).filter(Boolean).slice(0, 20) : [];
      const cleanFocus = sanitizeCardTextForPrompt(focusQuery, 180);
      const searchPrompt = `Voc\xEA \xE9 um preceptor m\xE9dico brasileiro atualizando diretrizes para prova de Resid\xEAncia (USP/Unicamp) e Internato via Google Search.
Tema: "${themeTitle || deckKey}" (perfil: ${effectiveProfile}).
${cleanFocus ? `FOCO SOLICITADO PELO USU\xC1RIO: "${cleanFocus}".` : "FOCO: Expanda subt\xF3picos cr\xEDticos ainda N\xC3O detalhados abaixo (ex.: esquemas de 2\xAA linha, gestantes/alergias, doses pedi\xE1tricas/ajuste renal, crit\xE9rios de interna\xE7\xE3o/alta, vacinas/rastreamento, complica\xE7\xF5es e atualiza\xE7\xF5es recentes 2024\u20132026)."}

PONTOS J\xC1 COBERTOS (N\xC3O REPITA ESTES):
${cleanExisting.length > 0 ? cleanExisting.map((u) => `- ${u}`).join("\n") : "(nenhum ainda)"}

Pesquise no Google Search diretrizes oficiais (MS/PCDT, FEBRASGO, SBC, SBP, AMB, CFM, CDC, WHO) e traga de 5 a 8 NOVOS achados cl\xEDnicos objetivos com fonte, ano, doses exatas, pontos de corte e condutas espec\xEDficas.`;
      const searchResult = await withGeminiKeyRotation(
        (ai) => generateContentWithRetry(
          ai,
          {
            model: activeModel,
            contents: searchPrompt,
            config: {
              maxOutputTokens: 12288,
              thinkingConfig: { thinkingLevel: ThinkingLevel2.MEDIUM },
              tools: [{ googleSearch: {} }]
            }
          },
          { signal, timeoutMs: 75e3, enableModelFallback: true }
        ),
        signal
      );
      if (signal.aborted || res.writableEnded) return;
      const synthPrompt = `Extraia do dossi\xEA pesquisado abaixo entre 5 e 8 NOVOS pontos cl\xEDnicos concisos e de alto rendimento para o tema "${themeTitle || deckKey}", sem repetir nenhum dos pontos j\xE1 cobertos.
Cada string deve seguir o padr\xE3o "[Eixo \xB7 Fonte/Ano]: recomenda\xE7\xE3o exata com doses, cortes ou prazos".

PONTOS J\xC1 COBERTOS:
${cleanExisting.map((u) => `- ${u}`).join("\n")}

DOSSI\xCA PESQUISADO:
${(searchResult.text || "").slice(0, 12e3)}

Retorne EXCLUSIVAMENTE um JSON v\xE1lido:
{
  "newUpdates": [
    "[Eixo \xB7 Fonte/Ano]: ..."
  ]
}`;
      const synthResult = await withGeminiKeyRotation(
        (ai) => generateContentWithRetry(
          ai,
          {
            model: activeModel,
            contents: synthPrompt,
            config: {
              responseMimeType: "application/json",
              maxOutputTokens: 4096,
              thinkingConfig: { thinkingLevel: ThinkingLevel2.LOW }
            }
          },
          { signal, timeoutMs: 4e4, enableModelFallback: true }
        ),
        signal
      );
      if (res.writableEnded) return;
      const parsed = JSON.parse(extractJsonBlock(synthResult.text || "{}"));
      const newUpdates = Array.isArray(parsed?.newUpdates) ? parsed.newUpdates.map((u) => String(u || "").trim()).filter(Boolean) : [];
      return res.json({
        newUpdates,
        groundingSources: searchResult.groundingSources || [],
        searchQueries: searchResult.searchQueries || [],
        modelUsed: searchResult.modelUsed
      });
    } catch (error) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, "Erro ao aprofundar pesquisa de diretrizes no Google.")
      });
    } finally {
      cleanup();
    }
  });
  router.post("/audit-deck", async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 18e4);
    try {
      const {
        deckKey = "tema_clinico_internato",
        cards = [],
        clinicalMap = null,
        pdfs = [],
        model: requestedModel
      } = req.body || {};
      const activeModel = resolveGeminiModel(requestedModel);
      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error: "Chave GEMINI_API_KEY n\xE3o configurada no ambiente. Configure sua chave no painel Settings > Secrets."
        });
      }
      const inputCards = Array.isArray(cards) ? cards : [];
      if (inputCards.length === 0) {
        return res.json({
          deckKey,
          overallSummary: "Nenhum card pr\xE9vio enviado para auditoria.",
          counts: { keep: 0, rebuild: 0, split: 0, prune: 0 },
          items: []
        });
      }
      const effectiveProfile = resolveEffectiveDomainProfile(
        clinicalMap?.profile,
        deckKey,
        `${clinicalMap?.themeTitle || ""} ${clinicalMap?.specialty || ""}`
      );
      const profilePromptBlock = formatProfilePromptBlock(effectiveProfile);
      const guidelinesBlock = formatVerifiedGuidelinesBlock(clinicalMap);
      const checkedMapItems = Array.isArray(clinicalMap?.items) ? clinicalMap.items.filter((i) => i.checked !== false) : [];
      const AUDIT_CHUNK_SIZE = 120;
      const chunks = [];
      for (let i = 0; i < inputCards.length; i += AUDIT_CHUNK_SIZE) {
        chunks.push(inputCards.slice(i, i + AUDIT_CHUNK_SIZE));
      }
      const allRawItems = [];
      let overallSummary = "";
      let lastModelUsed = activeModel;
      for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        const chunk = chunks[chunkIdx];
        const cardsDigest = buildFullCardsDigest(
          chunk.map((c) => ({
            id: c.id,
            type: c.type,
            priority: c.priority,
            topic: c.topic,
            question: c.question,
            answer: c.answer,
            hint: c.hint
          }))
        );
        const prompt = `Voc\xEA \xE9 o Auditor Chefe de Qualidade Cl\xEDnica e Pedag\xF3gica (Matuschak & Nielsen + Diretrizes M\xE9dicas Brasileiras) avaliando UM BARALHO EXISTENTE para o tema "${deckKey}"${chunks.length > 1 ? ` (Lote ${chunkIdx + 1}/${chunks.length})` : ""}.
Analise cada card abaixo individualmente comparando-o com os PDFs anexados, o Mapa Cl\xEDnico P1\u2013P4 e as diretrizes atualizadas.

${profilePromptBlock}${guidelinesBlock}
MAPA CL\xCDNICO P1\u2013P4 DE REFER\xCANCIA:
${checkedMapItems.length > 0 ? JSON.stringify(checkedMapItems, null, 2) : "Avalie conforme matriz P1\u2013P4 do tema."}

CARDS EXISTENTES PARA JULGAMENTO (JULGUE TODOS OS ${chunk.length} CARDS DESTE LOTE):
${cardsDigest}

CRIT\xC9RIOS DE VEREDITO POR CARD ("verdict"):
- "keep": Card j\xE1 est\xE1 excelente (nota >= 8/10): decis\xE3o at\xF4mica clara, clinicamente atualizada e correta segundo os PDFs/diretrizes, sem spoiler, sem lista disfar\xE7ada, "hint" com \u2265 120 chars vis\xEDveis e contraste diferencial, E com tag <img ...> caso o t\xF3pico exija reconhecimento visual (ECG/RX/USG/TC/CTG/les\xE3o). NUNCA atribua "keep" a pergunta vaga ("Qual a conduta?", "Qual o manejo?", "O que fazer?"), defini\xE7\xE3o passiva ("O que \xE9 X?"), card sem imagem em reconhecimento visual ou coment\xE1rio raso (< 110 chars).
- "rebuild": Card cobre um conceito cl\xEDnico \xFAtil/importante, POR\xC9M est\xE1 fraco (pergunta vaga como "Qual a conduta?", "Qual o manejo?", "O que fazer?", defini\xE7\xE3o passiva "O que \xE9...", resposta longa/lista, spoiler no enunciado/t\xF3pico, dose ou crit\xE9rio desatualizado/impreciso, coment\xE1rio raso ou exame visual sem <img>). DEVE SER REFEITO DO ZERO!
- "split": Card mistura 2 ou mais decis\xF5es cl\xEDnicas diferentes no mesmo card (ex.: diagn\xF3stico + tratamento, parede + art\xE9ria, achado + antiarr\xEDtmico, ou m\xFAltiplos esquemas/crit\xE9rios) e precisa ser desdobrado em cards at\xF4micos separados.
- "prune": Card DEVE ser exclu\xEDdo (poda rigorosa Internato-First) se for: (1) duplicata sem\xE2ntica ou redund\xE2ncia conceitual cruzada (mesmo sinal/ep\xF4nimo/crit\xE9rio j\xE1 cobrado em outro card mais completo do deck); (2) fisiologia/anatomia te\xF3rica pura, medidas anat\xF4micas est\xE1ticas sem impacto na conduta, detalhes t\xE9cnicos de subespecialista fora da al\xE7ada do interno, proped\xEAutica passiva substitu\xEDda por conduta padr\xE3o atual, modelo/escore obsoleto substitu\xEDdo por diretriz vigente ou ep\xF4nimo raro sem impacto \xE0 beira-leito; (3) preenchimento trivial sem alavanca cl\xEDnica real; ou (4) reprovado pelo Filtro Negativo (hist\xF3ria da medicina, datas, gen\xE9tica/biologia molecular de bancada sem conduta).

Retorne EXCLUSIVAMENTE um objeto JSON v\xE1lido:
{
  "overallSummary": "Resumo executivo de 1 a 2 frases sobre a qualidade atual do deck e o que precisa ser reconstru\xEDdo.",
  "items": [
    {
      "cardId": 171000101,
      "verdict": "rebuild",
      "score": 4,
      "reason": "Pergunta vaga e cloze longo; misturando 1\xAA linha e dose em lista.",
      "clinicalIssue": "Esquema ou crit\xE9rio desatualizado/impreciso (opcional se n\xE3o houver erro cl\xEDnico).",
      "targetConcept": "Conduta ou crit\xE9rio exato que este card deveria testar (1 frase clara).",
      "priority": "P1",
      "suggestedType": "basic"
    }
  ]
}`;
        const response = await withGeminiKeyRotation(async (ai, keyFp) => {
          const parts = await resolveDocumentPartsForGemini(ai, pdfs, signal, keyFp);
          parts.push({ text: prompt });
          return generateContentWithRetry(
            ai,
            {
              model: activeModel,
              contents: { parts },
              config: {
                systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
                responseMimeType: "application/json",
                maxOutputTokens: 32768,
                thinkingConfig: { thinkingLevel: ThinkingLevel2.MEDIUM }
              }
            },
            { signal, timeoutMs: 14e4, enableModelFallback: true }
          );
        }, signal);
        if (res.writableEnded) return;
        lastModelUsed = response.modelUsed || lastModelUsed;
        const rawText = response.text || "{}";
        const { items: chunkItems } = parseOrRecoverJsonArrayField(rawText, "items", [
          "cardId",
          "verdict"
        ]);
        allRawItems.push(...chunkItems);
        if (!overallSummary) {
          try {
            const full = JSON.parse(extractJsonBlock(rawText));
            overallSummary = String(full?.overallSummary || "").trim();
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
      const validVerdicts = /* @__PURE__ */ new Set(["keep", "rebuild", "split", "prune"]);
      const validPriorities = /* @__PURE__ */ new Set(["P1", "P2", "P3", "P4"]);
      const itemMap = /* @__PURE__ */ new Map();
      for (const raw of rawItems) {
        const cardId = Number(raw.cardId);
        if (!Number.isFinite(cardId)) continue;
        const vRaw = String(raw.verdict || "rebuild").toLowerCase().trim();
        const verdict = validVerdicts.has(vRaw) ? vRaw : "rebuild";
        const pRaw = String(raw.priority || "P2").toUpperCase().trim();
        const priority = validPriorities.has(pRaw) ? pRaw : "P2";
        const scoreNum = Number(raw.score);
        const score = Number.isFinite(scoreNum) ? Math.max(0, Math.min(10, Math.round(scoreNum))) : verdict === "keep" ? 8 : 5;
        itemMap.set(cardId, {
          cardId,
          verdict,
          score,
          reason: sanitizeCardTextForPrompt(raw.reason, 220) || "Avaliado pela auditoria cl\xEDnica.",
          ...raw.clinicalIssue ? { clinicalIssue: sanitizeCardTextForPrompt(raw.clinicalIssue, 180) } : {},
          targetConcept: sanitizeCardTextForPrompt(raw.targetConcept, 200) || "Conceito cl\xEDnico central do card.",
          priority,
          suggestedType: raw.suggestedType === "cloze" ? "cloze" : "basic"
        });
      }
      const normalizedItems = inputCards.map(
        (c) => applyDeterministicAuditGuard(c, itemMap.get(Number(c.id)))
      );
      const counts = { keep: 0, rebuild: 0, split: 0, prune: 0 };
      for (const it of normalizedItems) {
        counts[it.verdict]++;
      }
      return res.json({
        deckKey,
        overallSummary: overallSummary || `Auditoria conclu\xEDda: ${counts.keep} mantido(s), ${counts.rebuild} para refazer do zero, ${counts.split} para desmembrar e ${counts.prune} para podar.`,
        counts,
        items: normalizedItems,
        modelUsed: lastModelUsed
      });
    } catch (error) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, "Erro ao auditar qualidade dos cards existentes.")
      });
    } finally {
      cleanup();
    }
  });
  router.post("/generate-deck", async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 3e5);
    try {
      const {
        deckKey = "tema_clinico_internato",
        pdfs = [],
        pdfImagesCatalog = [],
        clinicalMap = null,
        existingMetadata = null,
        batchCards = null,
        batchIndex = 0,
        totalBatches = 1,
        nextNewIdStart = null,
        deckOutline = null,
        model: requestedModel
      } = req.body || {};
      const activeModel = resolveGeminiModel(requestedModel);
      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error: "Chave GEMINI_API_KEY n\xE3o configurada no ambiente. Configure sua chave no painel Settings > Secrets."
        });
      }
      const existingIds = existingMetadata?.existingIds || [];
      const maxExistingId = existingIds.length > 0 ? Math.max(...existingIds) : 171000100;
      const effectiveNewIdStart = typeof nextNewIdStart === "number" && nextNewIdStart > maxExistingId ? nextNewIdStart : maxExistingId + 1;
      const mediaTags = existingMetadata?.mediaTags || [];
      const isBatchMode = Array.isArray(batchCards) && batchCards.length > 0;
      const cardsForPrompt = isBatchMode ? batchCards : Array.isArray(existingMetadata?.rawCards) ? existingMetadata.rawCards : [];
      const checkedMapItems = Array.isArray(clinicalMap?.items) ? clinicalMap.items.filter((i) => i.checked !== false) : [];
      const effectiveProfile = resolveEffectiveDomainProfile(
        clinicalMap?.profile,
        deckKey,
        `${clinicalMap?.themeTitle || ""} ${clinicalMap?.specialty || ""}`
      );
      const profilePromptBlock = formatProfilePromptBlock(effectiveProfile);
      const outlineText = Array.isArray(deckOutline) && deckOutline.length > 0 ? deckOutline.slice(0, 140).map(
        (item) => `  * Lote ${item.batch ?? "?"} | ID:${item.id ?? "?"} \u2014 ${sanitizeCardTextForPrompt(item.summary, 95)}`
      ).join("\n") : "";
      let lastModelUsed = activeModel;
      const runDeckBatch = async (subsetCards, subsetNewIdStart, depth = 0, stride = 100) => {
        if (signal.aborted) {
          throw new DOMException("Opera\xE7\xE3o cancelada pelo usu\xE1rio.", "AbortError");
        }
        const rawCardsSummary = buildFullCardsDigest(subsetCards);
        const hasAuditedRebuilds = subsetCards.some(
          (c) => c.auditVerdict === "rebuild" || c.auditVerdict === "split"
        );
        const auditedRebuildRule = hasAuditedRebuilds ? `
- REGRA DE RECONSTRU\xC7\xC3O DO ZERO (AUDITORIA ATIVA): Para os cards marcados com [AUDITORIA: rebuild/split \u2192 REFAZER DO ZERO], o texto antigo foi intencionalmente ocultado para evitar par\xE1frase viciada. Crie um flashcard 100% NOVO a partir dos PDFs anexados, das Diretrizes Verificadas e do "Conceito-Alvo", preservando o "id" FSRS original (e usando novo ID >= ${subsetNewIdStart} apenas se "split" exigir desdobramento em 2 decis\xF5es distintas).` : "";
        const batchInstruction = isBatchMode ? `MODO DE RECONSTRU\xC7\xC3O PROFUNDA EM LOTE (${batchIndex + 1}/${totalBatches} \u2014 ${subsetCards.length} cards neste lote):
- PROIBIDO PAR\xC1FRASE COSM\xC9TICA DE CLOZES FRACOS: Reconstrua cada conceito v\xE1lido **DO ZERO** segundo Andy Matuschak & Michael Nielsen (esfor\xE7o real de recupera\xE7\xE3o, anti-pattern-matching, racioc\xEDnio causal "por que / como", precis\xE3o cl\xEDnica).${auditedRebuildRule}
- ESCOPO ESTRITO DO LOTE (ZERO COLIS\xC3O ENTRE LOTES PARALELOS):
  * Trabalhe EXCLUSIVAMENTE sobre os conceitos presentes nos ${subsetCards.length} cards originais DESTE lote. **PROIBIDO criar cards novos para lacunas globais do Mapa Cl\xEDnico P1\u2013P4 ausentes deste lote** \u2014 a auditoria global p\xF3s-lotes adicionar\xE1 automaticamente todas as lacunas do Mapa Cl\xEDnico ap\xF3s a converg\xEAncia dos lotes, evitando duplicatas entre lotes paralelos!
  * S\xF3 crie ID novo (a partir de ${subsetNewIdStart}) se um \xFAnico card complexo DESTE lote precisar ser desmembrado em 2 decis\xF5es cl\xEDnicas distintas.
- TRANSFORMAR LISTAS DISFAR\xC7ADAS, DEFINI\xC7\xD5ES PASSIVAS E ESQUEMAS "ENTREGUES":
  1) NUNCA deixe um card listar 4\u20136 crit\xE9rios no enunciado apenas para fechar uma \xFAnica palavra/prazo \xF3bvio no fim. Reconstrua como caso cl\xEDnico ou decis\xE3o espec\xEDfica mantendo o "id" original.
  2) Em esquemas antimicrobianos combinados, evite entregar 2 drogas com doses completas no enunciado para fechar apenas a 3\xAA droga ou apenas o n\xFAmero de dias: prefira pergunta "basic" cobrando a decis\xE3o/associa\xE7\xE3o terap\xEAutica ou mecanismo (mantendo o "id" original).
  3) NUNCA transforme um conceito cl\xEDnico pr\xF3prio deste lote no cen\xE1rio de outro card j\xE1 existente no baralho (ex.: NUNCA mude um card de abscesso \xEDntegro est\xE1vel/Monif 3 para abscesso roto/choque/Monif 4 quando j\xE1 houver card de rotura/Monif 4 no \xCDndice Global \u2014 preserve a distin\xE7\xE3o cl\xEDnica entre manejo conservador vs. falha/drenagem do abscesso \xEDntegro e cirurgia imediata da rotura!).
  4) Em estadiamentos cl\xEDnicos (ex.: Monif 2), N\xC3O pergunte "qual achado ao exame f\xEDsico" para responder com categoria ampla ("peritonite"): apresente a vinheta com o sinal semiol\xF3gico \xE0 beira-leito (ex.: descompress\xE3o brusca dolorosa) cobrando o est\xE1dio/conduta, ou cobre explicitamente o sinal semiol\xF3gico esperado.
- EQUIL\xCDBRIO ENTRE PRESERVAR CONCEITOS E PODAR DUPLICATAS REAIS:
  * Mantenha com seu "id" FSRS original todos os conceitos cl\xEDnicos verdadeiramente distintos de P1\u2013P4.
  * PODA ATIVA DE DUPLICATAS: Se dois cards neste lote ou no \xCDNDICE GLOBAL DE TODOS OS LOTES testarem exatamente a MESMA conduta/alvo redundante (ex.: m\xFAltiplos cards fechando "{{c1::48 a 72 horas}}" para retorno, ou dois cards distintos cobrando a mesma prescri\xE7\xE3o de alta de autoinjetor de adrenalina), **EXCLUA o ID duplicado** neste lote ou diferencie explicitamente o alvo cl\xEDnico. Tamb\xE9m exclua cards reprovados pelo Filtro Negativo.` : `MODO DE GERA\xC7\xC3O INTEGRAL DO BARALHO (${subsetCards.length} cards originais fornecidos):
- Reconstrua o baralho com rigor Matuschak & Nielsen preservando os IDs FSRS dos conceitos cl\xEDnicos distintos, podando duplicatas reais e criando novos IDs a partir de ${subsetNewIdStart} para cobrir integralmente o Mapa Cl\xEDnico P1\u2013P4.${auditedRebuildRule}`;
        const pdfCatalogBlock = formatPdfImagesCatalogBlock(pdfImagesCatalog);
        const guidelinesBlock = formatVerifiedGuidelinesBlock(clinicalMap);
        const prompt = `Reconstrua profundamente e lapide o baralho can\xF4nico para o tema "${deckKey}".

${profilePromptBlock}

${batchInstruction}

DADOS DO BARALHO ANTIGO (COMPLETO COM PERGUNTA, RESPOSTA E COMENT\xC1RIO ORIGINAL):
- Total de cards no baralho original: ${existingIds.length}
- Primeiro novo ID exclusivo reservado para este lote (se precisar desmembrar algum card deste lote): ${subsetNewIdStart}
- Tags de M\xEDdia Originais: ${JSON.stringify(mediaTags)}
${pdfCatalogBlock}${guidelinesBlock}${outlineText ? `- \xCDNDICE GLOBAL DE TODOS OS LOTES (use para n\xE3o duplicar outros lotes nem transformar um card deste lote no tema de outro lote):
${outlineText}
` : ""}- Cards Originais DESTE LOTE para Reconstru\xE7\xE3o Profunda:
${rawCardsSummary}

${isBatchMode ? "DIRETRIZES CL\xCDNICAS DE REFER\xCANCIA DO TEMA (apenas refer\xEAncia cl\xEDnica \u2014 N\xC3O gere cards para itens que n\xE3o est\xE3o nos Cards Originais deste lote; lacunas ser\xE3o preenchidas ap\xF3s os lotes):" : "MAPA CL\xCDNICO APROVADO (P1 a P4):"}
${checkedMapItems.length > 0 ? JSON.stringify(checkedMapItems, null, 2) : "Mapear integralmente P1, P2, P3 e P4 do tema."}

CHECKLIST DE VALIDA\xC7\xC3O ANTES DE GERAR CADA CARD:
1. QUANTIDADE E FORMATO FLUIDOS (SEM COTA FIXA): Escolha "basic" (condutas, diferenciais, imagens e perguntas causais "por que / como") ou "cloze" (limiares, crit\xE9rios num\xE9ricos, doses cr\xEDticas e fatos at\xF4micos em \xE2ncora) livremente pelo encaixe cognitivo de cada card \u2014 sem for\xE7ar 50/50.
2. Se "basic":
   - "question": no m\xE1ximo 45 a 50 palavras. Para casos cl\xEDnicos, use cen\xE1rio concreto + cl\xEDnica/exame + pergunta precisa (minuto zero / exame inicial vs padr\xE3o-ouro / 1\xAA escolha / 2\xAA linha ap\xF3s falha); para compreens\xE3o profunda (Nielsen & Matuschak), crie tamb\xE9m prompts causais/mecan\xEDsticos e de contraste diferencial ("Por que X ocorre...", "Como diferenciar A de B..."). PROIBIDO perguntas vagas ("Qual a conduta?", "O que fazer?"), defini\xE7\xF5es passivas ("O que \xE9 X?") ou respostas bin\xE1rias ("Sim/N\xE3o").
   - "answer": 1 a 12 palavras (M\xC1XIMO ESTRITO 15 palavras e <= 110 caracteres), terminado em ponto final (.), SEM ponto-e-v\xEDrgula (;) e SEM tag <b> externo envolvendo toda a resposta. Para esquemas combinados (ex.: 3 f\xE1rmacos), seja compacto (<= 14 palavras, deixando intervalos 12/12h e dias no hint) e NUNCA deixe dose num\xE9rica sem unidade (mg/g/mL).
3. Se "cloze":
   - "question": cont\xE9m ESTRITAMENTE UMA lacuna {{c1::...}} com 1 a 5 palavras dentro da lacuna, unidades de medida FORA da lacuna, SEM preposi\xE7\xE3o pendurada no final, SEM "::dica" e SEM partir express\xF5es ao meio (ex.: proibido "{{c1::3 crit\xE9rios maiores e 1}} menor"). Mantenha a \xE2ncora cl\xEDnica enxuta e natural: N\xC3O invente idade nem tempo cronol\xF3gico artificial no enunciado quando a regra num\xE9rica \xE9 geral.
   - "answer": "" (string vazia).
4. Racioc\xEDnio Visual Proativo (Materiais + Web), Zero M\xEDdias \xD3rf\xE3s e Posicionamento Correto:
   - NUNCA invente nomes de arquivos locais inexistentes em <img src="..."> ou <audio>.
   - Se o card original j\xE1 tiver <img src="..."> v\xE1lido no "hint" (especialmente tabelas, algoritmos ou esquemas de resposta), MANTENHA a tag <img src="..."> e sua <i>Legenda</i> no IN\xCDCIO do "hint" ("<img ...><br><i>Legenda</i><br><br><b>Coment\xE1rio:</b> ...").
   - PROATIVO: Mesmo que o card original N\xC3O tenha imagem, avalie se ele se beneficia clinicamente de um ECG, radiografia, TC, USG, CTG, foto semiol\xF3gica/dermatoscopia, l\xE2mina ou fluxograma:
     * Se houver imagem correspondente no CAT\xC1LOGO DE IMAGENS DOS MATERIAIS ANEXADOS acima, insira <img src="pdfimg:ID_EXATO">!
     * Se n\xE3o houver no cat\xE1logo dos PDFs, insira <img src="buscar_imagem: query cl\xEDnica precisa"> (ex.: <img src="buscar_imagem: bloqueio de ramo direito ECG">)!
     * Use na "question" ("image_mode": "recognition") quando o aluno precisa interpretar a imagem para responder, ou no in\xEDcio do "hint" ("image_mode": "feedback") quando ela serve para feedback visual/fluxograma. N\xE3o force imagens em cards puramente te\xF3ricos/normativos sem valor visual.
   - Garanta 100% de coer\xEAncia num\xE9rica entre pergunta e hint.
5. Duplo Salto Cognitivo Impl\xEDcito: NUNCA fa\xE7a pergunta composta ("Qual o diagn\xF3stico e a conduta?"). Apresente o caso cl\xEDnico e pergunte apenas 1 decis\xE3o at\xF4mica.
6. "topic": formato "Tema - Subtema", ZERO spoiler por palavra ou radical INCLUSIVE no prefixo antes do " - " e NUNCA repita o topic em negrito dentro do question.
7. "question": ZERO spoiler entre par\xEAnteses e ZERO LaTeX ($...$, \\rightarrow).
8. "hint": deve ter "<b>Coment\xE1rio:</b> " logo antes da explica\xE7\xE3o textual (se houver <i>Legenda</i> ou <img ...>, coloque no in\xEDcio ANTES de "<b>Coment\xE1rio:</b> "), com 1 a 2 frases (180 a 300 caracteres vis\xEDveis no coment\xE1rio textual, NUNCA passar de 310), termos-chave em <b>negrito</b> e contraste diferencial/causal obrigat\xF3rio. Para escores, crit\xE9rios num\xE9ricos ou pareamento parede\xD7deriva\xE7\xF5es\xD7art\xE9ria, inclua AP\xD3S o coment\xE1rio uma tabela HTML compacta <table class="med-table"><thead><tr><th>...</th></tr></thead><tbody>...</tbody></table> (\u2264 4 colunas; n\xE3o conta nos 310 chars). Valide termos bioqu\xEDmicos (ex.: calemia = pot\xE1ssio, nunca "litemia").
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
      "question": "No contexto cl\xEDnico/assistencial pertinente ao tema, paciente apresenta [achados/cen\xE1rio sem spoiler]. Qual a conduta priorit\xE1ria indicada neste perfil?",
      "answer": "Conduta at\xF4mica curta terminada em ponto.",
      "hint": "<b>Coment\xE1rio:</b> Explica\xE7\xE3o concisa de 180 a 300 chars vis\xEDveis com <b>termos-chave</b> e contraste diferencial."
    }
  ]
}`;
        const response = await withGeminiKeyRotation(async (ai, keyFp) => {
          const parts = await resolveDocumentPartsForGemini(ai, pdfs, signal, keyFp);
          return generateContentWithRetry(
            ai,
            {
              model: activeModel,
              contents: { parts: [...parts, { text: prompt }] },
              config: {
                systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
                responseMimeType: "application/json",
                maxOutputTokens: 65536,
                thinkingConfig: { thinkingLevel: ThinkingLevel2.HIGH }
              }
            },
            { signal, timeoutMs: 15e4, enableModelFallback: true }
          );
        }, signal);
        lastModelUsed = response.modelUsed;
        const rawText = response.text || "{}";
        const finishReason = response.finishReason;
        let parsedNotes = [];
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
        const isAnomalousLoss = subsetCards.length >= 6 && parsedNotes.length < Math.ceil(subsetCards.length * 0.6);
        if ((finishReason === "MAX_TOKENS" || wasTruncated || isAnomalousLoss) && subsetCards.length >= 4 && depth < 2) {
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
            )
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
        modelUsed: lastModelUsed
      });
    } catch (error) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, "Erro ao gerar o Deck JSON Can\xF4nico com Gemini.")
      });
    } finally {
      cleanup();
    }
  });
  router.post("/fill-map-gaps", async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 18e4);
    try {
      const {
        deckKey = "tema_clinico_internato",
        clinicalMap = null,
        rebuiltCards = [],
        pdfImagesCatalog = [],
        nextNewIdStart = 171000200,
        model: requestedModel
      } = req.body || {};
      const activeModel = resolveGeminiModel(requestedModel);
      const checkedMapItems = Array.isArray(clinicalMap?.items) ? clinicalMap.items.filter((i) => i.checked !== false) : [];
      const effectiveProfile = resolveEffectiveDomainProfile(
        clinicalMap?.profile,
        deckKey,
        `${clinicalMap?.themeTitle || ""} ${clinicalMap?.specialty || ""}`
      );
      const profilePromptBlock = formatProfilePromptBlock(effectiveProfile);
      if (checkedMapItems.length === 0) {
        return res.json({ deck_key: deckKey, notes: [] });
      }
      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error: "Chave GEMINI_API_KEY n\xE3o configurada no ambiente."
        });
      }
      const existingDigest = Array.isArray(rebuiltCards) ? rebuiltCards.slice(0, 160).map(
        (c) => `- ID:${c.id ?? "?"} | ${sanitizeCardTextForPrompt(c.topic, 80)} | Q: "${sanitizeCardTextForPrompt(c.question, 180)}"${c.answer ? ` | A: "${sanitizeCardTextForPrompt(c.answer, 90)}"` : ""}`
      ).join("\n") : "";
      const pdfCatalogBlock = formatPdfImagesCatalogBlock(pdfImagesCatalog);
      const guidelinesBlock = formatVerifiedGuidelinesBlock(clinicalMap);
      const prompt = `Audite a cobertura cl\xEDnica do baralho reconstru\xEDdo "${deckKey}" comparando-o com o Mapa Cl\xEDnico P1\u2013P4 aprovado para o perfil "${effectiveProfile}".

${profilePromptBlock}

MAPA CL\xCDNICO APROVADO:
${JSON.stringify(checkedMapItems, null, 2)}
${guidelinesBlock}${pdfCatalogBlock}
CARDS J\xC1 GERADOS NOS LOTES:
${existingDigest || "Nenhum card gerado."}

TAREFA CIR\xDARGICA:
- Identifique APENAS os conceitos essenciais do Mapa Cl\xEDnico que ficaram SEM UM CARD PR\xD3PRIO DEDICADO (uma men\xE7\xE3o passageira dentro do coment\xE1rio/"hint" ou lista lateral de outro card N\xC3O conta como card dedicado!).
- Para cada lacuna real encontrada, crie 1 card at\xF4mico seguindo rigorosamente Andy Matuschak & Michael Nielsen, atribuindo IDs sequenciais a partir de ${nextNewIdStart}:
  * "topic": formato "Tema - Subtema" sem spoiler por palavra ou radical INCLUSIVE no prefixo antes de " - ".
  * Racioc\xEDnio visual proativo: se a lacuna envolve exame/les\xE3o/tra\xE7ado/algoritmo que ganhe reten\xE7\xE3o com imagem, use <img src="pdfimg:ID_EXATO"> (se presente no cat\xE1logo acima) ou <img src="buscar_imagem: query cl\xEDnica espec\xEDfica"> na "question" ("image_mode": "recognition") ou no in\xEDcio do "hint" ("image_mode": "feedback"). NUNCA invente arquivos locais.
  * Se "basic": "question" <= 45\u201350 palavras (vinheta ou pergunta causal), "answer" com 1 a 12 palavras terminado em ponto final (.), sem ";".
  * Se "cloze": exatamente 1 lacuna {{c1::...}} (1 a 5 palavras) e "answer": "".
  * "hint": comece com "<b>Coment\xE1rio:</b> " (precedido por <i>Legenda</i> ou <img ...><br> quando aplic\xE1vel), tenha entre 180 e 300 caracteres vis\xEDveis (medidos AP\xD3S "<b>Coment\xE1rio:</b> " excluindo <table>, teto de 320), destaque termos-chave em <b>negrito</b> e traga contraste diferencial real pertinente ao tema. Inclua <table class="med-table"> compacta ap\xF3s o coment\xE1rio sempre que houver escore, crit\xE9rios ou tabela topogr\xE1fica. Valide terminologia cl\xEDnica estrita (ex.: calemia = K+, nunca "litemia").
- Se TODOS os conceitos do Mapa Cl\xEDnico j\xE1 possu\xEDrem card pr\xF3prio dedicado acima, retorne "notes": [].
- NUNCA duplique conceitos j\xE1 cobertos nos cards existentes acima.
- N\xC3O inclua o campo "sources".

Retorne EXCLUSIVAMENTE um JSON v\xE1lido:
{
  "deck_key": "${deckKey}",
  "notes": []
}`;
      const response = await withGeminiKeyRotation(
        (ai) => generateContentWithRetry(
          ai,
          {
            model: activeModel,
            contents: [{ text: prompt }],
            config: {
              systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
              responseMimeType: "application/json",
              maxOutputTokens: 65536,
              thinkingConfig: { thinkingLevel: ThinkingLevel2.HIGH }
            }
          },
          { signal, timeoutMs: 135e3, enableModelFallback: true }
        ),
        signal
      );
      if (res.writableEnded) return;
      const { notes, wasTruncated } = parseOrRecoverNotesJsonWithMeta(response.text || "{}");
      if (wasTruncated) {
        console.warn("[fill-map-gaps] Resposta truncada recuperada parcialmente:", notes.length);
      }
      return res.json({
        deck_key: deckKey,
        notes: sanitizeReturnedNotes(notes),
        modelUsed: response.modelUsed
      });
    } catch (error) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, "Erro ao auditar lacunas do Mapa Cl\xEDnico.")
      });
    } finally {
      cleanup();
    }
  });
  router.post("/repair-cards", async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 18e4);
    try {
      const {
        flaggedCards = [],
        deckKey = "internato_deck",
        clinicalMap = null,
        pdfs = [],
        targetField = "",
        fieldInstruction = "",
        model: requestedModel
      } = req.body || {};
      const activeModel = resolveGeminiModel(requestedModel);
      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error: "Chave GEMINI_API_KEY n\xE3o configurada no ambiente. Configure sua chave no painel Settings > Secrets."
        });
      }
      const guidelinesBlock = formatVerifiedGuidelinesBlock(clinicalMap);
      const checkedItems = Array.isArray(clinicalMap?.items) ? clinicalMap.items.filter((i) => i.checked !== false).slice(0, 20).map(
        (i) => `- [${String(i.priority || "P2")}] ${sanitizeCardTextForPrompt(i.subtopic, 60)}: ${sanitizeCardTextForPrompt(i.concept, 150)}`
      ).join("\n") : "";
      const targetFieldBlock = targetField ? `
FOCO SOLICITADO PELO USU\xC1RIO: Concentre a reescrita no campo "${String(targetField)}"${fieldInstruction ? ` (motivo: "${sanitizeCardTextForPrompt(fieldInstruction, 220)}")` : ""}, preservando os demais campos j\xE1 v\xE1lidos e mantendo coer\xEAncia total entre pergunta, resposta e coment\xE1rio.` : "";
      const prompt = `Reescreva cirurgicamente APENAS os cards abaixo que foram reprovados pelo Linter Matuschak & Nielsen (andymatuschak.org/prompts/ e augmentingcognition.com/ltm.html) e/ou pela Verifica\xE7\xE3o Final.
Mantenha rigorosamente o mesmo "id" num\xE9rico e qualquer tag de m\xEDdia v\xE1lida (como __EMBEDDED_DATA_URI_*__) de cada card, A MENOS que o card fa\xE7a refer\xEAncia visual sem imagem \u2014 nesse caso insira <img src="buscar_imagem: query cl\xEDnica precisa"> ou remova a refer\xEAncia \xF3rf\xE3. N\xC3O inclua o campo "sources".
${guidelinesBlock}${checkedItems ? `
MAPA CL\xCDNICO DO DECK "${deckKey}":
${checkedItems}
` : ""}${targetFieldBlock}

REGRAS DE CORRE\xC7\xC3O CIR\xDARGICA (MATUSCHAK & NIELSEN):
- **Focused & Tractable:** Se a pergunta pede lista aberta ("Quais as causas/crit\xE9rios...?", "Cite...") ou a resposta tem m\xFAltiplos itens/ponto-e-v\xEDrgula, isole 1 \xFAnico atributo/decis\xE3o determinante. Se for pergunta composta ("Qual a parede e a art\xE9ria?", "Qual o diagn\xF3stico e antiarr\xEDtmico?"), mantenha apenas 1 alvo at\xF4mico.
- **Salience & Anti-Passivo (Nielsen):** Se a pergunta \xE9 uma defini\xE7\xE3o inerte ("O que \xE9 X?") ou bin\xE1ria ("Sim/N\xE3o"), transforme em um prompt de sali\xEAncia ancorado em cen\xE1rio cl\xEDnico ou mecanismo causal.
- **Precise & Consistent:** Se "type": "basic" -> "question" com <= 50 palavras e pergunta precisa (com janela temporal expl\xEDcita: "imediata", "inicial", "de 1\xAA escolha" \u2014 NUNCA "Qual a conduta?"); "answer" DEVE ter entre 1 e 12 palavras (m\xE1x 15 palavras / 110 chars), terminar com ".", N\xC3O conter ";" e N\xC3O ter <b> envolvendo tudo.
- **Cloze At\xF4mico:** Se "type": "cloze" -> "question" DEVE ter estritamente 1 lacuna {{c1::...}} com 1 a 5 palavras, unidades fora da lacuna, sem preposi\xE7\xE3o pendurada no final, SEM "::dica", e "answer" DEVE ser "".
- **Effortful (Zero Spoiler):** Se spoiler por radical ou palavra no "topic" ou entre par\xEAnteses na "question" -> remova imediatamente a palavra/radical da resposta mantendo formato "Tema - Subtema".
- **Precis\xE3o Terminol\xF3gica & Tabelas:** Corrija imprecis\xF5es cl\xEDnicas (ex.: calemia = pot\xE1ssio, nunca litemia). Se o card explicar escore ou correla\xE7\xE3o topogr\xE1fica, mantenha ou adicione <table class="med-table"> compacta (\u2264 4 colunas) AP\xD3S o texto de <b>Coment\xE1rio:</b>.
- Substitua qualquer LaTeX ($...$, \\rightarrow) por Unicode puro (\u2192, \u2265, \u2264).
- "hint": DEVE conter "<b>Coment\xE1rio:</b> ", ter entre 180 e 295 caracteres vis\xEDveis AP\xD3S o prefixo "<b>Coment\xE1rio:</b> " (excluindo <table>; PROIBIDO passar de 320 chars vis\xEDveis), com termos-chave em <b>negrito</b> e contraste diferencial/causal.

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
      const response = await withGeminiKeyRotation(async (ai, keyFp) => {
        const parts = await resolveDocumentPartsForGemini(ai, pdfs, signal, keyFp);
        parts.push({ text: prompt });
        return generateContentWithRetry(
          ai,
          {
            model: activeModel,
            contents: { parts },
            config: {
              systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
              responseMimeType: "application/json",
              maxOutputTokens: 65536,
              thinkingConfig: { thinkingLevel: ThinkingLevel2.HIGH }
            }
          },
          { signal, timeoutMs: 135e3, enableModelFallback: true }
        );
      }, signal);
      if (res.writableEnded) return;
      const rawText = response.text || "{}";
      const { items: rawRepaired } = parseOrRecoverJsonArrayField(
        rawText,
        "repairedCards",
        ["id", "question"]
      );
      const repairedCards = sanitizeReturnedNotes(rawRepaired);
      return res.json({ repairedCards, deckKey, modelUsed: response.modelUsed });
    } catch (error) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, "Erro ao auto-reparar cards com Gemini.")
      });
    } finally {
      cleanup();
    }
  });
  router.post("/suggest-visual-cards", async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 13e4);
    try {
      const {
        deckKey = "internato_deck",
        cards = [],
        pdfImagesCatalog = [],
        model: requestedModel
      } = req.body || {};
      const activeModel = resolveGeminiModel(requestedModel);
      const candidateCards = (Array.isArray(cards) ? cards : []).filter((c) => {
        const combined = `${String(c?.question || "")} ${String(c?.hint || "")}`;
        return !/<img\b/i.test(combined);
      }).slice(0, 40);
      if (candidateCards.length === 0) {
        return res.json({ deckKey, suggestions: [] });
      }
      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error: "Chave GEMINI_API_KEY n\xE3o configurada no ambiente. Configure sua chave no painel Settings > Secrets."
        });
      }
      const cardsDigest = candidateCards.map(
        (c) => `- cardId: ${Number(c.id)} | type: ${c.type === "cloze" ? "cloze" : "basic"} | topic: "${sanitizeCardTextForPrompt(c.topic, 80)}" | Q: "${sanitizeCardTextForPrompt(c.question, 220)}"${c.answer ? ` | A: "${sanitizeCardTextForPrompt(c.answer, 110)}"` : ""} | Hint: "${sanitizeCardTextForPrompt(c.hint, 200)}"`
      ).join("\n");
      const pdfCatalogBlock = formatPdfImagesCatalogBlock(pdfImagesCatalog);
      const prompt = `Voc\xEA \xE9 um preceptor de Internato analisando flashcards m\xE9dicos SEM imagem do deck "${deckKey}".
Raciocine criticamente sobre QUAIS cards realmente se beneficiariam de uma imagem cl\xEDnica para aumentar a reten\xE7\xE3o (ex.: tra\xE7ado de ECG/CTG, radiografia, TC, USG, dermatoscopia/les\xE3o cut\xE2nea, fundoscopia, esfrega\xE7o/l\xE2mina, exame f\xEDsico/sinal semiol\xF3gico, fluxograma diagn\xF3stico ou figura presente nos materiais anexados).

REGRAS ESTRITAS:
1. N\xC3O sugira imagem para cards puramente conceituais, defini\xE7\xF5es \xE9ticas/normativas, doses isoladas ou c\xE1lculos simples onde uma figura seria decorativa ou aleat\xF3ria.
2. Escolha o "mode" ideal:
   - "recognition": coloque a imagem na FRENTE (question) quando ver o exame/tra\xE7ado/les\xE3o ajuda no reconhecimento cl\xEDnico (apenas em cards "basic" cujo enunciado n\xE3o vire spoiler).
   - "feedback": coloque a imagem no VERSO (hint) quando ela ilustra/confirma o achado, classifica\xE7\xE3o, algoritmo ou compara\xE7\xE3o anat\xF4mica ap\xF3s o estudante responder (ideal para "cloze" e condutas).
3. Se uma figura do CAT\xC1LOGO DE MATERIAIS ANEXADOS abaixo corresponder bem ao conceito do card, preencha "pdfImageId" com o ID exato (ex.: "pdfimg_123_p4_1" \u2014 sem o prefixo "pdfimg:"). Mesmo quando usar "pdfImageId", preencha "searchQuery" como fallback m\xE9dico preciso.
4. "searchQuery": termo curto, espec\xEDfico e cl\xEDnico em portugu\xEAs ou ingl\xEAs com diagn\xF3stico + modalidade (ex.: "bloqueio de ramo direito V1 ECG", "pneumotorax hipertensivo radiografia torax", "cardiotocografia desaceleracao tardia"). NUNCA gere termos gen\xE9ricos ("exame medico", "paciente", "sintoma").
5. "legend": 1 frase cl\xEDnica objetiva (m\xE1x. 130 chars) descrevendo o achado visual SEM dar spoiler caso seja "recognition".
${pdfCatalogBlock}
CARDS SEM IMAGEM PARA AVALIAR:
${cardsDigest}

Retorne EXCLUSIVAMENTE um JSON v\xE1lido no formato:
{
  "suggestions": [
    {
      "cardId": 171000101,
      "mode": "recognition",
      "pdfImageId": "",
      "searchQuery": "diagnostico + modalidade exame",
      "legend": "Exame complementar evidenciando...",
      "reason": "Justificativa curta do ganho pedag\xF3gico"
    }
  ]
}`;
      const response = await withGeminiKeyRotation(
        (ai) => generateContentWithRetry(
          ai,
          {
            model: activeModel,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              maxOutputTokens: 16384,
              thinkingConfig: { thinkingLevel: ThinkingLevel2.MEDIUM }
            }
          },
          { signal, timeoutMs: 11e4, enableModelFallback: true }
        ),
        signal
      );
      if (res.writableEnded) return;
      const { items: rawList } = parseOrRecoverJsonArrayField(
        response.text || "{}",
        "suggestions",
        ["cardId", "searchQuery"]
      );
      const validIds = new Set(candidateCards.map((c) => Number(c.id)));
      const suggestions = rawList.map((item) => {
        const cardId = Number(item.cardId);
        const searchQuery = String(item.searchQuery || "").trim();
        if (!Number.isFinite(cardId) || !validIds.has(cardId) || !searchQuery) {
          return null;
        }
        const rawPdfId = String(item.pdfImageId || "").replace(/^pdfimg:\s*/i, "").trim();
        const mode = item.mode === "recognition" ? "recognition" : "feedback";
        return {
          cardId,
          mode,
          ...rawPdfId ? { pdfImageId: rawPdfId } : {},
          searchQuery: searchQuery.slice(0, 120),
          legend: String(item.legend || "").trim().slice(0, 180),
          reason: String(item.reason || "").trim().slice(0, 160)
        };
      }).filter((s) => s !== null);
      return res.json({ deckKey, suggestions, modelUsed: response.modelUsed });
    } catch (error) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(
          error,
          "Erro ao analisar cards para sugest\xE3o proativa de imagens."
        )
      });
    } finally {
      cleanup();
    }
  });
  router.post("/validate-image", async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 42e3);
    let mediaReachableRaster = false;
    try {
      const {
        imageSource = "",
        cardTopic = "",
        cardQuestion = "",
        cardAnswer = "",
        cardHint = "",
        imageMode = "feedback",
        captionHint = "",
        model: requestedModel
      } = req.body || {};
      if (!imageSource || typeof imageSource !== "string") {
        return res.status(400).json({ error: "imageSource ausente." });
      }
      const resolvedMedia = await resolveImageForMultimodalValidation(imageSource, signal);
      if (signal.aborted || res.writableEnded) return;
      if (resolvedMedia.status === "broken") {
        return res.json({
          validated: true,
          reachable: false,
          isSvg: false,
          isCompatible: false,
          detectedModality: "broken",
          conflictReason: resolvedMedia.reason,
          visualLegend: ""
        });
      }
      if (resolvedMedia.status === "fetch_error") {
        return res.json({
          validated: false,
          fallback: true,
          reachable: false,
          isSvg: false,
          isCompatible: false,
          detectedModality: "unreachable",
          conflictReason: resolvedMedia.reason,
          visualLegend: ""
        });
      }
      if (resolvedMedia.status === "svg") {
        return res.json({
          validated: false,
          fallback: true,
          reachable: true,
          isSvg: true,
          isCompatible: true,
          detectedModality: "svg_vector",
          conflictReason: "",
          visualLegend: ""
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
          detectedModality: "unverified",
          conflictReason: "",
          visualLegend: ""
        });
      }
      const activeModel = requestedModel ? resolveGeminiModel(requestedModel) : FALLBACK_GEMINI_MODEL;
      const safeMode = imageMode === "recognition" ? "recognition" : "feedback";
      const prompt = `Voc\xEA \xE9 um preceptor m\xE9dico auditando visualmente uma imagem candidata a ser anexada a um flashcard do Internato.
Analise EXCLUSIVAMENTE OS PIXELS REAIS DA IMAGEM ANEXADA (n\xE3o confie em suposi\xE7\xF5es do texto se os pixels mostrarem outra modalidade!).

CONTEXTO DO FLASHCARD:
- T\xF3pico: "${sanitizeCardTextForPrompt(cardTopic, 90)}"
- Modo de exibi\xE7\xE3o: "${safeMode}" (${safeMode === "recognition" ? "imagem na FRENTE \u2014 proibido dar spoiler da resposta na legenda!" : "imagem no VERSO/coment\xE1rio"})
- Pergunta: "${sanitizeCardTextForPrompt(cardQuestion, 240)}"
- Resposta esperada: "${sanitizeCardTextForPrompt(cardAnswer, 130)}"
- Coment\xE1rio: "${sanitizeCardTextForPrompt(cardHint, 180)}"
${captionHint ? `- Legenda/nota extra\xEDda pr\xF3xima \xE0 figura: "${sanitizeCardTextForPrompt(captionHint, 140)}"` : ""}

REGRAS ESTRITAS DE INSPE\xC7\xC3O VISUAL:
1. "detectedModality": nomeie a modalidade real vis\xEDvel nos pixels (ex.: "usg", "videolaparoscopia", "ecg_12_derivacoes", "ecg_tira_ritmo", "ecocardiograma", "radiografia", "tomografia", "ctg", "dermatoscopia", "histologia", "fluxograma", "foto_clinica", "esquema_desenho", "irrelevante_logo").
2. "isCompatible":
   - Retorne FALSE se houver conflito de modalidade (ex.: card pede ECG e a imagem \xE9 ecocardiograma/modo-M, anatomia, retrato, logo ou capa de aula; ou card pede USG e a imagem \xE9 laparoscopia).
   - Retorne FALSE se o card testa uma **patologia/altera\xE7\xE3o espec\xEDfica** (ex.: IAM com supra, Flutter atrial, WPW, BAVT, Brugada, pneumot\xF3rax, hipercalemia), MAS os pixels mostrarem um **exame NORMAL/FISIOL\xD3GICO** (ex.: ECG em ritmo sinusal normal sem altera\xE7\xE3o) ou de **OUTRA patologia diferente** (ex.: hemibloqueio anterior esquerdo quando o card pede IAM anterior; BRD quando o card pede BRE; FA quando o card pede Flutter).
   - Retorne FALSE se modo="${safeMode}" for "recognition" e a imagem for **ilustra\xE7\xE3o/esquema vetorial/cartoon** em vez de exame diagn\xF3stico real, OU se o **diagn\xF3stico/resposta aparecer escrito em texto grande leg\xEDvel como spoiler nos pixels**.
   - Retorne FALSE se a imagem for ileg\xEDvel, borrada, logomarca ou texto puro gen\xE9rico.
   - Retorne TRUE apenas se os pixels mostrarem inequivocamente o exame/achado cl\xEDnico compat\xEDvel e \xFAtil para este card.
3. "visualScore": nota inteira de 1 a 10 da qualidade did\xE1tica e precis\xE3o diagn\xF3stica da imagem (9\u201310 = ECG de 12 deriva\xE7\xF5es ou exame real n\xEDtido demonstrando o achado exato sem texto spoiler; 6\u20138 = tira de ritmo/exame aceit\xE1vel demonstrando a patologia; 1\u20135 = imagem fraca, amb\xEDgua, cortada ou incompat\xEDvel).
4. "conflictReason": explica\xE7\xE3o objetiva curta caso isCompatible=false (ou "" se compat\xEDvel).
5. "visualLegend": descreva fielmente em Portugu\xEAs do Brasil (entre 8 e 24 palavras, M\xCDNIMO 6 palavras, sem iniciar com "Legenda visual:") APENAS o que est\xE1 vis\xEDvel nos pixels reais. Se mode="recognition", descreva a morfologia visual sem entregar o diagn\xF3stico final da resposta esperada.`;
      const result = await withGeminiKeyRotation(
        (ai) => generateContentWithRetry(
          ai,
          {
            model: activeModel,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: resolvedMedia.mimeType,
                    data: resolvedMedia.data
                  }
                },
                { text: prompt }
              ]
            },
            config: {
              responseMimeType: "application/json",
              maxOutputTokens: 1024,
              thinkingConfig: { thinkingLevel: ThinkingLevel2.LOW },
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  detectedModality: { type: Type.STRING },
                  isCompatible: { type: Type.BOOLEAN },
                  visualScore: { type: Type.INTEGER },
                  conflictReason: { type: Type.STRING },
                  visualLegend: { type: Type.STRING }
                },
                required: ["detectedModality", "isCompatible", "visualScore", "visualLegend"]
              }
            }
          },
          { signal, timeoutMs: 15e3, enableModelFallback: true }
        ),
        signal
      );
      if (res.writableEnded) return;
      const parsed = JSON.parse(extractJsonBlock(result.text || "{}"));
      const detectedModality = String(parsed.detectedModality || "clinical_image").trim().slice(0, 60);
      const isCompatible = parsed.isCompatible === true;
      const rawScore = Number(parsed.visualScore);
      const visualScore = Number.isFinite(rawScore) ? Math.max(1, Math.min(10, Math.round(rawScore))) : isCompatible ? 7 : 2;
      const conflictReason = String(parsed.conflictReason || "").trim().slice(0, 220);
      const visualLegend = String(parsed.visualLegend || "").replace(/^legenda\s+visual\s*:\s*/i, "").trim().slice(0, 220);
      return res.json({
        validated: true,
        reachable: true,
        isSvg: false,
        isCompatible,
        visualScore,
        detectedModality,
        conflictReason,
        visualLegend,
        modelUsed: result.modelUsed
      });
    } catch (error) {
      if (res.writableEnded) return;
      return res.status(200).json({
        validated: false,
        fallback: true,
        reachable: mediaReachableRaster,
        isSvg: false,
        isCompatible: false,
        detectedModality: mediaReachableRaster ? "unverified" : "unreachable",
        conflictReason: mediaReachableRaster ? "Falha ao validar imagem por vis\xE3o computacional." : "Falha ao validar imagem.",
        visualLegend: "",
        error: formatGeminiError(error, "Falha na valida\xE7\xE3o multimodal da imagem.")
      });
    } finally {
      cleanup();
    }
  });
  router.post("/verify-deck", async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 16e4);
    try {
      const {
        deckKey = "tema_clinico_internato",
        cards = [],
        clinicalMap = null,
        pdfs = [],
        model: requestedModel
      } = req.body || {};
      const activeModel = resolveGeminiModel(requestedModel);
      if (parseGeminiApiKeys().length === 0) {
        return res.status(200).json({
          fallback: true,
          error: "Chave GEMINI_API_KEY n\xE3o configurada no ambiente. Configure sua chave no painel Settings > Secrets."
        });
      }
      const inputCards = Array.isArray(cards) ? cards : [];
      if (inputCards.length === 0) {
        return res.json({
          overallScore: 0,
          approved: false,
          mapCoveragePct: 0,
          summary: "Baralho vazio \u2014 nenhum card dispon\xEDvel para verifica\xE7\xE3o.",
          clinicalAccuracyNotes: [],
          missingConcepts: [],
          weakCardFixes: []
        });
      }
      const effectiveProfile = resolveEffectiveDomainProfile(
        clinicalMap?.profile,
        deckKey,
        `${clinicalMap?.themeTitle || ""} ${clinicalMap?.specialty || ""}`
      );
      const profilePromptBlock = formatProfilePromptBlock(effectiveProfile);
      const guidelinesBlock = formatVerifiedGuidelinesBlock(clinicalMap);
      const checkedMapItems = Array.isArray(clinicalMap?.items) ? clinicalMap.items.filter((i) => i.checked !== false) : [];
      const deckSummary = inputCards.slice(0, 140).map((c) => {
        const hasImg = /<img\b/i.test(`${String(c.question || "")} ${String(c.hint || "")}`);
        return `- ID:${c.id} [${c.type === "cloze" ? "cloze" : "basic"}${c.priority ? ` ${String(c.priority)}` : ""}]${hasImg ? ` [IMG:${String(c.image_mode || "feedback")}]` : ""} | Topic: "${sanitizeCardTextForPrompt(c.topic, 100)}" | Q: "${sanitizeCardTextForPrompt(c.question, 650)}"${c.answer ? ` | A: "${sanitizeCardTextForPrompt(c.answer, 200)}"` : ""} | Hint: "${sanitizeCardTextForPrompt(c.hint, 850)}"`;
      }).join("\n");
      const prompt = `Voc\xEA \xE9 o Preceptor Revisor Final auditando se o baralho montado para "${deckKey}" est\xE1 COMPLETO, ADEQUADO, CLINICAMENTE CORRETO e pronto para estudo no Anki (FSRS).

${profilePromptBlock}${guidelinesBlock}
MAPA CL\xCDNICO P1\u2013P4 APROVADO:
${checkedMapItems.length > 0 ? JSON.stringify(checkedMapItems, null, 2) : "Avalie cobertura integral do tema."}

BARALHO FINAL MONTADO (${inputCards.length} cards):
${deckSummary}

AVALIE RIGOROSAMENTE:
1. Cobertura do Mapa Cl\xEDnico P1\u2013P4 (quais conceitos cr\xEDticos realmente ficaram descobertos em "missingConcepts").
2. Acur\xE1cia cl\xEDnica frente \xE0s Diretrizes Verificadas e PDFs anexados (doses, crit\xE9rios, condutas).
3. Rigor pedag\xF3gico Matuschak & Nielsen e adequa\xE7\xE3o cl\xEDnica das imagens/legendas ("weakCardFixes" \u2014 liste apenas cards que realmente tenham falha cl\xEDnica, ambiguidade ou incompatibilidade entre o achado descrito na legenda e o tema do card. NOTA IMPORTANTE: tags <img src="https://..." data-anki-file="..."> e src="[IMAGEM_EMBUTIDA]" representam imagens m\xE9dicas J\xC1 validadas e resolvidas que ser\xE3o empacotadas localmente no .apkg \u2014 NUNCA aponte "URL externa" como problema e NUNCA pe\xE7a para trocar uma URL resolvida de volta para "buscar_imagem:").
4. "overallScore" de 0 a 10 e "approved": true somente se overallScore >= 8 e n\xE3o houver lacunas P1 cr\xEDticas descobertas.

Retorne EXCLUSIVAMENTE um objeto JSON v\xE1lido:
{
  "overallScore": 9,
  "approved": true,
  "mapCoveragePct": 95,
  "summary": "S\xEDntese objetiva da qualidade final do baralho.",
  "clinicalAccuracyNotes": ["Observa\xE7\xE3o objetiva sobre alinhamento com diretrizes/PDFs."],
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
      "issue": "Problema cl\xEDnico ou ambiguidade detectada",
      "fixInstruction": "Instru\xE7\xE3o cir\xFArgica exata para corrigir o card"
    }
  ]
}`;
      const response = await withGeminiKeyRotation(async (ai, keyFp) => {
        const parts = await resolveDocumentPartsForGemini(ai, pdfs, signal, keyFp);
        parts.push({ text: prompt });
        return generateContentWithRetry(
          ai,
          {
            model: activeModel,
            contents: { parts },
            config: {
              systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
              responseMimeType: "application/json",
              maxOutputTokens: 16384,
              thinkingConfig: { thinkingLevel: ThinkingLevel2.MEDIUM }
            }
          },
          { signal, timeoutMs: 135e3, enableModelFallback: true }
        );
      }, signal);
      if (res.writableEnded) return;
      const rawText = response.text || "{}";
      let parsed = {};
      try {
        parsed = JSON.parse(extractJsonBlock(rawText));
      } catch {
        const { items: recoveredMissing } = parseOrRecoverJsonArrayField(
          rawText,
          "missingConcepts",
          ["concept"]
        );
        const { items: recoveredFixes } = parseOrRecoverJsonArrayField(
          rawText,
          "weakCardFixes",
          ["cardId", "issue"]
        );
        const scoreMatch = rawText.match(/"overallScore"\s*:\s*(\d+(?:\.\d+)?)/);
        const covMatch = rawText.match(/"mapCoveragePct"\s*:\s*(\d+(?:\.\d+)?)/);
        const sumMatch = rawText.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        parsed = {
          overallScore: scoreMatch ? Number(scoreMatch[1]) : 7,
          approved: false,
          mapCoveragePct: covMatch ? Number(covMatch[1]) : 80,
          summary: sumMatch?.[1] || "Verifica\xE7\xE3o final recuperada parcialmente.",
          clinicalAccuracyNotes: [],
          missingConcepts: recoveredMissing,
          weakCardFixes: recoveredFixes
        };
      }
      const validPriorities = /* @__PURE__ */ new Set(["P1", "P2", "P3", "P4"]);
      const missingConcepts = Array.isArray(parsed.missingConcepts) ? parsed.missingConcepts.filter((m) => Boolean(m && typeof m === "object" && m.concept)).map((m) => {
        const p = String(m.priority || "P2").toUpperCase();
        return {
          priority: validPriorities.has(p) ? p : "P2",
          subtopic: sanitizeCardTextForPrompt(m.subtopic || deckKey, 90),
          concept: sanitizeCardTextForPrompt(m.concept, 220),
          recommendedType: m.recommendedType === "cloze" ? "cloze" : "basic"
        };
      }) : [];
      const weakCardFixes = Array.isArray(parsed.weakCardFixes) ? parsed.weakCardFixes.filter((f) => Boolean(f && typeof f === "object" && Number.isFinite(Number(f.cardId)))).map((f) => ({
        cardId: Number(f.cardId),
        issue: sanitizeCardTextForPrompt(f.issue, 200),
        fixInstruction: sanitizeCardTextForPrompt(f.fixInstruction, 240)
      })).filter(
        (f) => !(/\b(?:url\s+externa|links?\s+externos?|links?\s+mortos?)\b/i.test(f.issue) && /buscar_imagem:/i.test(f.fixInstruction))
      ) : [];
      const overallScore = Number.isFinite(Number(parsed.overallScore)) ? Math.max(0, Math.min(10, Math.round(Number(parsed.overallScore) * 10) / 10)) : 8;
      const mapCoveragePct = Number.isFinite(Number(parsed.mapCoveragePct)) ? Math.max(0, Math.min(100, Math.round(Number(parsed.mapCoveragePct)))) : 85;
      const approved = typeof parsed.approved === "boolean" ? parsed.approved : overallScore >= 8 && missingConcepts.filter((m) => m.priority === "P1").length === 0;
      return res.json({
        overallScore,
        approved,
        mapCoveragePct,
        summary: sanitizeCardTextForPrompt(parsed.summary, 350) || `Baralho avaliado com nota ${overallScore}/10 e ${mapCoveragePct}% de cobertura do Mapa Cl\xEDnico.`,
        clinicalAccuracyNotes: Array.isArray(parsed.clinicalAccuracyNotes) ? parsed.clinicalAccuracyNotes.map((n) => sanitizeCardTextForPrompt(n, 220)).filter(Boolean).slice(0, 8) : [],
        missingConcepts,
        weakCardFixes,
        modelUsed: response.modelUsed
      });
    } catch (error) {
      if (res.writableEnded) return;
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, "Erro ao realizar verifica\xE7\xE3o final do baralho.")
      });
    } finally {
      cleanup();
    }
  });
  return router;
}

// server/routes/media.ts
import fs4 from "fs";
import express2 from "express";

// server/ankiExport.ts
import fs3 from "fs";
import crypto2 from "crypto";
import initSqlJs from "sql.js";
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
function isSafeExternalMediaUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host === "::1" || host === "0.0.0.0" || host.endsWith(".local") || host.endsWith(".internal")) {
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
async function safeFetchMediaUrl(rawUrl, headers, maxRedirects = 3) {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isSafeExternalMediaUrl(currentUrl)) return null;
    const resp = await fetch(currentUrl, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(12e3)
    });
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location || hop === maxRedirects) return null;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return resp;
  }
  return null;
}
async function resolveMediaSourceToBuffer(sourceUrl) {
  if (!sourceUrl) return null;
  const trimmed = sourceUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/api/media/local-file?")) {
    try {
      const parsed = new URL(trimmed, "http://localhost");
      const rel = parsed.searchParams.get("rel") || "";
      const absPath = resolveSafeLocalMediaPath(rel);
      if (!absPath) return null;
      return fs3.readFileSync(absPath);
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("data:")) {
    const commaIdx = trimmed.indexOf(",");
    if (commaIdx === -1) return null;
    const header = trimmed.slice(0, commaIdx);
    const payload = trimmed.slice(commaIdx + 1);
    if (header.includes(";base64")) {
      const buf = Buffer.from(payload.replace(/\s+/g, ""), "base64");
      return buf.length > 0 ? buf : null;
    }
    try {
      const buf = Buffer.from(decodeURIComponent(payload), "utf8");
      return buf.length > 0 ? buf : null;
    } catch {
      const buf = Buffer.from(payload, "utf8");
      return buf.length > 0 ? buf : null;
    }
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    if (!isSafeExternalMediaUrl(trimmed)) return null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await safeFetchMediaUrl(trimmed, {
          "User-Agent": "InternatoFirstCardArchitect/2.0 (https://aistudio.google.com; medical-education)",
          Accept: "image/*, audio/*, application/octet-stream;q=0.8"
        });
        if (!resp) return null;
        if (resp.status === 404 || resp.status === 410) return null;
        if (!resp.ok) {
          if (attempt === 0 && (resp.status === 429 || resp.status >= 500)) continue;
          return null;
        }
        const contentType = (resp.headers.get("content-type") || "").toLowerCase();
        if (contentType.includes("text/html") || contentType.includes("application/json") || contentType.includes("application/xhtml")) {
          return null;
        }
        const arrBuf = await resp.arrayBuffer();
        if (arrBuf.byteLength < 64 || arrBuf.byteLength > 20 * 1024 * 1024) {
          return null;
        }
        return Buffer.from(arrBuf);
      } catch {
        if (attempt === 1) return null;
      }
    }
    return null;
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 64) {
    try {
      const buf = Buffer.from(trimmed.replace(/\s+/g, ""), "base64");
      return buf.length > 0 ? buf : null;
    } catch {
      return null;
    }
  }
  return null;
}
function normalizeLocalAssetBasename(rawName) {
  return (rawName || "").trim().split(/[\\/]/).pop()?.trim() || "";
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
  const seenLowerFilenames = /* @__PURE__ */ new Set();
  const resolvedMedia = [];
  const missingMedia = [];
  if (Array.isArray(mediaManifest) && mediaManifest.length > 0) {
    const items = mediaManifest.filter((item) => {
      const filename = normalizeLocalAssetBasename(
        String(item?.filename || item?.localFilename || "")
      );
      const lower = filename.toLowerCase();
      if (!filename || seenLowerFilenames.has(lower)) return false;
      seenLowerFilenames.add(lower);
      return true;
    });
    const CONCURRENCY = 4;
    let cursor = 0;
    const results = new Array(items.length);
    const worker = async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        const item = items[idx];
        const filename = normalizeLocalAssetBasename(
          String(item?.filename || item?.localFilename || "")
        );
        const sourceUrl = String(item?.sourceUrl || "").trim();
        const lowerName = filename.toLowerCase();
        const uploadedDataUri = normalizedAssetMap.get(lowerName) || (sourceUrl ? normalizedAssetMap.get(sourceUrl.toLowerCase()) : void 0);
        let buf = null;
        if (uploadedDataUri) {
          buf = await resolveMediaSourceToBuffer(uploadedDataUri);
        }
        if (!buf && sourceUrl) {
          buf = await resolveMediaSourceToBuffer(sourceUrl);
        }
        results[idx] = { filename, cardId: item?.cardId, sourceUrl, buf };
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, Math.max(1, items.length)) }, () => worker())
    );
    for (const r of results) {
      if (!r) continue;
      if (r.buf && r.buf.length > 0) {
        resolvedMedia.push({ filename: r.filename, data: r.buf });
      } else {
        missingMedia.push({
          filename: r.filename,
          cardId: r.cardId,
          reason: /^(?:https?:\/\/)/i.test(r.sourceUrl) ? `Falha ao baixar URL externa (${r.sourceUrl.slice(0, 80)})` : "Arquivo local n\xE3o encontrado nos assets carregados"
        });
      }
    }
  } else if (!Array.isArray(mediaManifest) || mediaManifest.length === 0) {
    for (const [rawName, dataUri] of Object.entries(mediaAssets || {})) {
      const cleanName = normalizeLocalAssetBasename(rawName);
      if (!cleanName || seenLowerFilenames.has(cleanName.toLowerCase())) continue;
      const buf = await resolveMediaSourceToBuffer(dataUri);
      if (buf && buf.length > 0) {
        seenLowerFilenames.add(cleanName.toLowerCase());
        resolvedMedia.push({ filename: cleanName, data: buf });
      }
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
i, em { font-style: italic; color: #334155; }
.cloze { font-weight: 700; color: #0284c7; border-bottom: 2px solid #38bdf8; padding: 0 2px; }
.front-content, .cloze-text { font-size: 19.5px; color: #0f172a; line-height: 1.58; }
.back-content { font-size: 18.5px; color: #0f172a; line-height: 1.58; margin-top: 10px; }
.main-answer { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
.extra-box {
  margin-top: 16px; padding: 14px 18px; background: #f1f5f9;
  border-radius: 8px; border-left: 4px solid #0284c7;
  font-size: 16px; color: #334155; line-height: 1.52;
}
hr, hr#answer, hr.med-divider { border: 0; height: 1px; background: #cbd5e1; margin: 20px 0; }
img {
  max-width: 100%; max-height: 62vh; height: auto; border-radius: 8px;
  border: 1px solid #cbd5e1;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.10); margin: 14px auto 6px;
  background: #ffffff; padding: 4px; display: block; object-fit: contain;
}
img:first-child { margin-top: 0; }
audio.med-audio { width: 100%; height: 36px; margin: 8px 0; display: block; }
img + br + i,
img + i,
.extra-box > i:first-child {
  display: block;
  margin: 4px auto 12px;
  max-width: 94%;
  font-size: 13.5px;
  line-height: 1.45;
  color: #475569;
  text-align: center;
  font-style: italic;
}
table.med-table {
  width: 100%;
  border-collapse: collapse;
  margin: 14px 0;
  font-size: 14.5px;
  line-height: 1.45;
  background-color: #ffffff;
  color: #0f172a;
  border: 1px solid #cbd5e1;
}
table.med-table th,
table.med-table td {
  border: 1px solid #cbd5e1;
  padding: 9px 12px;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}
table.med-table th {
  background-color: #e0f2fe;
  color: #0c4a6e;
  font-weight: 700;
}
table.med-table tbody tr:nth-child(even) td {
  background-color: #f8fafc;
}
.nightMode.card, .night_mode.card, body.nightMode, body.night_mode { background-color: #18181b !important; color: #f4f4f5 !important; }
.nightMode .topic-box, .night_mode .topic-box { background-color: #27272a !important; color: #7dd3fc !important; border-color: #3f3f46 !important; }
.nightMode .front-content, .nightMode .back-content, .night_mode .front-content, .night_mode .back-content, .nightMode .cloze-text, .night_mode .cloze-text { color: #f4f4f5 !important; }
.nightMode .main-answer, .night_mode .main-answer { color: #f4f4f5 !important; }
.nightMode b, .nightMode strong, .night_mode b, .night_mode strong { color: #38bdf8 !important; }
.nightMode i, .nightMode em, .night_mode i, .night_mode em { color: #cbd5e1 !important; }
.nightMode .cloze, .night_mode .cloze { color: #38bdf8 !important; border-bottom: 2px solid #0ea5e9 !important; }
.nightMode .extra-box, .night_mode .extra-box { background: #27272a !important; border-left: 4px solid #38bdf8 !important; color: #e4e4e7 !important; }
.nightMode hr, .night_mode hr, .nightMode hr#answer, .night_mode hr#answer, .nightMode hr.med-divider, .night_mode hr.med-divider { background: #3f3f46 !important; }
.nightMode img, .night_mode img { background: #ffffff !important; border: 1px solid #3f3f46 !important; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45) !important; }
.nightMode img + br + i, .night_mode img + br + i,
.nightMode img + i, .night_mode img + i,
.nightMode .extra-box > i:first-child, .night_mode .extra-box > i:first-child {
  color: #cbd5e1 !important;
}
.nightMode table.med-table, .night_mode table.med-table {
  background-color: #18181b !important;
  color: #f4f4f5 !important;
  border-color: #475569 !important;
}
.nightMode table.med-table th, .night_mode table.med-table th {
  background-color: #0c4a6e !important;
  color: #e0f2fe !important;
  border-color: #475569 !important;
}
.nightMode table.med-table td, .night_mode table.med-table td {
  background-color: #1f2430 !important;
  border-color: #475569 !important;
  color: #f4f4f5 !important;
}
.nightMode table.med-table tbody tr:nth-child(even) td,
.night_mode table.med-table tbody tr:nth-child(even) td {
  background-color: #27272a !important;
}
@media (max-width: 600px) {
  .card { padding: 14px; font-size: 16.5px; }
  .med-card { max-width: 100%; }
  .front-content, .cloze-text { font-size: 17.5px; }
  .back-content { font-size: 16.5px; }
  .main-answer { font-size: 18px; }
  .extra-box { padding: 10px 14px; font-size: 15px; }
  img { max-height: 55vh; margin-top: 10px; }
  img:first-child { margin-top: 0; }
  table.med-table { font-size: 13.5px; display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table.med-table th, table.med-table td { padding: 7px 9px; }
}`;
var BASE91_TABLE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";
function sanitizeDeckKeyForAnki(rawKey, fallback = "internato_deck") {
  return (rawKey || fallback).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || fallback;
}
function genankiGuidFor(deckId, deckKey, noteId) {
  const cleanKey = sanitizeDeckKeyForAnki(deckKey, "deck");
  const key = `${cleanKey}:id:${noteId}`;
  const hashStr = `${GUID_SALT}__${deckId}__${key}`;
  const digest = crypto2.createHash("sha256").update(hashStr, "utf8").digest();
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
  const hex = crypto2.createHash("sha1").update(sfld || "", "utf8").digest("hex").slice(0, 8);
  return parseInt(hex, 16) >>> 0;
}
function computeDeckIdFromKey(deckKey) {
  const cleanKey = sanitizeDeckKeyForAnki(deckKey, "internato_deck");
  const digest = crypto2.createHash("sha256").update(cleanKey, "utf8").digest();
  const val = digest.readUInt32BE(0);
  return 173e10 + val % 9e8;
}
function normalizeGuidRegistryMap(rawRegistry) {
  if (!rawRegistry || typeof rawRegistry !== "object") return {};
  const record = rawRegistry;
  const source = record.entries && typeof record.entries === "object" ? record.entries : record;
  const normalized = {};
  for (const [key, val] of Object.entries(source)) {
    if (typeof key === "string" && typeof val === "string" && val.trim()) {
      normalized[key] = val.trim();
    }
  }
  return normalized;
}
function extractClozeCardOrdinals(questionHtml) {
  const found = /* @__PURE__ */ new Set();
  const regex = /\{\{c(\d+)::/gi;
  let m;
  while ((m = regex.exec(questionHtml || "")) !== null) {
    const idx = Number(m[1]);
    if (Number.isFinite(idx) && idx >= 1 && idx <= 50) {
      found.add(idx - 1);
    }
  }
  if (found.size === 0) return [0];
  return Array.from(found).sort((a, b) => a - b);
}
function decodeDataImageUriSync(dataUri) {
  const commaIdx = dataUri.indexOf(",");
  if (commaIdx === -1) return null;
  const header = dataUri.slice(5, commaIdx);
  const payload = dataUri.slice(commaIdx + 1);
  const mime = header.split(";")[0].trim().toLowerCase();
  if (!mime.startsWith("image/")) return null;
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : mime.includes("svg") ? "svg" : "jpg";
  let data;
  try {
    if (/;base64(?:;|$)/i.test(header)) {
      data = Buffer.from(payload.replace(/\s+/g, ""), "base64");
    } else {
      data = Buffer.from(decodeURIComponent(payload), "utf8");
    }
  } catch {
    data = Buffer.from(payload, "utf8");
  }
  return data.length > 0 ? { ext, data } : null;
}
function sanitizeFieldMediaForApkg(rawHtml, resolvedByLowerName, referencedFiles, cleanDeckKey = "internato_deck", noteId = 0) {
  if (!rawHtml) return "";
  let out = rawHtml;
  out = out.replace(
    /<audio\b[^>]*>[\s\S]*?<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/audio>/gi,
    (_full, srcVal) => {
      const base = normalizeLocalAssetBasename(srcVal);
      return base ? `[sound:${base}]` : "";
    }
  );
  out = out.replace(
    /<audio\b[^>]*\bsrc=["']([^"']+)["'][^>]*>(?:[\s\S]*?<\/audio>)?/gi,
    (_full, srcVal) => {
      const base = normalizeLocalAssetBasename(srcVal);
      return base ? `[sound:${base}]` : "";
    }
  );
  out = out.replace(
    /<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>/gi,
    (fullTag, beforeAttrs, srcVal, afterAttrs) => {
      const trimmedSrc = (srcVal || "").trim();
      if (!trimmedSrc) return "";
      if (/^(?:pdfimg|buscar_imagem):/i.test(trimmedSrc)) {
        return "";
      }
      const dataAnkiAttr = fullTag.match(/\bdata-anki-file=["']([^"']+)["']/i)?.[1];
      const baseFromAttr = dataAnkiAttr ? normalizeLocalAssetBasename(dataAnkiAttr) : "";
      const cleanedAttrs = `${beforeAttrs} ${afterAttrs}`.replace(/\s*\bdata-anki-file=["'][^"']*["']/gi, "").replace(/\s+/g, " ").trim();
      if (/^data:image\//i.test(trimmedSrc)) {
        const decoded = decodeDataImageUriSync(trimmedSrc);
        if (!decoded) return "";
        const sha8 = crypto2.createHash("sha256").update(decoded.data).digest("hex").slice(0, 8);
        let targetFilename = baseFromAttr || `${cleanDeckKey}_${noteId}_${sha8}.${decoded.ext}`;
        const existingBuf = referencedFiles.get(targetFilename);
        if (existingBuf && !existingBuf.equals(decoded.data)) {
          const extMatch = targetFilename.match(/(\.[a-z0-9]{2,5})$/i);
          const ext = extMatch ? extMatch[1] : `.${decoded.ext}`;
          const stem = targetFilename.replace(/\.[a-z0-9]{2,5}$/i, "");
          targetFilename = `${stem}_${sha8}${ext}`;
        }
        referencedFiles.set(targetFilename, decoded.data);
        return cleanedAttrs ? `<img src="${targetFilename}" ${cleanedAttrs}>` : `<img src="${targetFilename}">`;
      }
      const baseFromSrc = normalizeLocalAssetBasename(trimmedSrc);
      const resolved = resolvedByLowerName.get(baseFromSrc.toLowerCase()) || (baseFromAttr ? resolvedByLowerName.get(baseFromAttr.toLowerCase()) : void 0);
      if (resolved) {
        referencedFiles.set(resolved.filename, resolved.data);
        return cleanedAttrs ? `<img src="${resolved.filename}" ${cleanedAttrs}>` : `<img src="${resolved.filename}">`;
      }
      return "";
    }
  );
  out = out.replace(/\[sound:([^\]]+)\]/gi, (_full, soundTarget) => {
    const base = normalizeLocalAssetBasename(soundTarget);
    if (!base) return "";
    const resolved = resolvedByLowerName.get(base.toLowerCase());
    if (resolved) {
      referencedFiles.set(resolved.filename, resolved.data);
      return `[sound:${resolved.filename}]`;
    }
    return "";
  });
  return out.replace(/^(?:\s*<br\s*\/?>\s*)+/i, "").replace(/(?:\s*<br\s*\/?>\s*)+$/i, "").trim();
}
var sqlJsPromise = null;
function getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs();
  }
  return sqlJsPromise;
}
async function buildAnkiApkgBuffer(params) {
  const SQL = await getSqlJs();
  const db = new SQL.Database();
  const nowSec = Math.floor(Date.now() / 1e3);
  const cleanDeckKey = sanitizeDeckKeyForAnki(params.deckKey || "internato_deck", "internato_deck");
  const deckId = typeof params.deckId === "number" && params.deckId > 1 ? params.deckId : computeDeckIdFromKey(cleanDeckKey);
  const deckName = (params.deckName || cleanDeckKey.replace(/_/g, " ")).trim();
  const updatedRegistry = normalizeGuidRegistryMap(params.guidRegistry);
  const resolvedByLowerName = /* @__PURE__ */ new Map();
  for (const mediaItem of params.resolvedMedia || []) {
    const canonicalName = normalizeLocalAssetBasename(mediaItem?.filename || "");
    if (!canonicalName || !mediaItem?.data || mediaItem.data.length === 0) continue;
    const lower = canonicalName.toLowerCase();
    if (!resolvedByLowerName.has(lower)) {
      resolvedByLowerName.set(lower, { filename: canonicalName, data: mediaItem.data });
    }
  }
  const referencedMediaFiles = /* @__PURE__ */ new Map();
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
  db.run(`INSERT INTO col VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
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
  ]);
  const insertNoteStmt = db.prepare(
    `INSERT OR REPLACE INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertCardStmt = db.prepare(
    `INSERT OR REPLACE INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const usedNoteIds = /* @__PURE__ */ new Set();
  const usedCardIds = /* @__PURE__ */ new Set();
  let dueCursor = 1;
  (params.notes || []).forEach((note, index) => {
    let nid = Number(note.id) > 0 ? Math.trunc(Number(note.id)) : 171000101 + index;
    while (usedNoteIds.has(nid)) {
      nid++;
    }
    usedNoteIds.add(nid);
    const regKey = `${cleanDeckKey}:id:${nid}`;
    const guid = updatedRegistry[regKey] || genankiGuidFor(deckId, cleanDeckKey, nid);
    updatedRegistry[regKey] = guid;
    const isCloze = note.type === "cloze";
    const mid = isCloze ? CLOZE_MODEL_ID : BASIC_MODEL_ID;
    const qField = sanitizeFieldMediaForApkg(
      String(note.question || ""),
      resolvedByLowerName,
      referencedMediaFiles,
      cleanDeckKey,
      nid
    );
    const tField = sanitizeFieldMediaForApkg(
      String(note.topic || ""),
      resolvedByLowerName,
      referencedMediaFiles,
      cleanDeckKey,
      nid
    );
    const aField = isCloze ? "" : sanitizeFieldMediaForApkg(
      String(note.answer || ""),
      resolvedByLowerName,
      referencedMediaFiles,
      cleanDeckKey,
      nid
    );
    let hField = sanitizeFieldMediaForApkg(
      String(note.hint || ""),
      resolvedByLowerName,
      referencedMediaFiles,
      cleanDeckKey,
      nid
    );
    if (!/<img\b/i.test(qField) && !/<img\b/i.test(hField)) {
      hField = hField.replace(
        /^<i>[^<]*<\/i>(?:\s*<br\s*\/?>\s*)*(?=<b>\s*Coment[aá]rio\s*:?\s*<\/b>)/i,
        ""
      ).trim();
    }
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
    insertNoteStmt.run([nid, guid, mid, nowSec, -1, tagsStr, flds, sfld, csum, 0, ""]);
    const cardOrdinals = isCloze ? extractClozeCardOrdinals(qField) : [0];
    for (const ord of cardOrdinals) {
      let cid = ord === 0 ? nid < 1e11 ? nid * 10 + 1 : nid : nid < 1e11 ? nid * 10 + ord + 1 : nid + ord * 1000003;
      while (usedCardIds.has(cid)) {
        cid++;
      }
      usedCardIds.add(cid);
      insertCardStmt.run([
        cid,
        nid,
        deckId,
        ord,
        nowSec,
        -1,
        0,
        0,
        dueCursor++,
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
    }
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
  let mediaIndex = 0;
  for (const [filename, data] of referencedMediaFiles.entries()) {
    const numKey = String(mediaIndex++);
    mediaJsonMap[numKey] = filename;
    zipEntries.push({
      name: numKey,
      data
    });
  }
  zipEntries.push({
    name: "media",
    data: Buffer.from(JSON.stringify(mediaJsonMap), "utf8")
  });
  return {
    apkgBuffer: buildZipArchive(zipEntries),
    updatedRegistry
  };
}

// server/mediaSearch.ts
import { ThinkingLevel as ThinkingLevel3 } from "@google/genai";
var PT_TO_EN_MEDICAL_TERMS = [
  [/\bbloqueio\s+de\s+ramo\s+direito|\bbrd\b/gi, "right bundle branch block ECG"],
  [/\bbloqueio\s+de\s+ramo\s+esquerdo|\bbre\b/gi, "left bundle branch block ECG"],
  [/\bwolff[-\s]?parkinson[-\s]?white|\bwpw\b|\bonda\s+delta\b|\bpr[eé][-\s]?excita[cç][aã]o\b/gi, "Wolff-Parkinson-White syndrome delta wave ECG"],
  [/\bbrugada\b/gi, "Brugada syndrome ECG"],
  [/\bapendicite(?:\s+aguda)?\b/gi, "acute appendicitis CT ultrasound"],
  [/\bdiverticulite(?:\s+aguda)?\b/gi, "acute diverticulitis abdominal CT"],
  [/\bcolecistite(?:\s+aguda)?\b/gi, "acute cholecystitis gallbladder ultrasound"],
  [/\bpancreatite(?:\s+aguda)?\b/gi, "acute pancreatitis abdominal CT"],
  [/\bpneumot[oó]rax(?:\s+hipertensivo)?\b/gi, "tension pneumothorax chest x-ray"],
  [/\bhemot[oó]rax\b/gi, "hemothorax chest x-ray"],
  [/\bpneumoperit[oô]nio\b/gi, "pneumoperitoneum upright chest x-ray"],
  [/\bedema\s+agudo\s+de\s+pulm[aã]o\b/gi, "acute pulmonary edema bat wing chest x-ray"],
  [/\binsufici[eê]ncia\s+card[ií]aca\b/gi, "congestive heart failure cardiomegaly chest x-ray"],
  [/\binfarto|iam|supradesnivelamento|supra\s+de\s+st\b/gi, "ST elevation myocardial infarction ECG LITFL"],
  [/\binfradesnivelamento|infra\s+de\s+st|isquemia\s+subendoc[aá]rdica\b/gi, "ST depression myocardial ischemia ECG"],
  [/\bfibrila[cç][aã]o\s+atrial\b/gi, "atrial fibrillation ECG rhythm strip"],
  [/\btaquicardia\s+ventricular|torsades\b/gi, "ventricular tachycardia torsades de pointes ECG"],
  [/\btaquicardia\s+supraventricular|tpsv\b/gi, "supraventricular tachycardia narrow complex ECG"],
  [/\bflutter\s+atrial\b/gi, "atrial flutter sawtooth ECG"],
  [/\bbloqueio\s+atrioventricular|bav\s+total|bavt|mobitz\b/gi, "third degree AV block complete heart block ECG"],
  [/\bpericardite\b/gi, "acute pericarditis diffuse ST elevation ECG"],
  [/\bhipercalemia\b/gi, "hyperkalemia peaked T waves ECG"],
  [/\bcardiotocografia|dip\s+ii|desacelera[cç][aã]o|sofrimento\s+fetal|taquissistolia|hiperestimula[cç][aã]o\s+uterina\b/gi, "cardiotocography fetal heart rate late deceleration CTG"],
  [/\b[íi]ndice\s+de\s+bishop|\bescore\s+de\s+bishop|\bamadurecimento\s+cervical|\bcolo\s+(?:favor[áa]vel|desfavor[áa]vel)\b/gi, "Bishop score cervical ripening obstetrics"],
  [/\bindu[cç][aã]o\s+do\s+parto|misoprostol|ocitocina\b/gi, "labor induction cervical ripening obstetrics"],
  [/\bpr[eé][-\s]?ecl[aâ]mpsia|ecl[aâ]mpsia|s[ií]ndrome\s+hellp\b/gi, "HELLP syndrome schistocytes peripheral blood smear"],
  [/\bhemorragia\s+p[oó]s[-\s]?parto|bal[aã]o\s+de\s+bakri|atonia\s+uterina\b/gi, "postpartum hemorrhage Bakri balloon tamponade"],
  [/\bgravidez\s+ect[oó]pica\b/gi, "ectopic pregnancy transvaginal ultrasound"],
  [/\bdescolamento\s+prematuro\s+de\s+placenta|placenta\s+pr[eé]via\b/gi, "placental abruption placenta previa ultrasound"],
  [/\bpartograma|\bparada\s+secund[aá]ria|\bdist[oó]cia\s+funcional\b/gi, "partogram labor dystocia cervical dilation curve"],
  [/\bmanobras?\s+de\s+leopold\b/gi, "Leopold's maneuvers abdominal palpation obstetrics"],
  [/\bdist[oó]cia\s+de\s+ombro|\bmcroberts|\brubin|\bwoods|\bjacquemier|\bsinal\s+da\s+tartaruga\b/gi, "shoulder dystocia McRoberts maneuver obstetrics"],
  [/\bf[oó]rcipe|\bsimpson|\bkielland|\bpiper|\bv[aá]cuo[-\s]?extrator\b/gi, "obstetric forceps operative vaginal delivery"],
  [/\bplanos?\s+de\s+de\s?lee|\bpelvimetria|\bbacia\s+obst[eé]trica|\bestreito\s+(?:superior|m[eé]dio|inferior)\b/gi, "fetal station De Lee planes pelvimetry pelvis"],
  [/\bepisiotomia|\blacera[cç][aã]o\s+perineal\b/gi, "episiotomy perineal laceration obstetrics"],
  [/\bpneumonia\b/gi, "lobar pneumonia consolidation chest x-ray"],
  [/\btuberculose\b/gi, "pulmonary tuberculosis cavitation chest x-ray"],
  [/\bderrame\s+pleural\b/gi, "pleural effusion chest x-ray meniscus sign"],
  [/\btromboembolismo\s+pulmonar|\btep\b/gi, "pulmonary embolism CT pulmonary angiography"],
  [/\bavc\s+isqu[eê]mico\b/gi, "ischemic stroke brain CT"],
  [/\bavc\s+hemorr[aá]gico|hemorragia\s+subaracn[oó]idea\b/gi, "subarachnoid hemorrhage head CT"],
  [/\bhematoma\s+epidural\b/gi, "epidural hematoma biconvex lens head CT"],
  [/\bhematoma\s+subdural\b/gi, "subdural hematoma crescent head CT"],
  [/\bobstru[cç][aã]o\s+intestinal|volvo\b/gi, "bowel obstruction sigmoid volvulus coffee bean x-ray"],
  [/\bintussuscep[cç][aã]o\b/gi, "intussusception target sign pediatric ultrasound"],
  [/\bestenose\s+hipertr[oó]fica\s+de\s+piloro\b/gi, "hypertrophic pyloric stenosis ultrasound"],
  [/\bepigloti(?:te|tis)|crupe|laringotraque[ií]te\b/gi, "croup steeple sign epiglottitis thumbprint neck x-ray"],
  [/\bbronquiolite\b/gi, "bronchiolitis chest x-ray hyperinflation pediatric"],
  [/\bdoen[cç]a\s+da\s+membrana\s+hialina|s[ií]ndrome\s+do\s+desconforto\b/gi, "neonatal respiratory distress syndrome ground glass chest x-ray"],
  [/\bretinopatia\s+hipertensiva|retinopatia\s+diab[eé]tica|fundoscopia\b/gi, "hypertensive diabetic retinopathy fundus photography"],
  [/\bpapiledema\b/gi, "papilledema optic disc fundoscopy"],
  [/\bmelanoma|carcinoma\s+basocelular|dermatoscopia\b/gi, "melanoma basal cell carcinoma dermoscopy"],
  [/\bherpes\s+zoster|varicela|impetigo|celulite|erisipela|psor[ií]ase|escabiose\b/gi, "dermatology skin lesion rash clinical photograph"],
  [/\bs[ií]filis|cancro|linfogranuloma\b/gi, "secondary syphilis palmar plantar rash clinical photo"],
  [/\bcirrose|ascite|varizes\s+esof[aá]gicas\b/gi, "esophageal varices endoscopy liver cirrhosis"],
  [/\bfratura|luxa[cç][aã]o|osteomielite|colles|monteggia\b/gi, "bone fracture dislocation radiograph x-ray"],
  [/\bleucemia|esfrega[cç]o|anemia\s+falciforme|drepan[oó]cito|bastonete\s+de\s+auer\b/gi, "peripheral blood smear microscopy hematology"]
];
var BLOCKED_IMAGE_URL_PATTERN = /(?:logo|icon|favicon|avatar|gravatar|pb-primary|dark-mode|banner|badge|pixel|1x1|sprite|spinner|button|social|share|commons-logo|ambox|edit-clear|question_book|crystal_clear|padlock|symbol_|flag_of_|coat_of_arms|map_of_|blank_map|wikimedia-button|poweredby|boeing|airlines|airport|stamp_of_|coin_|portrait_of_|bust_of_|headshot|scientist|einthoven|nobel|biography|author_photo|pill_bottle|medication_box|tablet_pack|capsule_pack|stethoscope|syringe|clipart|diatom|microfossil|focusstack|brightfield|diatomaceous|galaxy|nebula|volcano|glacier|insect|beetle|butterfly|orchid|consecration|archbishop|cathedral|diocese|clergy|accouchement_vers_1800|kardiotokograf)/i;
var WIKIMEDIA_USER_AGENT = "Cards20MedicalApp/2.0 (https://github.com/wagmms/Cards-2.0)";
var MODALITY_KEYWORDS = [
  {
    name: "ecg",
    ptEnTrigger: /\b(ecg|eletrocardiograma|ritmo|st|supra|infra|arritmia|fibrilacao|flutter|bav|taquicardia|qrs|onda)\b/i,
    candidateMatch: /\b(ecg|ekg|electrocardiogram|rhythm|lead|litfl|qrs|st[\s_-]?elevation|arrhythmia|flutter|fibrillation|block)\b/i
  },
  {
    name: "xray",
    ptEnTrigger: /\b(rx|radiografia|raio[\s-]?x|torax|pneumotorax|pneumoperitonio|derrame|fratura|volvo|crupe|epiglotite)\b/i,
    candidateMatch: /\b(x[\s_-]?ray|radiograph|radiology|chest|pneumothorax|pneumoperitoneum|fracture|effusion|consolidation|thorax|rx)\b/i
  },
  {
    name: "ct",
    ptEnTrigger: /\b(tc|tomografia|angiotc|hematoma|avc|hemorragia|pancreatite|diverticulite|apendicite|tep)\b/i,
    candidateMatch: /\b(ct|computed\s+tomography|scan|angiography|hematoma|subarachnoid|stroke|radiopaedia|axial)\b/i
  },
  {
    name: "usg",
    ptEnTrigger: /\b(usg|ultrassom|ultrassonografia|ecografia|fast|e[\s-]?fast|colecistite|ectopica|intussuscepcao|piloro)\b/i,
    candidateMatch: /\b(ultrasound|sonography|ultrasonography|sonogram|doppler|transvaginal|gallbladder|fast)\b/i
  },
  {
    name: "ctg",
    ptEnTrigger: /\b(ctg|cardiotocografia|desaceleracao|desaceleracoes|dip\s*[i123]?|taquissistolia|variabilidade\s+(?:ausente|minima|moderada)|sofrimento\s+fetal|monitorizacao\s+fetal|frequencia\s+cardiaca\s+fetal|linha\s+de\s+base\s+fetal)\b/i,
    candidateMatch: /\b(ctg|cardiotocography|fetal|deceleration|tachysystole|contraction|trace)\b/i
  },
  {
    name: "partograma",
    ptEnTrigger: /\b(partograma|dilatacao\s+cervical|linha\s+de\s+alerta|linha\s+de\s+acao|curva\s+de\s+friedman|parada\s+secundaria)\b/i,
    candidateMatch: /\b(partogra\w*|cervical\s+dilation|friedman|alert\s+line|action\s+line|labor\s+curve|who)\b/i
  },
  {
    name: "shoulder_dystocia",
    ptEnTrigger: /\b(distocia\s+de\s+ombro|mcroberts|rubin|woods|jacquemier|zavanelli|sinal\s+da\s+tartaruga)\b/i,
    candidateMatch: /\b(shoulder\s+dystocia|mcroberts|rubin|woods|suprapubic|clavicle\s+fracture|dystocia)\b/i
  },
  {
    name: "leopold_maneuver",
    ptEnTrigger: /\b(manobras?\s+de\s+leopold|leopold|handgriff)\b/i,
    candidateMatch: /\b(leopold|handgriff|abdominal\s+palpation)\b/i
  },
  {
    name: "operative_delivery",
    ptEnTrigger: /\b(forcipe|forceps|simpson|kielland|piper|vacuo[-\s]?extrator|parto\s+instrumental)\b/i,
    candidateMatch: /\b(forceps|vacuum\s+extractor|ventouse|operative\s+vaginal\s+delivery)\b/i
  },
  {
    name: "episiotomy_perineal",
    ptEnTrigger: /\b(episiotomia|episiotomy|laceracao\s+perineal)\b/i,
    candidateMatch: /\b(episiotomy|perineal\s+laceration|mediolateral)\b/i
  },
  {
    name: "breech_presentation",
    ptEnTrigger: /\b(apresentacao\s+pelvica|parto\s+pelvico|breech|brach|mauriceau)\b/i,
    candidateMatch: /\b(breech|brach|mauriceau)\b/i
  },
  {
    name: "pelvimetry",
    ptEnTrigger: /\b(pelvimetria|bacia\s+obstetrica|sinclitismo|assinclitismo|estreito\s+(?:superior|medio|inferior)|planos?\s+de\s+de\s?lee)\b/i,
    candidateMatch: /\b(pelvimetry|pelvic\s+inlet|conjugate|synclitism|asynclitism|fetal\s+station|de\s+lee)\b/i
  },
  {
    name: "derm",
    ptEnTrigger: /\b(dermatoscopia|melanoma|lesao|pele|rash|exantema|herpes|zoster|sifilis|basocelular|eritema)\b/i,
    candidateMatch: /\b(derm|dermoscopy|skin|lesion|rash|melanoma|carcinoma|zoster|syphilis|maculopapular|erythema|dermnet)\b/i
  },
  {
    name: "fundus",
    ptEnTrigger: /\b(fundoscopia|fundo\s+de\s+olho|retinopatia|papiledema|retina|disco\s+optico)\b/i,
    candidateMatch: /\b(fundus|fundoscopy|retina|retinopathy|papilledema|optic[\s_-]?disc|ophthalm)\b/i
  },
  {
    name: "smear",
    ptEnTrigger: /\b(esfregaco|hematoscopia|lamina|esquizocito|falciforme|auer|leucemia|hellp)\b/i,
    candidateMatch: /\b(smear|microscopy|schistocyte|sickle|histology|hematology|auer|cell|blood)\b/i
  }
];
function isSvgImageUrl(url, mime = "") {
  const cleanPath = (url || "").split("?")[0].split("#")[0].toLowerCase();
  if (/\.(?:png|jpe?g|webp|gif|avif)$/.test(cleanPath)) {
    return false;
  }
  return mime.toLowerCase().includes("svg") || /\.svg(?:\/|$)/.test(cleanPath);
}
function isSpamOrLogoImageUrl(url, title = "") {
  const combined = `${url} ${title}`;
  if (!url || BLOCKED_IMAGE_URL_PATTERN.test(combined)) return true;
  if (/\.(?:tif|tiff|pdf|djvu|ogg|ogv|webm|mp4|mp3|wav)$/i.test(url.split("?")[0])) {
    return true;
  }
  return false;
}
function normalizeImageCanonicalKey(url, fallbackTitle = "") {
  const cleanUrl = (url || "").trim().split("#")[0].split("?")[0].toLowerCase();
  if (!cleanUrl) return fallbackTitle.trim().toLowerCase();
  try {
    const parsed = new URL(cleanUrl);
    const pathname = decodeURIComponent(parsed.pathname);
    if (parsed.hostname.includes("wikimedia.org") || parsed.hostname.includes("wikipedia.org")) {
      const thumbMatch = pathname.match(/\/thumb\/[^/]+\/[^/]+\/([^/]+)\/\d+px-[^/]+$/i);
      if (thumbMatch && thumbMatch[1]) {
        return `wikimedia:${thumbMatch[1].replace(/\s+/g, "_")}`;
      }
      const lastSeg = pathname.split("/").pop() || pathname;
      const strippedPx = lastSeg.replace(/^\d+px-/i, "");
      return `wikimedia:${strippedPx.replace(/\s+/g, "_")}`;
    }
    return `${parsed.hostname.replace(/^www\./, "")}${pathname}`;
  } catch {
    return cleanUrl.replace(/^http:\/\//i, "https://");
  }
}
function tokenizeNormalized(text) {
  return (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((w) => w.length >= 3);
}
function scoreImageRelevance(candidate, context) {
  let score = 0;
  const queryContextText = [
    context.answer || "",
    context.query,
    context.topic || "",
    context.question || "",
    ...context.enQueries || []
  ].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const candidateText = [
    candidate.title,
    candidate.description,
    candidate.source,
    candidate.thumbUrl,
    candidate.fullUrl
  ].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let expectedModalityMatched = false;
  for (const mod of MODALITY_KEYWORDS) {
    if (mod.ptEnTrigger.test(queryContextText)) {
      if (mod.candidateMatch.test(candidateText)) {
        score += 36;
        expectedModalityMatched = true;
      } else {
        score -= 10;
      }
    }
  }
  if (!expectedModalityMatched) {
    for (const mod of MODALITY_KEYWORDS) {
      if (mod.candidateMatch.test(candidateText)) {
        score += 8;
        break;
      }
    }
  }
  const answerTokens = new Set(tokenizeNormalized(context.answer || ""));
  const enTokens = new Set(tokenizeNormalized((context.enQueries || []).join(" ")));
  const ptTokens = new Set(
    tokenizeNormalized(`${context.query} ${context.topic || ""}`)
  );
  const candTokenList = tokenizeNormalized(candidateText);
  const candTokens = new Set(candTokenList);
  const hasTokenHit = (tok) => {
    if (candTokens.has(tok)) return true;
    if (tok.length < 6) return false;
    return candTokenList.some(
      (ctok) => ctok.length >= 6 && (ctok.startsWith(tok) || tok.startsWith(ctok))
    );
  };
  let answerHits = 0;
  for (const tok of answerTokens) {
    if (hasTokenHit(tok)) answerHits++;
  }
  let enHits = 0;
  for (const tok of enTokens) {
    if (hasTokenHit(tok)) enHits++;
  }
  let ptHits = 0;
  for (const tok of ptTokens) {
    if (hasTokenHit(tok)) ptHits++;
  }
  score += Math.min(44, answerHits * 11 + enHits * 9 + ptHits * 6);
  if (!expectedModalityMatched && answerHits + enHits + ptHits === 0) {
    score -= 28;
  }
  const srcLower = `${candidate.source} ${candidate.fullUrl}`.toLowerCase();
  if (/litfl|lifeinthefastlane/.test(srcLower)) score += 24;
  else if (/radiopaedia/.test(srcLower)) score += 24;
  else if (/dermnet/.test(srcLower)) score += 22;
  else if (/pmc\.ncbi|ncbi\.nlm\.nih|scielo|nejm|bmj|openi/.test(srcLower)) score += 18;
  else if (/wikipedia/.test(srcLower)) score += 12;
  else if (/wikimedia/.test(srcLower)) score += 10;
  else if (/google/.test(srcLower)) score += 8;
  const qLower = queryContextText.toLowerCase();
  const cLower = candidateText.toLowerCase();
  const qRight = /\b(direita|direito|right|brd|rbbb|dextro)\b/.test(qLower);
  const qLeft = /\b(esquerda|esquerdo|left|bre|lbbb|sinistro)\b/.test(qLower);
  const cRight = /\b(direita|direito|right|brd|rbbb|dextro)\b/.test(cLower);
  const cLeft = /\b(esquerda|esquerdo|left|bre|lbbb|sinistro)\b/.test(cLower);
  if (qRight && !qLeft && cLeft && !cRight || qLeft && !qRight && cRight && !cLeft) {
    score -= 75;
  }
  const qSupra = /\b(supra|supradesnivelamento|st[\s_-]?elevation|stemi|iamcsst)\b/.test(qLower);
  const qInfra = /\b(infra|infradesnivelamento|st[\s_-]?depression|iamssst|subendocardic)\b/.test(qLower);
  const cSupra = /\b(supra|supradesnivelamento|st[\s_-]?elevation|stemi)\b/.test(cLower);
  const cInfra = /\b(infra|infradesnivelamento|st[\s_-]?depression|nstemi)\b/.test(cLower);
  if (qSupra && !qInfra && cInfra && !cSupra || qInfra && !qSupra && cSupra && !cInfra) {
    score -= 75;
  }
  const expectsSchematicOrDiagram = /\b(?:manobra|leopold|mcroberts|rubin|woods|jacquemier|partograma|partogram|pelve|pelvimetria|de\s?lee|plano\s+de\s+de\s?lee|mecanismo\s+de\s+parto|forcipe|fluxograma|algoritmo|esquema|curva)\b/i.test(
    queryContextText
  );
  const isThumbRawSvg = Boolean(candidate.isSvg) || isSvgImageUrl(candidate.thumbUrl);
  const isSourceSvgOnly = !isThumbRawSvg && isSvgImageUrl(candidate.fullUrl);
  if (isThumbRawSvg || !expectsSchematicOrDiagram && isSourceSvgOnly) {
    score -= 22;
  }
  if (!expectsSchematicOrDiagram && /\b(diagram|schematic|flowchart|cartoon|illustration|map|chart|graph)\b/i.test(candidateText)) {
    score -= 14;
  }
  if (/\b(hospital|building|doctor|physician|university|campus|portrait|statue|island|bridge|forest|lake|garden|flower|plant|botany|landscape|biography|scientist|inventor|nobel|pill|tablet|capsule|bottle|packaging|stethoscope|syringe|stock[\s_-]?photo|consecration|archbishop|cathedral|diocese|clergy|ordained|catholic|anglican)\b/i.test(candidateText)) {
    score -= 80;
  }
  if (/\b(?:ecg|ekg|electrocardiogram|eletrocardiograma|x-ray|radiograph|tomography|tomografia|ultrasound|ultrassom|ultrassonografia|e-?fast)\b/i.test(queryContextText) && /(?:fluorescence|confocal|islet|pancrea|immunofluorescence|histolog|microscop|diatom|microfossil|brightfield)/i.test(candidateText)) {
    score -= 90;
  }
  const expectsEcgQuery = /\b(?:ecg|ekg|electrocardiogra\w*|eletrocardiogra\w*|stemi|flutter|fibrillation|brugada|wpw|delta\s+wave|bundle\s+branch|peaked\s+t\s+wave|av\s+block|torsades)\b/i.test(
    queryContextText
  ) && !/\b(?:echocardiogra\w*|ecocardiogra\w*|doppler|m[-\s]?mode)\b/i.test(queryContextText);
  if (expectsEcgQuery && /\b(?:echocardiogra\w*|ecocardiogra\w*|echopedia|m[-\s]?mode|doppler|ultrasound|sonogram|sonography)\b/i.test(
    candidateText
  )) {
    score -= 85;
  }
  const expectsPathology = /\b(?:stemi|infarction|ischemia|flutter|fibrillation|block|wpw|brugada|hyperkalemia|vt|svt|torsades|supradesnivelamento|infradesnivelamento|arritmia|bloqueio|taquicardia)\b/i.test(
    queryContextText
  ) && !/\b(?:normal\s+sinus|ritmo\s+sinusal\s+normal)\b/i.test(queryContextText);
  const normalEcgRegex = /\b(?:normal\s+(?:sinus|ecg|ekg|12[-\s]?lead|rhythm)|sinus\s+rhythm\s+normal|healthy\s+control)\b/i;
  if (expectsPathology && normalEcgRegex.test(candidate.title || "")) {
    score -= 45;
  } else if (expectsPathology && normalEcgRegex.test(candidateText) && answerHits + enHits < 2) {
    score -= 32;
  }
  const cleanThumbLower = (candidate.thumbUrl || "").split("?")[0].toLowerCase();
  const cleanFullLower = (candidate.fullUrl || "").split("?")[0].toLowerCase();
  if (/\.gif$/i.test(cleanThumbLower) || /\.gif$/i.test(cleanFullLower)) {
    score -= 45;
  }
  return score;
}
function buildEnglishMedicalSearchQueries(rawQuery, topic = "", question = "", answer = "") {
  const queries = [];
  const primaryText = `${answer} ${rawQuery} ${topic}`.trim();
  const isEcgContext = /\b(?:ecg|ekg|eletrocardiograma|tra[cç]ado|qrs|onda\s+[prqt]|onda\s+delta|v1|v6|derivac|arritmia|bloqueio\s+de\s+ramo)\b/i.test(
    `${primaryText} ${question}`
  );
  for (const [regex, enTerm] of PT_TO_EN_MEDICAL_TERMS) {
    regex.lastIndex = 0;
    if (regex.test(primaryText) && !queries.includes(enTerm)) {
      queries.push(enTerm);
      if (queries.length >= 2) break;
    }
  }
  if (queries.length === 0 && question) {
    for (const [regex, enTerm] of PT_TO_EN_MEDICAL_TERMS) {
      regex.lastIndex = 0;
      if (isEcgContext && /chest x-ray/i.test(enTerm)) continue;
      if (regex.test(question) && !queries.includes(enTerm)) {
        queries.push(enTerm);
        if (queries.length >= 2) break;
      }
    }
  }
  const stripped = (answer || rawQuery || topic).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(
    /\b(?:na|no|nos|nas|em|de|do|da|dos|das|para|com|sem|qual|quais|conduta|imediata|primeira|escolha|linha|tratamento|manejo|paciente|gestante|evolui|apresenta|reacao|adversa|exame|achado|orelha|coelho|torre|padrao)\b/gi,
    " "
  ).replace(/\s+/g, " ").trim();
  if (stripped && !queries.includes(stripped)) {
    queries.push(isEcgContext && !/\becg\b/i.test(stripped) ? `${stripped} ECG` : stripped);
  }
  if (queries.length === 0) {
    queries.push(isEcgContext ? "electrocardiogram arrhythmia ECG" : "clinical medical imaging diagnosis");
  }
  return queries.slice(0, 3);
}
function combineSignals(parentSignal, timeoutMs = 4e3) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!parentSignal) return timeoutSignal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([parentSignal, timeoutSignal]);
  }
  return timeoutSignal;
}
async function expandMedicalQueriesWithGemini(ai, rawQuery, topic = "", question = "", hint = "", signal, answer = "") {
  const fallbackQueries = buildEnglishMedicalSearchQueries(rawQuery, topic, question, answer);
  if (!ai) return fallbackQueries;
  try {
    const res = await generateContentWithRetry(
      ai,
      {
        model: FALLBACK_GEMINI_MODEL,
        contents: `Traduza e expanda esta busca cl\xEDnica para encontrar IMAGENS M\xC9DICAS REAIS na internet (Wikimedia Commons, Wikipedia, Radiopaedia, LITFL, DermNet, PubMed).
REGRAS: Foque no diagn\xF3stico principal e modalidade de exame (ex: se for ECG, inclua "ECG"). Ignore comorbidades secund\xE1rias da vinheta e nunca traduza met\xE1foras ao p\xE9 da letra ("orelha de coelho", "em torre").
Retorne EXCLUSIVAMENTE um JSON array com 2 a 3 termos curtos em INGL\xCAS (2 a 5 palavras cada):
- Diagn\xF3stico/Resposta: "${answer.slice(0, 120)}"
- Busca: "${rawQuery.slice(0, 120)}"
- T\xF3pico: "${topic}"
- Pergunta: "${question.slice(0, 180)}"
- Coment\xE1rio: "${hint.slice(0, 160)}"
Exemplo de sa\xEDda: ["right bundle branch block ECG", "RBBB V1 ECG LITFL"]`,
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: 200,
          thinkingConfig: { thinkingLevel: ThinkingLevel3.MINIMAL }
        }
      },
      { signal, timeoutMs: 4500, enableModelFallback: false }
    );
    const parsed = JSON.parse(extractJsonBlock(res.text || "[]"));
    if (Array.isArray(parsed)) {
      const llmQueries = parsed.map((q) => String(q || "").trim()).filter((q) => q.length >= 3 && q.length <= 70);
      if (llmQueries.length > 0) {
        return Array.from(/* @__PURE__ */ new Set([...llmQueries, ...fallbackQueries])).slice(0, 3);
      }
    }
  } catch {
  }
  return fallbackQueries;
}
function buildSuggestedMediaFilename(rawBaseName, targetUrl, mime = "", fallbackSlug = "med_image") {
  const urlPath = (targetUrl || "").split("?")[0].split("#")[0];
  const extMatch = urlPath.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i);
  const mimeLower = (mime || "").toLowerCase();
  const resolvedExt = extMatch ? `.${extMatch[1].toLowerCase() === "jpeg" ? "jpg" : extMatch[1].toLowerCase()}` : mimeLower.includes("png") ? ".png" : mimeLower.includes("webp") ? ".webp" : mimeLower.includes("gif") ? ".gif" : mimeLower.includes("svg") ? ".svg" : ".jpg";
  const cleanStem = (rawBaseName || fallbackSlug).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
  return `${cleanStem || fallbackSlug}${resolvedExt}`;
}
async function searchWikipediaMedicalImages(enQueries, ptQuery, signal) {
  const enCandidates = Array.from(
    new Set(
      enQueries.map((q) => (q || "").split(/\s+/).slice(0, 4).join(" ").trim()).filter(Boolean)
    )
  ).slice(0, 2);
  const searches = [
    ...enCandidates.map((query) => ({ lang: "en", query })),
    ...ptQuery ? [{ lang: "pt", query: ptQuery }] : []
  ];
  const results = [];
  const seenKeys = /* @__PURE__ */ new Set();
  for (const { lang, query } of searches) {
    if (signal?.aborted || results.length >= 8) break;
    try {
      const searchUrl = new URL(`https://${lang}.wikipedia.org/w/api.php`);
      searchUrl.searchParams.set("action", "query");
      searchUrl.searchParams.set("list", "search");
      searchUrl.searchParams.set("srsearch", query);
      searchUrl.searchParams.set("srlimit", "4");
      searchUrl.searchParams.set("format", "json");
      searchUrl.searchParams.set("origin", "*");
      const sResp = await fetch(searchUrl.toString(), {
        headers: { "User-Agent": WIKIMEDIA_USER_AGENT },
        signal: combineSignals(signal, 3500)
      });
      if (!sResp.ok) continue;
      const sData = await sResp.json();
      const titles = (sData.query?.search || []).map((item) => item.title).filter((t) => Boolean(t));
      if (titles.length === 0) continue;
      const pagesUrl = new URL(`https://${lang}.wikipedia.org/w/api.php`);
      pagesUrl.searchParams.set("action", "query");
      pagesUrl.searchParams.set("titles", titles.join("|"));
      pagesUrl.searchParams.set("prop", "pageimages|images");
      pagesUrl.searchParams.set("piprop", "original|thumbnail");
      pagesUrl.searchParams.set("pithumbsize", "900");
      pagesUrl.searchParams.set("imlimit", "20");
      pagesUrl.searchParams.set("format", "json");
      pagesUrl.searchParams.set("origin", "*");
      const pResp = await fetch(pagesUrl.toString(), {
        headers: { "User-Agent": WIKIMEDIA_USER_AGENT },
        signal: combineSignals(signal, 3500)
      });
      if (!pResp.ok) continue;
      const pData = await pResp.json();
      const expectedTokenSet = new Set(
        tokenizeNormalized([...enQueries, ptQuery].join(" ")).filter(
          (tok) => !["medical", "clinical", "exam", "image", "photo", "sign"].includes(tok)
        )
      );
      const fileTitles = /* @__PURE__ */ new Set();
      for (const page of Object.values(pData.query?.pages || {})) {
        const leadUrl = page.thumbnail?.source || page.original?.source;
        const leadWidth = page.thumbnail?.width || page.original?.width || 400;
        const leadHeight = page.thumbnail?.height || page.original?.height || 300;
        if (leadUrl && leadWidth >= 200 && leadHeight >= 130 && !isSpamOrLogoImageUrl(leadUrl, page.title || "")) {
          const canonicalKey = normalizeImageCanonicalKey(leadUrl, page.title || "");
          if (!seenKeys.has(canonicalKey)) {
            seenKeys.add(canonicalKey);
            results.push({
              id: `wp-${lang}-lead-${page.pageid || results.length}`,
              title: (page.title || query).slice(0, 85),
              thumbUrl: leadUrl,
              fullUrl: page.original?.source || leadUrl,
              description: `Imagem principal do artigo m\xE9dico "${page.title || query}" (${lang}.wikipedia.org).`,
              suggestedFilename: buildSuggestedMediaFilename(
                page.title || query,
                leadUrl,
                "",
                "wikipedia_med"
              ),
              defaultLegend: `Imagem cl\xEDnica referente a ${page.title || query}.`,
              source: `Wikipedia Medical (${lang.toUpperCase()})`,
              isSvg: isSvgImageUrl(leadUrl)
            });
          }
        }
        for (const img of page.images || []) {
          if (!img.title || isSpamOrLogoImageUrl(img.title, img.title)) continue;
          const fileToks = tokenizeNormalized(img.title);
          const sharesToken = expectedTokenSet.size === 0 || fileToks.some((t) => expectedTokenSet.has(t)) || MODALITY_KEYWORDS.some(
            (m) => m.ptEnTrigger.test(`${enQueries.join(" ")} ${ptQuery}`) && m.candidateMatch.test(img.title || "")
          );
          if (sharesToken) {
            fileTitles.add(img.title);
          }
        }
      }
      if (fileTitles.size === 0) continue;
      const fileList = Array.from(fileTitles).slice(0, 12);
      const infoUrl = new URL(`https://${lang}.wikipedia.org/w/api.php`);
      infoUrl.searchParams.set("action", "query");
      infoUrl.searchParams.set("titles", fileList.join("|"));
      infoUrl.searchParams.set("prop", "imageinfo");
      infoUrl.searchParams.set("iiprop", "url|mime|size|extmetadata");
      infoUrl.searchParams.set("iiurlwidth", "900");
      infoUrl.searchParams.set("format", "json");
      infoUrl.searchParams.set("origin", "*");
      const iResp = await fetch(infoUrl.toString(), {
        headers: { "User-Agent": WIKIMEDIA_USER_AGENT },
        signal: combineSignals(signal, 3500)
      });
      if (!iResp.ok) continue;
      const iData = await iResp.json();
      for (const [idx, page] of Object.values(iData.query?.pages || {}).entries()) {
        const info = page.imageinfo?.[0];
        if (!info?.url) continue;
        const mime = (info.mime || "").toLowerCase();
        if (!mime.startsWith("image/")) continue;
        if ((info.width || 0) < 220 || (info.height || 0) < 140) continue;
        const targetUrl = info.thumburl || info.url;
        if (isSpamOrLogoImageUrl(targetUrl, page.title || "")) continue;
        const canonicalKey = normalizeImageCanonicalKey(targetUrl, page.title || "");
        if (seenKeys.has(canonicalKey)) continue;
        seenKeys.add(canonicalKey);
        const rawTitle = (page.title || `Wikipedia Medical ${idx + 1}`).replace(
          /^(?:File|Ficheiro|Arquivo):/i,
          ""
        );
        const descHtml = info.extmetadata?.ImageDescription?.value || rawTitle;
        const cleanDesc = descHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
        results.push({
          id: `wp-${lang}-${page.pageid || idx}`,
          title: rawTitle.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 85),
          thumbUrl: targetUrl,
          fullUrl: info.url,
          description: cleanDesc || `Imagem m\xE9dica enciclop\xE9dica (${lang}.wikipedia.org).`,
          suggestedFilename: buildSuggestedMediaFilename(
            rawTitle,
            targetUrl,
            mime,
            `wikipedia_${page.pageid || idx}`
          ),
          defaultLegend: cleanDesc ? `Imagem cl\xEDnica demonstrando ${cleanDesc.slice(0, 130)}.` : `Imagem cl\xEDnica real referente a ${query}.`,
          source: `Wikipedia Medical (${lang.toUpperCase()})`,
          isSvg: isSvgImageUrl(targetUrl, mime)
        });
      }
    } catch {
    }
  }
  return results;
}
async function searchWikimediaCommonsMedical(enQueries, signal) {
  const results = [];
  const seenKeys = /* @__PURE__ */ new Set();
  const baseWords = (enQueries[0] || "").split(/\s+/).filter(Boolean);
  const firstClean = (baseWords[0] || "").replace(/[^a-z0-9-]/gi, "").toLowerCase();
  const singleSpecificFallback = /^(?:partogra\w*|cardiotocograph\w*|episiotomy|mcroberts|pelvimetry|electrocardiogra\w*|pneumothorax|pneumoperitoneum|intussusception|retinopathy|papilledema|cholecystitis|appendicitis|diverticulitis|pancreatitis)$/i.test(
    firstClean
  ) ? [firstClean] : [];
  const candidateSearches = Array.from(
    new Set(
      [
        baseWords.slice(0, 3).join(" "),
        baseWords.slice(0, 2).join(" "),
        ...enQueries[1] ? [enQueries[1].split(/\s+/).slice(0, 3).join(" ")] : [],
        ...singleSpecificFallback
      ].filter((q) => q.length >= 3)
    )
  );
  for (const enQuery of candidateSearches) {
    if (signal?.aborted || results.length >= 6) break;
    try {
      const url = new URL("https://commons.wikimedia.org/w/api.php");
      url.searchParams.set("action", "query");
      url.searchParams.set("generator", "search");
      url.searchParams.set("gsrsearch", enQuery);
      url.searchParams.set("gsrnamespace", "6");
      url.searchParams.set("gsrlimit", "12");
      url.searchParams.set("prop", "imageinfo");
      url.searchParams.set("iiprop", "url|mime|size|extmetadata");
      url.searchParams.set("iiurlwidth", "900");
      url.searchParams.set("format", "json");
      url.searchParams.set("origin", "*");
      const resp = await fetch(url.toString(), {
        headers: { "User-Agent": WIKIMEDIA_USER_AGENT },
        signal: combineSignals(signal, 3500)
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const pages = Object.values(data?.query?.pages || {}).sort((a, b) => {
        const aAnn = /annotation|labeled|arrow/i.test(a.title || "") ? 1 : 0;
        const bAnn = /annotation|labeled|arrow/i.test(b.title || "") ? 1 : 0;
        return aAnn - bAnn;
      });
      for (const [idx, p] of pages.entries()) {
        const info = p.imageinfo?.[0];
        if (!info?.url) continue;
        const mime = (info.mime || "").toLowerCase();
        if (!mime.startsWith("image/")) continue;
        if ((info.width || 0) < 220 || (info.height || 0) < 140) continue;
        const targetUrl = info.thumburl || info.url;
        const rawTitle = (p.title || `Imagem M\xE9dica ${idx + 1}`).replace(/^File:/i, "");
        if (isSpamOrLogoImageUrl(targetUrl, rawTitle)) continue;
        const canonicalKey = normalizeImageCanonicalKey(targetUrl, rawTitle);
        if (seenKeys.has(canonicalKey)) continue;
        seenKeys.add(canonicalKey);
        const descHtml = info.extmetadata?.ImageDescription?.value || rawTitle;
        const cleanDesc = descHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
        results.push({
          id: `wiki-${p.pageid || idx}`,
          title: rawTitle.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 85),
          thumbUrl: targetUrl,
          fullUrl: info.url,
          description: cleanDesc || "Imagem m\xE9dica real obtida no Wikimedia Commons.",
          suggestedFilename: buildSuggestedMediaFilename(
            rawTitle,
            targetUrl,
            mime,
            `wikimedia_${p.pageid || idx}`
          ),
          defaultLegend: cleanDesc ? `Exame complementar demonstrando ${cleanDesc.slice(0, 130)}.` : `Imagem diagn\xF3stica demonstrando achado cl\xEDnico real de ${enQuery}.`,
          source: "Wikimedia Commons Medical",
          isSvg: isSvgImageUrl(targetUrl, mime)
        });
      }
    } catch {
    }
  }
  return results;
}
async function validateCandidateImageUrl(url, signal) {
  if (!url || !url.startsWith("https://") && !url.startsWith("http://")) {
    return { ok: false, contentType: "", byteLength: 0, isSvg: false };
  }
  if (isSpamOrLogoImageUrl(url)) {
    return { ok: false, contentType: "", byteLength: 0, isSvg: false };
  }
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; InternatoFirstCardArchitect/2.0; +https://github.com/wagmms/Cards-2.0)",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      },
      signal: combineSignals(signal, 4e3)
    });
    if (!resp.ok) {
      return { ok: false, contentType: "", byteLength: 0, isSvg: false };
    }
    const contentType = (resp.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      return { ok: false, contentType, byteLength: 0, isSvg: false };
    }
    const isSvg = isSvgImageUrl(url, contentType);
    const buf = Buffer.from(await resp.arrayBuffer());
    const minBytes = isSvg ? 1500 : 3e3;
    if (buf.length < minBytes) {
      return { ok: false, contentType, byteLength: buf.length, isSvg };
    }
    return { ok: true, contentType, byteLength: buf.length, isSvg };
  } catch {
    return { ok: false, contentType: "", byteLength: 0, isSvg: false };
  }
}
function extractEditorialImageUrlsFromHtml(html, pageUrl, pageTitle = "") {
  const extracted = [];
  const seen = /* @__PURE__ */ new Set();
  const addCandidate = (rawSrc, alt = "") => {
    const trimmed = rawSrc.trim().replace(/&amp;/g, "&");
    if (!trimmed || trimmed.startsWith("data:")) return;
    try {
      const resolved = new URL(trimmed, pageUrl).toString();
      if (!resolved.startsWith("http")) return;
      if (isSpamOrLogoImageUrl(resolved, alt)) return;
      const canonical = normalizeImageCanonicalKey(resolved, alt);
      if (seen.has(canonical)) return;
      seen.add(canonical);
      extracted.push({ url: resolved, alt: alt.trim(), pageUrl, pageTitle });
    } catch {
    }
  };
  const mainMatch = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/i)?.[0] || "";
  const articleMatches = (html.match(/<article\b[^>]*>[\s\S]*?<\/article>/gi) || []).join(" ");
  const figureMatches = (html.match(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi) || []).join(" ");
  const cleanedBodyFallback = html.replace(/<(nav|aside|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  const editorialHtml = [figureMatches, articleMatches, mainMatch].filter((s) => s.length > 80).join(" ") || cleanedBodyFallback;
  const scanImgTags = (sourceHtml) => {
    const imgRegex = /<img\b[^>]*>/gi;
    let m2;
    while ((m2 = imgRegex.exec(sourceHtml)) !== null && extracted.length < 10) {
      const tag = m2[0];
      const srcMatch = /\b(?:data-lazy-src|data-src|src)=["']([^"']+)["']/i.exec(tag);
      if (!srcMatch) continue;
      const altMatch = /\balt=["']([^"']*)["']/i.exec(tag);
      const widthMatch = /\bwidth=["']?(\d+)/i.exec(tag);
      if (widthMatch && Number(widthMatch[1]) > 0 && Number(widthMatch[1]) < 150) {
        continue;
      }
      addCandidate(srcMatch[1], altMatch?.[1] || pageTitle);
    }
  };
  scanImgTags(editorialHtml);
  if (extracted.length === 0 && editorialHtml !== cleanedBodyFallback) {
    scanImgTags(cleanedBodyFallback);
  }
  const isLikelySiteCard = (u) => /(?:default|site[-_]?image|og[-_]?default|social[-_]?card|share[-_]?img|brand|header|masthead|cropped-)/i.test(
    u
  );
  let m;
  const metaRegex = /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:secure_url)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  while ((m = metaRegex.exec(html)) !== null) {
    if (!isLikelySiteCard(m[1])) {
      addCandidate(m[1], pageTitle);
    }
  }
  const metaReverseRegex = /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:secure_url)["'][^>]*>/gi;
  while ((m = metaReverseRegex.exec(html)) !== null) {
    if (!isLikelySiteCard(m[1])) {
      addCandidate(m[1], pageTitle);
    }
  }
  return extracted;
}
async function extractImagesFromMedicalWebPage(pageUrl, pageTitle = "", signal) {
  if (!pageUrl || !pageUrl.startsWith("http")) return [];
  try {
    const resp = await fetch(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8"
      },
      signal: combineSignals(signal, 3500)
    });
    if (!resp.ok) return [];
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return [];
    const html = (await resp.text()).slice(0, 22e4);
    return extractEditorialImageUrlsFromHtml(html, pageUrl, pageTitle);
  } catch {
    return [];
  }
}
async function searchGoogleMedicalImagesViaGrounding(ai, searchQuery, topic = "", question = "", enQueries = [], signal) {
  if (!ai || signal?.aborted) return [];
  const enLabel = enQueries[0] || searchQuery;
  const prompt = `Pesquise na Web p\xE1ginas m\xE9dicas reais (LITFL, Radiopaedia, Wikimedia Commons, Wikipedia, DermNet NZ, SciELO, PubMed Central) com exames de imagem, tra\xE7ados (ECG/CTG) ou fotos cl\xEDnicas reais dispon\xEDveis publicamente sobre:
- Busca: "${searchQuery}" (${enLabel})
- T\xF3pico: "${topic}"
- Contexto: "${question.slice(0, 180)}"

Retorne EXCLUSIVAMENTE um array JSON v\xE1lido com at\xE9 5 refer\xEAncias encontradas no Google Search:
[
  {
    "title": "T\xEDtulo conciso do achado visual",
    "imageUrl": "URL direta do arquivo de imagem (.jpg/.png/.webp) ou URL da p\xE1gina m\xE9dica encontrada",
    "description": "Descri\xE7\xE3o cl\xEDnica objetiva do exame sem entregar o diagn\xF3stico final",
    "source": "LITFL / Radiopaedia / Wikimedia / Wikipedia / DermNet / SciELO",
    "suggestedFilename": "nome_limpo_exame.jpg",
    "defaultLegend": "Exame complementar evidenciando [descri\xE7\xE3o morfol\xF3gica do achado]."
  }
]`;
  try {
    const response = await generateContentWithRetry(
      ai,
      {
        model: FALLBACK_GEMINI_MODEL,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel3.LOW }
        }
      },
      { signal, timeoutMs: 12e3, enableModelFallback: false }
    );
    const directCandidates = [];
    const groundedPages = [];
    for (const src of response.groundingSources || []) {
      if (src.uri && src.uri.startsWith("http")) {
        groundedPages.push({ url: src.uri, title: src.title || searchQuery });
      }
    }
    try {
      const parsed = JSON.parse(extractJsonBlock(response.text || "[]"));
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.images) ? parsed.images : [];
      for (const item of arr.slice(0, 6)) {
        const rawUrl = String(item.imageUrl || item.url || item.thumbUrl || "").trim();
        if (!rawUrl.startsWith("http")) continue;
        if (/\.(jpg|jpeg|png|webp|gif)(?:\?|$)/i.test(rawUrl)) {
          directCandidates.push({
            url: rawUrl,
            title: String(item.title || searchQuery).slice(0, 85),
            description: String(item.description || `Exame referente a ${searchQuery}.`).slice(
              0,
              180
            ),
            source: String(item.source || "Google Search Grounding"),
            suggestedFilename: String(item.suggestedFilename || "google_med_img.jpg"),
            defaultLegend: String(
              item.defaultLegend || `Imagem cl\xEDnica referente a ${searchQuery}.`
            )
          });
        } else {
          groundedPages.push({ url: rawUrl, title: String(item.title || searchQuery) });
        }
      }
    } catch {
    }
    const uniquePages = Array.from(
      new Map(groundedPages.map((p) => [p.url, p])).values()
    ).slice(0, 5);
    const pageExtracts = await Promise.all(
      uniquePages.map(
        (page) => extractImagesFromMedicalWebPage(page.url, page.title, signal)
      )
    );
    for (const extractedList of pageExtracts) {
      for (const item of extractedList.slice(0, 3)) {
        let hostLabel = "Medical Web (Google)";
        try {
          hostLabel = new URL(item.pageUrl).hostname.replace(/^www\./, "");
        } catch {
        }
        directCandidates.push({
          url: item.url,
          title: (item.alt || item.pageTitle || searchQuery).slice(0, 85),
          description: `Imagem real extra\xEDda de ${hostLabel}: ${(item.alt || item.pageTitle).slice(0, 140)}`,
          source: `${hostLabel} (via Google Search)`,
          suggestedFilename: (item.alt || item.pageTitle || searchQuery).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 44),
          defaultLegend: `Imagem cl\xEDnica real (${hostLabel}) demonstrando ${(item.alt || item.pageTitle).slice(0, 110)}.`
        });
      }
    }
    const uniqueDirect = Array.from(
      new Map(
        directCandidates.map((c) => [normalizeImageCanonicalKey(c.url, c.title), c])
      ).values()
    ).slice(0, 12);
    const validated = await Promise.all(
      uniqueDirect.map(async (item, idx) => {
        const check = await validateCandidateImageUrl(item.url, signal);
        if (!check.ok) return null;
        const ext = check.contentType.includes("png") ? ".png" : check.contentType.includes("webp") ? ".webp" : check.contentType.includes("svg") ? ".svg" : ".jpg";
        const cleanBase = item.suggestedFilename.toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
        return {
          id: `google-web-${idx}-${Date.now()}`,
          title: item.title,
          thumbUrl: item.url,
          fullUrl: item.url,
          description: item.description,
          suggestedFilename: `${cleanBase || `google_med_${idx + 1}`}${ext}`,
          defaultLegend: item.defaultLegend,
          source: item.source,
          isSvg: check.isSvg
        };
      })
    );
    return validated.filter((item) => item !== null);
  } catch {
    return [];
  }
}
async function searchOpeniMedicalImages(enQueries, rawSearch, signal) {
  if (signal?.aborted) return [];
  const q = (enQueries[0] || rawSearch || "").trim();
  if (!q) return [];
  try {
    const url = new URL("https://openi.nlm.nih.gov/api/search");
    url.searchParams.set("m", "1");
    url.searchParams.set("n", "8");
    url.searchParams.set("query", q);
    if (/\b(x[\s_-]?ray|radiograph|chest)\b/i.test(q)) url.searchParams.set("it", "x");
    else if (/\b(ct|computed tomography|tomography)\b/i.test(q)) url.searchParams.set("it", "c");
    else if (/\b(mri|magnetic resonance)\b/i.test(q)) url.searchParams.set("it", "m");
    else if (/\b(ultrasound|sonography|echocardiogram|doppler)\b/i.test(q)) url.searchParams.set("it", "u");
    const resp = await fetch(url.toString(), {
      headers: { "User-Agent": WIKIMEDIA_USER_AGENT, Accept: "application/json" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(7e3)]) : AbortSignal.timeout(7e3)
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const results = [];
    for (let idx = 0; idx < (data.list || []).length; idx++) {
      const item = data.list[idx];
      const rawLarge = (item.imgLarge || item.imgThumb || "").trim();
      if (!rawLarge) continue;
      const fullUrl = rawLarge.startsWith("http") ? rawLarge : `https://openi.nlm.nih.gov${rawLarge.startsWith("/") ? "" : "/"}${rawLarge}`;
      const rawThumb = (item.imgThumb || item.imgGrid150 || rawLarge).trim();
      const thumbUrl = rawThumb.startsWith("http") ? rawThumb : `https://openi.nlm.nih.gov${rawThumb.startsWith("/") ? "" : "/"}${rawThumb}`;
      if (isSpamOrLogoImageUrl(fullUrl)) continue;
      const title = (item.title || q).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
      const baseSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 42);
      results.push({
        id: `openi-${item.uid || idx}-${Date.now()}`,
        title: title || q,
        thumbUrl,
        fullUrl,
        description: (item.Problems || title || `Imagem cient\xEDfica Open-i/NIH referente a ${q}.`).slice(0, 180),
        suggestedFilename: `openi_${baseSlug || `med_${idx + 1}`}.jpg`,
        defaultLegend: `Exame m\xE9dico indexado (Open-i/NIH) compat\xEDvel com ${q}.`,
        source: "Open-i (NLM/NIH)",
        isSvg: false
      });
    }
    return results;
  } catch {
    return [];
  }
}
async function searchSerperMedicalImages(enQueries, rawSearch, signal) {
  if (signal?.aborted) return [];
  const apiKey = (process.env.SERPER_API_KEY || "").trim();
  if (!apiKey) return [];
  const q = (enQueries[0] || rawSearch || "").trim();
  if (!q) return [];
  try {
    const resp = await fetch("https://google.serper.dev/images", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ q, num: 8 }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8e3)]) : AbortSignal.timeout(8e3)
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const results = [];
    for (let idx = 0; idx < (data.images || []).length; idx++) {
      const item = data.images[idx];
      const fullUrl = (item.imageUrl || "").trim();
      if (!fullUrl.startsWith("http") || isSpamOrLogoImageUrl(fullUrl)) continue;
      if (item.imageWidth && item.imageWidth < 150) continue;
      const thumbUrl = (item.thumbnailUrl || fullUrl).trim();
      const title = (item.title || q).replace(/\s+/g, " ").trim().slice(0, 90);
      const extMatch = fullUrl.match(/\.(png|jpe?g|webp)(?:\?|$)/i);
      const ext = extMatch ? `.${extMatch[1].toLowerCase().replace("jpeg", "jpg")}` : ".jpg";
      const baseSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 42);
      const sourceDomain = item.domain || item.source || "Google Images";
      results.push({
        id: `serper-${idx}-${Date.now()}`,
        title,
        thumbUrl,
        fullUrl,
        description: `Imagem encontrada em ${sourceDomain} referente a ${rawSearch}.`.slice(0, 180),
        suggestedFilename: `${baseSlug || `google_med_${idx + 1}`}${ext}`,
        defaultLegend: `Exame ou imagem cl\xEDnica (${sourceDomain}) referente a ${rawSearch}.`,
        source: `Google Images Serper (${sourceDomain})`,
        isSvg: isSvgImageUrl(fullUrl)
      });
    }
    return results;
  } catch {
    return [];
  }
}
async function searchMedicalImages(ai, ctx) {
  const {
    query = "",
    topic = "",
    question = "",
    answer = "",
    hint = "",
    deckKey = "",
    preferGoogleGrounding = true,
    signal
  } = ctx;
  const rawSearch = (query || answer || topic || question || "clinical diagnosis").trim();
  const enQueries = await expandMedicalQueriesWithGemini(
    ai,
    rawSearch,
    topic,
    question,
    hint,
    signal,
    answer
  );
  const localHits = searchLocalMediaArchive({
    query: rawSearch,
    topic,
    question,
    answer,
    deckKey,
    limit: 6
  }).map((hit, idx) => {
    const localUrl = `/api/media/local-file?rel=${encodeURIComponent(hit.entry.relPath)}`;
    return {
      id: `local-${idx}-${hit.entry.filename}`,
      title: hit.entry.captionHint.slice(0, 90),
      thumbUrl: localUrl,
      fullUrl: localUrl,
      description: hit.entry.captionHint.slice(0, 180),
      suggestedFilename: hit.entry.filename,
      defaultLegend: `${hit.entry.captionHint.slice(0, 140)} (acervo local do curso).`,
      source: "Acervo Local (04_M\xEDdias)",
      fromMaterial: true,
      isSvg: false,
      relevanceScore: 30 + Math.min(25, hit.score)
    };
  });
  const [openiSettled, wikipediaSettled, wikimediaSettled] = await Promise.allSettled([
    searchOpeniMedicalImages(enQueries, rawSearch, signal),
    searchWikipediaMedicalImages(enQueries, rawSearch, signal),
    searchWikimediaCommonsMedical(enQueries, signal)
  ]);
  const tier1And2 = [
    ...localHits,
    ...openiSettled.status === "fulfilled" ? openiSettled.value.slice(0, 8) : [],
    ...wikipediaSettled.status === "fulfilled" ? wikipediaSettled.value.slice(0, 8) : [],
    ...wikimediaSettled.status === "fulfilled" ? wikimediaSettled.value.slice(0, 8) : []
  ];
  const scoreAndDedupe = (list) => {
    const deduped = /* @__PURE__ */ new Map();
    for (const candidate of list) {
      if (!candidate) continue;
      const key = candidate.fromMaterial ? `local:${candidate.suggestedFilename.toLowerCase()}` : normalizeImageCanonicalKey(candidate.thumbUrl || candidate.fullUrl, candidate.title);
      const computedScore = candidate.fromMaterial ? candidate.relevanceScore ?? 40 : scoreImageRelevance(candidate, {
        query: rawSearch,
        topic,
        question,
        answer,
        enQueries
      });
      const scored = { ...candidate, relevanceScore: computedScore };
      const existing = deduped.get(key);
      if (!existing || (scored.relevanceScore ?? 0) > (existing.relevanceScore ?? 0)) {
        deduped.set(key, scored);
      }
    }
    return Array.from(deduped.values());
  };
  let allScored = scoreAndDedupe(tier1And2);
  const strongCount = allScored.filter((c) => !c.isSvg && (c.relevanceScore ?? 0) >= 18).length;
  if (strongCount < 3) {
    const serperResults = await searchSerperMedicalImages(enQueries, rawSearch, signal);
    if (serperResults.length > 0) {
      allScored = scoreAndDedupe([...allScored, ...serperResults]);
    }
  }
  const strongAfterCse = allScored.filter((c) => !c.isSvg && (c.relevanceScore ?? 0) >= 18).length;
  if (preferGoogleGrounding && strongAfterCse < 3 && ai) {
    const groundingResults = await searchGoogleMedicalImagesViaGrounding(
      ai,
      rawSearch,
      topic,
      question,
      enQueries,
      signal
    );
    if (groundingResults.length > 0) {
      allScored = scoreAndDedupe([...allScored, ...groundingResults]);
    }
  }
  const maxScore = allScored.reduce((m, c) => Math.max(m, c.relevanceScore ?? 0), 0);
  const minThreshold = maxScore >= 28 ? 18 : 12;
  const ranked = allScored.filter((c) => (c.relevanceScore ?? 0) >= minThreshold).sort((a, b) => {
    const aSvg = Boolean(a.isSvg);
    const bSvg = Boolean(b.isSvg);
    if (aSvg !== bSvg) return aSvg ? 1 : -1;
    const aGif = /\.gif(?:\?|$)/i.test(a.thumbUrl || a.fullUrl);
    const bGif = /\.gif(?:\?|$)/i.test(b.thumbUrl || b.fullUrl);
    if (aGif !== bGif) return aGif ? 1 : -1;
    return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
  }).slice(0, 12).map(({ isSvg: _omitSvg, relevanceScore: _omitScore, ...rest }) => rest);
  return {
    query: rawSearch,
    translatedQueries: enQueries,
    images: ranked
  };
}

// server/routes/media.ts
function sanitizeDeckKeyServer(raw) {
  return String(raw || "internato_deck").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "internato_deck";
}
function attachRequestAbort(req, res, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error("TimeoutError: Tempo limite da requisi\xE7\xE3o de m\xEDdia excedido."));
  }, timeoutMs);
  const onClose = () => {
    if (!res.writableFinished) {
      controller.abort(new DOMException("Conex\xE3o cancelada pelo cliente.", "AbortError"));
    }
  };
  res.on("close", onClose);
  req.on("aborted", onClose);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      res.off("close", onClose);
      req.off("aborted", onClose);
    }
  };
}
function createMediaRouter() {
  const router = express2.Router();
  router.post("/media/search-medical-images", async (req, res) => {
    const { signal, cleanup } = attachRequestAbort(req, res, 28e3);
    try {
      const {
        query = "",
        topic = "",
        question = "",
        answer = "",
        hint = "",
        deckKey = "",
        preferGoogleGrounding = true
      } = req.body || {};
      const ai = getAiClient();
      const result = await searchMedicalImages(ai, {
        query: String(query || ""),
        topic: String(topic || ""),
        question: String(question || ""),
        answer: String(answer || ""),
        hint: String(hint || ""),
        deckKey: String(deckKey || ""),
        preferGoogleGrounding: Boolean(preferGoogleGrounding),
        signal
      });
      if (res.writableEnded) return;
      return res.json(result);
    } catch {
      if (res.writableEnded) return;
      return res.json({
        query: "atlas_clinico",
        translatedQueries: [],
        images: []
      });
    } finally {
      cleanup();
    }
  });
  router.get("/media/local-file", (req, res) => {
    const rel = String(req.query.rel || "").trim();
    const absPath = resolveSafeLocalMediaPath(rel);
    if (!absPath) {
      return res.status(404).send("Local media file not found");
    }
    const lower = absPath.toLowerCase();
    const mime = lower.endsWith(".png") ? "image/png" : lower.endsWith(".webp") ? "image/webp" : "image/jpeg";
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "public, max-age=3600");
    return fs4.createReadStream(absPath).pipe(res);
  });
  router.get("/media/proxy-image", async (req, res) => {
    const { signal, cleanup } = attachRequestAbort(req, res, 6e3);
    try {
      const targetUrl = String(req.query.url || "").trim();
      if (!isSafeExternalImageUrl(targetUrl)) {
        return res.status(400).send("Invalid or blocked image URL");
      }
      const upstream = await safeFetchWithRedirectValidation(targetUrl, {
        headers: {
          "User-Agent": "InternatoFirstCardArchitect/2.0 (https://aistudio.google.com; medical-education)"
        },
        signal
      });
      if (!upstream.ok) {
        return res.status(upstream.status).send("Failed to fetch upstream image");
      }
      const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
      if (!contentType.startsWith("image/")) {
        return res.status(415).send("Upstream resource is not an image");
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (buffer.length < 64) {
        return res.status(502).send("Upstream image is empty or corrupted");
      }
      if (buffer.length > 10 * 1024 * 1024) {
        return res.status(413).send("Image exceeds 10MB limit");
      }
      if (res.writableEnded) return;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(buffer);
    } catch {
      if (res.writableEnded) return;
      return res.status(502).send("Error proxying image");
    } finally {
      cleanup();
    }
  });
  router.post("/media/export-bundle", async (req, res) => {
    try {
      const {
        deckKey = "internato_deck",
        notesJson = "[]",
        mediaManifest = [],
        mediaAssets = {},
        guidRegistry = {}
      } = req.body || {};
      const cleanDeckKey = sanitizeDeckKeyServer(deckKey);
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
  router.post("/export/apkg", async (req, res) => {
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
      const cleanDeckKey = sanitizeDeckKeyServer(deckKey);
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
      const serializedRegistry = JSON.stringify(updatedRegistry);
      if (serializedRegistry.length <= 6e3) {
        res.setHeader("X-Updated-Guid-Registry", encodeURIComponent(serializedRegistry));
      }
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
  return router;
}

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path2.dirname(__filename);
var PORT = Number(process.env.PORT) || 3e3;
async function startServer() {
  const app = express3();
  app.use(express3.json({ limit: "50mb" }));
  app.use("/api/gemini", createGeminiRouter());
  app.use("/api", createMediaRouter());
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path2.join(__dirname, "dist");
    app.use(express3.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path2.join(distPath, "index.html"));
    });
  }
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Internato-First Card Architect server running at http://localhost:${PORT}`);
  });
  server.requestTimeout = 10 * 60 * 1e3;
  server.headersTimeout = 120 * 1e3;
  server.keepAliveTimeout = 65 * 1e3;
}
startServer();
