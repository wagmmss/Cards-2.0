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
  if (/\b(emergencia|emergencias|urgencia|urgencias|sala vermelha|pcr|acls|pals|arritmia|arritmias|coronariana|coronarianas|sca|iam|choque|sepse|anafilaxia|avc|intoxicacao|cetoacidose|hemorragia pos parto|hpp|eclampsia|crise hipertensiva|parada cardiorrespiratoria)\b/.test(
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

// server.ts
var import_meta = {};
var __filename = (0, import_url.fileURLToPath)(import_meta.url);
var __dirname = import_path.default.dirname(__filename);
var PORT = Number(process.env.PORT) || 3e3;
function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }
  return new import_genai.GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 24e4,
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
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
  a) REFAZER EM VEZ DE DELETAR: Se um card antigo for uma lista aberta, pergunta vaga ou defini\xE7\xE3o passiva sobre um conceito P1\u2013P4 clinicamente \xFAtil (estadiamento, crit\xE9rio, esquema terap\xEAutico, retorno, complica\xE7\xE3o, popula\xE7\xE3o especial ou diferencial), **N\xC3O o exclua**: reconstrua o conceito do zero segundo Matuschak & Nielsen preservando o "id" num\xE9rico original no card principal (para manter o hist\xF3rico FSRS) e desmembrando em novos IDs (max_id + 1...) se houver mais de uma decis\xE3o at\xF4mica.
  b) QUANDO PODAR (EXCLUIR IDs): Exclua um "id" original **APENAS** quando for: (i) duplicata sem\xE2ntica exata de outro card mantido, (ii) reprovado pelo Filtro Negativo (gen\xE9tica/biologia molecular de bancada sem impacto cl\xEDnico, hist\xF3ria/datas), ou (iii) preenchimento trivial sem alavanca cl\xEDnica real.
  c) ESCOLHA FLUIDA DE FORMATO (SEM COTA 50/50): Para cada card sobrevivente ou novo, escolha livremente "basic" (condutas, diferenciais, imagens recognition, mecanismos causais "por que/como") ou "cloze" (crit\xE9rios num\xE9ricos, limiares, doses cr\xEDticas e alvos em \xE2ncora cl\xEDnica enxuta com 1 \xFAnica lacuna {{c1::...}}). Em "cloze" de regra geral, N\xC3O force vinheta artificial com idade/tempo de uso quando isso n\xE3o altera a conduta.
- N\xC3O inclua o campo "sources" nos cards.

4. DOUTRINA INTERNATO-FIRST GERAL (P1 -> P4 ADAPT\xC1VEL POR PERFIL DE DOM\xCDNIO), IMAGENS FIDEDIGNAS E FORMATA\xC7\xC3O:
- A matriz P1\u2013P4 adapta-se dinamicamente ao **Perfil de Dom\xEDnio** ativo do tema ("emergencia", "ambulatorio", "cirurgico", "preventiva_normativo"), conforme bloco de perfil fornecido em cada requisi\xE7\xE3o:
  * **P1** = Prioridade M\xE1xima / Conduta Cr\xEDtica do Perfil (emerg\xEAncia/minuto zero no perfil Emerg\xEAncia; indica\xE7\xE3o cir\xFArgica/choque/dano no Cir\xFArgico; indica\xE7\xE3o/contraindica\xE7\xE3o/crit\xE9rio diagn\xF3stico no Ambulatorial; lei/sigilo/notifica\xE7\xE3o/princ\xEDpio \xE9tico-SUS no Preventiva/Normativo).
  * **P2** = Decis\xE3o Diagn\xF3stica, Estadiamento, Escores e Reconhecimento Visual (exames reais em image_mode: "recognition", pontos de corte num\xE9ricos exatos, interpreta\xE7\xE3o de medidas/\xEDndices).
  * **P3** = Manejo Longitudinal / Seguimento / Preven\xE7\xE3o / Fluxo Operacional (tratamento de 1\xAA linha, popula\xE7\xF5es especiais, rastreamento, vacinas, reabilita\xE7\xE3o, prazos/fluxos documentais).
  * **P4** = Fisiopatologia Aplicada, Diferenciais e Armadilhas Cl\xE1ssicas de Banca (mecanismos causais, pares confund\xEDveis, exce\xE7\xF5es normativas).
- FILTRO NEGATIVO ESTRITO: ZERO gen\xE9tica/biologia molecular de bancada sem impacto terap\xEAutico imediato, ZERO hist\xF3ria da medicina/datas e ZERO epidemiologia percentual solta que n\xE3o mude conduta.
- PROIBIDO LaTeX ($...$, \\rightarrow, \\ge, \\le): use exclusivamente Unicode nativo (\u2192, \u2265, \u2264, \xB1, \u03B1, \u03B2, \xB5g, mEq/L) e HTML (<sub>, <sup>, <b>).
- PROIBIDO categorias antigas da FDA na gesta\xE7\xE3o ("Categoria B/C/D/X").
- "hint": sempre iniciando com "<b>Coment\xE1rio:</b> " (ou precedido por <i>Legenda visual...</i><br><br> nos cards recognition) de 1 a 2 frases (180 a 300 caracteres vis\xEDveis medidos AP\xD3S o prefixo "<b>Coment\xE1rio:</b> ", teto estrito de 320 chars), termos-chave em <b>negrito</b> e contraste diferencial/causal obrigat\xF3rio.`;
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
function parseOrRecoverNotesJsonWithMeta(rawText) {
  const cleanedJson = extractJsonBlock(rawText);
  try {
    const parsed = JSON.parse(cleanedJson);
    if (Array.isArray(parsed)) return { notes: parsed, wasTruncated: false };
    if (parsed && Array.isArray(parsed.notes)) {
      return { notes: parsed.notes, wasTruncated: false };
    }
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
    if (recovered.length > 0) return { notes: recovered, wasTruncated: true };
    throw new Error("Resposta JSON truncada ou inv\xE1lida do modelo.");
  }
  return { notes: [], wasTruncated: false };
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
  if (/402|prepayment credits are depleted|billing#prepay/i.test(raw)) {
    return "Cr\xE9ditos pr\xE9-pagos da chave Gemini esgotados (402 RESOURCE_EXHAUSTED). Troque a chave ou adicione cr\xE9ditos em AI Studio.";
  }
  if (/503|UNAVAILABLE|high demand/i.test(raw)) {
    return "Servidor da API Gemini temporariamente sobrecarregado (503 UNAVAILABLE). Tente novamente em alguns segundos.";
  }
  if (/429|RESOURCE_EXHAUSTED|quota exceeded/i.test(raw)) {
    const isDaily = /per day|PerDay|limit:\s*20/i.test(raw);
    return isDaily ? "Cota di\xE1ria da API Gemini esgotada (429 RESOURCE_EXHAUSTED \u2014 Free Tier: 20 req/dia no gemini-4-hydrogen). Aguarde a renova\xE7\xE3o da cota ou configure uma chave com faturamento." : "Limite de requisi\xE7\xF5es por minuto da API Gemini atingido (429 RESOURCE_EXHAUSTED). Aguarde alguns segundos e tente novamente.";
  }
  if (/fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_|socket hang up|other side closed|AbortError|TimeoutError/i.test(raw)) {
    return `Falha de conex\xE3o com a API Gemini ap\xF3s novas tentativas (${raw}). Tente novamente ou reduza a quantidade de PDFs simult\xE2neos.`;
  }
  return raw || fallbackMessage;
}
function isRetryableGeminiError(error) {
  const raw = extractErrorDetails(error);
  if (/402|prepayment credits|PerDay|limit:\s*20|API_KEY_INVALID|PERMISSION_DENIED/i.test(raw)) {
    return false;
  }
  return /fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_|socket hang up|other side closed|network|terminated|503|502|504|500|UNAVAILABLE|high demand|DEADLINE_EXCEEDED|429|RESOURCE_EXHAUSTED/i.test(
    raw
  );
}
async function generateContentWithRetry(ai, params) {
  const maxAttempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const stream = await ai.models.generateContentStream(params);
      let fullText = "";
      let finishReason;
      const groundingChunks = [];
      for await (const chunk of stream) {
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
      return { text: fullText, finishReason, groundingSources };
    } catch (error) {
      lastError = error;
      console.error(`[gemini] attempt ${attempt}/${maxAttempts} failed:`, extractErrorDetails(error));
      if (attempt < maxAttempts && isRetryableGeminiError(error)) {
        const delayMs = attempt === 1 ? 2e3 : 5e3;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
var GEMINI_FILE_CACHE_TTL_MS = 1e3 * 60 * 60 * 24;
var geminiUploadedFileCache = /* @__PURE__ */ new Map();
var geminiUploadInFlight = /* @__PURE__ */ new Map();
async function uploadSinglePdfToGeminiFiles(ai, doc) {
  const base64Data = String(doc.base64Data || "");
  const mimeType = doc.mimeType || "application/pdf";
  const hash = import_crypto.default.createHash("sha256").update(base64Data).digest("hex");
  const cached = geminiUploadedFileCache.get(hash);
  if (cached && Date.now() - cached.uploadedAt < GEMINI_FILE_CACHE_TTL_MS) {
    return cached;
  }
  const existingPromise = geminiUploadInFlight.get(hash);
  if (existingPromise) {
    return existingPromise;
  }
  const uploadTask = (async () => {
    const buffer = Buffer.from(base64Data, "base64");
    const blob = new Blob([buffer], { type: mimeType });
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        let uploaded = await ai.files.upload({
          file: blob,
          config: {
            mimeType,
            displayName: doc.name || `documento_${hash.slice(0, 8)}.pdf`
          }
        });
        let polls = 0;
        while (uploaded.state === "PROCESSING" && uploaded.name && polls < 15) {
          await new Promise((resolve) => setTimeout(resolve, 1e3));
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
          uploadedAt: Date.now()
        };
        geminiUploadedFileCache.set(hash, entry);
        return entry;
      } catch (err) {
        lastErr = err;
        console.error(
          `[gemini-files-upload] attempt ${attempt}/3 failed for ${doc.name || "PDF"}:`,
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
async function resolveDocumentPartsForGemini(ai, pdfs) {
  const parts = [];
  if (!Array.isArray(pdfs)) return parts;
  for (const pdf of pdfs) {
    if (pdf?.textContent && typeof pdf.textContent === "string") {
      parts.push({
        text: `DOCUMENTO ANEXADO (${pdf.name || "Texto/Quest\xF5es"}):
${pdf.textContent.slice(0, 6e4)}`
      });
    } else if (pdf?.fileUri && typeof pdf.fileUri === "string") {
      parts.push((0, import_genai.createPartFromUri)(pdf.fileUri, pdf.mimeType || "application/pdf"));
    } else if (pdf?.base64Data && typeof pdf.base64Data === "string") {
      const mimeType = pdf.mimeType || "application/pdf";
      try {
        const uploaded = await uploadSinglePdfToGeminiFiles(ai, pdf);
        parts.push((0, import_genai.createPartFromUri)(uploaded.uri, uploaded.mimeType));
      } catch (uploadErr) {
        if (pdf.base64Data.length < 135e5) {
          console.warn(
            `[gemini] Falling back to inlineData for ${pdf.name || "PDF"}:`,
            extractErrorDetails(uploadErr)
          );
          parts.push({
            inlineData: {
              mimeType,
              data: pdf.base64Data
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
var PT_TO_EN_MEDICAL_TERMS = [
  [/\bapendicite(?:\s+aguda)?\b/gi, "acute appendicitis CT ultrasound"],
  [/\bdiverticulite(?:\s+aguda)?\b/gi, "acute diverticulitis abdominal CT"],
  [/\bcolecistite(?:\s+aguda)?\b/gi, "acute cholecystitis gallbladder ultrasound"],
  [/\bpancreatite(?:\s+aguda)?\b/gi, "acute pancreatitis abdominal CT"],
  [/\bpneumot[oó]rax(?:\s+hipertensivo)?\b/gi, "tension pneumothorax chest x-ray"],
  [/\bpneumoperit[oô]nio\b/gi, "pneumoperitoneum upright chest x-ray"],
  [/\bedema\s+agudo\s+de\s+pulm[aã]o\b/gi, "acute pulmonary edema chest x-ray"],
  [/\binsufici[eê]ncia\s+card[ií]aca\b/gi, "congestive heart failure cardiomegaly chest x-ray"],
  [/\binfarto|iam|supradesnivelamento\b/gi, "ST elevation myocardial infarction ECG LITFL"],
  [/\bfibrila[cç][aã]o\s+atrial\b/gi, "atrial fibrillation ECG rhythm strip"],
  [/\btaquicardia\s+ventricular\b/gi, "ventricular tachycardia ECG"],
  [/\bflutter\s+atrial\b/gi, "atrial flutter sawtooth ECG"],
  [/\bbloqueio\s+atrioventricular\b/gi, "third degree AV block complete heart block ECG"],
  [/\bcardiotocografia|dip\s+ii|desacelera[cç][aã]o|sofrimento\s+fetal|taquissistolia|uterot[oô]nic/gi, "cardiotocography fetal heart rate deceleration uterine tachysystole"],
  [/\bindu[cç][aã]o\s+do\s+parto|misoprostol|ocitocina\b/gi, "cardiotocography uterine tachysystole labor induction"],
  [/\bpr[eé][-\s]?ecl[aâ]mpsia|ecl[aâ]mpsia|s[ií]ndrome\s+hellp\b/gi, "HELLP syndrome schistocytes peripheral blood smear"],
  [/\bhemorragia\s+p[oó]s[-\s]?parto|bal[aã]o\s+de\s+bakri|atonia\s+uterina\b/gi, "postpartum hemorrhage Bakri balloon tamponade"],
  [/\bgravidez\s+ect[oó]pica\b/gi, "ectopic pregnancy transvaginal ultrasound"],
  [/\bdescolamento\s+prematuro\s+de\s+placenta|placenta\s+pr[eé]via\b/gi, "placental abruption placenta previa ultrasound"],
  [/\bpartograma\b/gi, "partogram labor progression WHO curve"],
  [/\bpneumonia\b/gi, "lobar pneumonia consolidation chest x-ray"],
  [/\btuberculose\b/gi, "pulmonary tuberculosis cavitation chest x-ray"],
  [/\bderrame\s+pleural\b/gi, "pleural effusion chest x-ray meniscus sign"],
  [/\btromboembolismo\s+pulmonar|\btep\b/gi, "pulmonary embolism CT pulmonary angiography"],
  [/\bavc\s+isqu[eê]mico\b/gi, "ischemic stroke brain CT"],
  [/\bavc\s+hemorr[aá]gico|hemorragia\s+subaracn[oó]idea\b/gi, "subarachnoid hemorrhage head CT"],
  [/\bhematoma\s+epidural\b/gi, "epidural hematoma lens shaped head CT"],
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
  [/\bherpes\s+zoster|varicela|impetigo|celulite|erisipela\b/gi, "herpes zoster dermatome skin rash clinical photo"],
  [/\bs[ií]filis|cancro|linfogranuloma\b/gi, "secondary syphilis palmar plantar rash clinical photo"],
  [/\bcirrose|ascite|varizes\s+esof[aá]gicas\b/gi, "esophageal varices endoscopy liver cirrhosis"],
  [/\bfratura|luxa[cç][aã]o|osteomielite\b/gi, "bone fracture dislocation radiograph x-ray"]
];
var BLOCKED_IMAGE_URL_PATTERN = /(?:logo|icon|favicon|avatar|gravatar|pb-primary|dark-mode|banner|badge|pixel|1x1|sprite|spinner|button|social|share|commons-logo|ambox|edit-clear|question_book|crystal_clear|padlock|symbol_|flag_of_|coat_of_arms|map_of_|blank_map|wikimedia-button|poweredby|boeing|airlines|airport|stamp_of_|coin_)/i;
function isSpamOrLogoImageUrl(url, title = "") {
  const combined = `${url} ${title}`;
  if (!url || BLOCKED_IMAGE_URL_PATTERN.test(combined)) return true;
  if (/\.(?:tif|tiff|pdf|djvu|ogg|ogv|webm|mp4|mp3|wav)$/i.test(url.split("?")[0])) {
    return true;
  }
  return false;
}
function buildEnglishMedicalSearchQueries(rawQuery, topic = "", question = "") {
  const queries = [];
  const combined = `${rawQuery} ${topic} ${question}`;
  for (const [regex, enTerm] of PT_TO_EN_MEDICAL_TERMS) {
    if (regex.test(combined) && !queries.includes(enTerm)) {
      queries.push(enTerm);
      if (queries.length >= 2) break;
    }
  }
  const stripped = rawQuery.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(
    /\b(?:na|no|nos|nas|em|de|do|da|dos|das|para|com|sem|qual|quais|conduta|imediata|primeira|escolha|linha|tratamento|manejo|paciente|gestante|evolui|apresenta|reacao|adversa|exame|achado)\b/gi,
    " "
  ).replace(/\s+/g, " ").trim();
  if (stripped && !queries.includes(stripped)) {
    queries.push(stripped);
  }
  if (queries.length === 0) {
    queries.push("clinical medical imaging diagnosis");
  }
  return queries.slice(0, 3);
}
async function expandMedicalQueriesWithGemini(ai, rawQuery, topic = "", question = "", hint = "") {
  const fallbackQueries = buildEnglishMedicalSearchQueries(rawQuery, topic, question);
  if (!ai) return fallbackQueries;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: `Traduza e expanda esta busca cl\xEDnica para encontrar IMAGENS M\xC9DICAS REAIS na internet (Wikimedia Commons, Wikipedia, Radiopaedia, LITFL, DermNet, PubMed).
Retorne EXCLUSIVAMENTE um JSON array com 2 a 3 termos curtos em INGL\xCAS (2 a 5 palavras cada, focados no exame/foto/tra\xE7ado cl\xEDnico real):
- Busca: "${rawQuery}"
- T\xF3pico: "${topic}"
- Pergunta: "${question.slice(0, 220)}"
- Coment\xE1rio: "${hint.slice(0, 180)}"
Exemplo de sa\xEDda: ["cardiotocography late decelerations", "uterine tachysystole CTG"]`,
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 200
      }
    });
    const parsed = JSON.parse(extractJsonBlock(response.text || "[]"));
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
var WIKIMEDIA_USER_AGENT = "Cards20MedicalApp/2.0 (https://github.com/wagmms/Cards-2.0)";
async function searchWikipediaMedicalImages(enQueries, ptQuery) {
  const primaryEn = (enQueries[0] || "").split(/\s+/).slice(0, 4).join(" ");
  const searches = [
    ...primaryEn ? [{ lang: "en", query: primaryEn }] : [],
    ...ptQuery ? [{ lang: "pt", query: ptQuery }] : []
  ];
  const results = [];
  const seenUrls = /* @__PURE__ */ new Set();
  for (const { lang, query } of searches) {
    if (results.length >= 6) break;
    try {
      const searchUrl = new URL(`https://${lang}.wikipedia.org/w/api.php`);
      searchUrl.searchParams.set("action", "query");
      searchUrl.searchParams.set("list", "search");
      searchUrl.searchParams.set("srsearch", query);
      searchUrl.searchParams.set("srlimit", "3");
      searchUrl.searchParams.set("format", "json");
      searchUrl.searchParams.set("origin", "*");
      const sResp = await fetch(searchUrl.toString(), {
        headers: { "User-Agent": WIKIMEDIA_USER_AGENT },
        signal: AbortSignal.timeout(3500)
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
        signal: AbortSignal.timeout(3500)
      });
      if (!pResp.ok) continue;
      const pData = await pResp.json();
      const fileTitles = /* @__PURE__ */ new Set();
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
      infoUrl.searchParams.set("action", "query");
      infoUrl.searchParams.set("titles", fileList.join("|"));
      infoUrl.searchParams.set("prop", "imageinfo");
      infoUrl.searchParams.set("iiprop", "url|mime|size|extmetadata");
      infoUrl.searchParams.set("iiurlwidth", "900");
      infoUrl.searchParams.set("format", "json");
      infoUrl.searchParams.set("origin", "*");
      const iResp = await fetch(infoUrl.toString(), {
        headers: { "User-Agent": WIKIMEDIA_USER_AGENT },
        signal: AbortSignal.timeout(3500)
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
        if (seenUrls.has(targetUrl)) continue;
        seenUrls.add(targetUrl);
        const rawTitle = (page.title || `Wikipedia Medical ${idx + 1}`).replace(/^(?:File|Ficheiro|Arquivo):/i, "");
        const cleanName = rawTitle.toLowerCase().replace(/[^a-z0-9.]+/g, "_").replace(/^_|_$/g, "");
        const descHtml = info.extmetadata?.ImageDescription?.value || rawTitle;
        const cleanDesc = descHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
        results.push({
          id: `wp-${lang}-${page.pageid || idx}`,
          title: rawTitle.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 85),
          thumbUrl: targetUrl,
          fullUrl: info.url,
          description: cleanDesc || `Imagem m\xE9dica enciclop\xE9dica (${lang}.wikipedia.org).`,
          suggestedFilename: /\.(jpg|jpeg|png|webp|gif)$/i.test(cleanName) ? cleanName.slice(0, 60) : `${cleanName.slice(0, 52)}.jpg`,
          defaultLegend: cleanDesc ? `Imagem cl\xEDnica demonstrando ${cleanDesc.slice(0, 130)}.` : `Imagem cl\xEDnica real referente a ${query}.`,
          source: `Wikipedia Medical (${lang.toUpperCase()})`,
          isSvg: mime.includes("svg") || targetUrl.toLowerCase().endsWith(".svg")
        });
      }
    } catch {
    }
  }
  return results;
}
async function searchWikimediaCommonsMedical(enQueries) {
  const results = [];
  const seenUrls = /* @__PURE__ */ new Set();
  const baseWords = (enQueries[0] || "").split(/\s+/).filter(Boolean);
  const candidateSearches = Array.from(
    new Set([
      baseWords.slice(0, 3).join(" "),
      baseWords.slice(0, 2).join(" ")
    ].filter((q) => q.length >= 3))
  );
  for (const enQuery of candidateSearches) {
    if (results.length >= 4) break;
    try {
      const url = new URL("https://commons.wikimedia.org/w/api.php");
      url.searchParams.set("action", "query");
      url.searchParams.set("generator", "search");
      url.searchParams.set("gsrsearch", enQuery);
      url.searchParams.set("gsrnamespace", "6");
      url.searchParams.set("gsrlimit", "10");
      url.searchParams.set("prop", "imageinfo");
      url.searchParams.set("iiprop", "url|mime|size|extmetadata");
      url.searchParams.set("iiurlwidth", "900");
      url.searchParams.set("format", "json");
      url.searchParams.set("origin", "*");
      const resp = await fetch(url.toString(), {
        headers: { "User-Agent": WIKIMEDIA_USER_AGENT },
        signal: AbortSignal.timeout(3500)
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
        if (seenUrls.has(targetUrl)) continue;
        seenUrls.add(targetUrl);
        const cleanName = rawTitle.toLowerCase().replace(/[^a-z0-9.]+/g, "_").replace(/^_|_$/g, "");
        const descHtml = info.extmetadata?.ImageDescription?.value || rawTitle;
        const cleanDesc = descHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
        results.push({
          id: `wiki-${p.pageid || idx}`,
          title: rawTitle.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 85),
          thumbUrl: targetUrl,
          fullUrl: info.url,
          description: cleanDesc || `Imagem m\xE9dica real obtida no Wikimedia Commons.`,
          suggestedFilename: /\.(jpg|jpeg|png|webp|gif)$/i.test(cleanName) ? cleanName.slice(0, 60) : `${cleanName.slice(0, 52)}.jpg`,
          defaultLegend: cleanDesc ? `Exame complementar demonstrando ${cleanDesc.slice(0, 130)}.` : `Imagem diagn\xF3stica demonstrando achado cl\xEDnico real de ${enQuery}.`,
          source: "Wikimedia Commons Medical",
          isSvg: mime.includes("svg") || targetUrl.toLowerCase().endsWith(".svg")
        });
      }
    } catch {
    }
  }
  return results;
}
async function validateCandidateImageUrl(url) {
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
      signal: AbortSignal.timeout(4500)
    });
    if (!resp.ok) {
      return { ok: false, contentType: "", byteLength: 0, isSvg: false };
    }
    const contentType = (resp.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      return { ok: false, contentType, byteLength: 0, isSvg: false };
    }
    const isSvg = contentType.includes("svg");
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
async function extractImagesFromMedicalWebPage(pageUrl, pageTitle = "") {
  if (!pageUrl || !pageUrl.startsWith("http")) return [];
  try {
    const resp = await fetch(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8"
      },
      signal: AbortSignal.timeout(3500)
    });
    if (!resp.ok) return [];
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return [];
    const html = (await resp.text()).slice(0, 22e4);
    const extracted = [];
    const seen = /* @__PURE__ */ new Set();
    const addCandidate = (rawSrc, alt = "") => {
      const trimmed = rawSrc.trim().replace(/&amp;/g, "&");
      if (!trimmed || trimmed.startsWith("data:")) return;
      try {
        const resolved = new URL(trimmed, pageUrl).toString();
        if (!resolved.startsWith("http")) return;
        if (isSpamOrLogoImageUrl(resolved, alt)) return;
        if (seen.has(resolved)) return;
        seen.add(resolved);
        extracted.push({ url: resolved, alt: alt.trim(), pageUrl, pageTitle });
      } catch {
      }
    };
    const metaRegex = /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:secure_url)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = metaRegex.exec(html)) !== null) {
      addCandidate(m[1], pageTitle);
    }
    const metaReverseRegex = /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:secure_url)["'][^>]*>/gi;
    while ((m = metaReverseRegex.exec(html)) !== null) {
      addCandidate(m[1], pageTitle);
    }
    const imgRegex = /<img\b[^>]*>/gi;
    while ((m = imgRegex.exec(html)) !== null && extracted.length < 10) {
      const tag = m[0];
      const srcMatch = /\b(?:data-lazy-src|data-src|src)=["']([^"']+)["']/i.exec(tag);
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
async function searchGoogleMedicalImagesViaGrounding(ai, searchQuery, topic = "", question = "", enQueries = []) {
  if (!ai) return [];
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
    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });
    const directCandidates = [];
    const groundedPages = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    for (const chunk of chunks) {
      const web = chunk.web;
      if (web?.uri && web.uri.startsWith("http")) {
        groundedPages.push({
          url: web.uri,
          title: web.title || searchQuery
        });
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
            description: String(item.description || `Exame referente a ${searchQuery}.`).slice(0, 180),
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
      uniquePages.map((page) => extractImagesFromMedicalWebPage(page.url, page.title))
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
      new Map(directCandidates.map((c) => [c.url, c])).values()
    ).slice(0, 12);
    const validated = await Promise.all(
      uniqueDirect.map(async (item, idx) => {
        const check = await validateCandidateImageUrl(item.url);
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
      const {
        query = "",
        topic = "",
        question = "",
        hint = "",
        preferGoogleGrounding = true
      } = req.body || {};
      const rawSearch = (query || topic || question || "clinical diagnosis").trim();
      const ai = getAiClient();
      const enQueries = await expandMedicalQueriesWithGemini(ai, rawSearch, topic, question, hint);
      const [googleSettled, wikipediaSettled, wikimediaSettled] = await Promise.allSettled([
        preferGoogleGrounding ? searchGoogleMedicalImagesViaGrounding(ai, rawSearch, topic, question, enQueries) : Promise.resolve([]),
        searchWikipediaMedicalImages(enQueries, rawSearch),
        searchWikimediaCommonsMedical(enQueries)
      ]);
      const googleImages = googleSettled.status === "fulfilled" ? googleSettled.value : [];
      const wpImages = wikipediaSettled.status === "fulfilled" ? wikipediaSettled.value.slice(0, 8) : [];
      const wmImages = wikimediaSettled.status === "fulfilled" ? wikimediaSettled.value.slice(0, 8) : [];
      const interleaved = [];
      const seenUrls = /* @__PURE__ */ new Set();
      const maxLen = Math.max(googleImages.length, wpImages.length, wmImages.length);
      for (let i = 0; i < maxLen; i++) {
        for (const candidate of [googleImages[i], wpImages[i], wmImages[i]]) {
          if (!candidate) continue;
          const normalizedKey = candidate.thumbUrl.replace(/^http:\/\//i, "https://").split("?")[0];
          if (!seenUrls.has(normalizedKey)) {
            seenUrls.add(normalizedKey);
            interleaved.push(candidate);
          }
        }
      }
      const rasterFirst = [
        ...interleaved.filter((img) => !img.isSvg),
        ...interleaved.filter((img) => img.isSvg)
      ].map(({ isSvg: _omit, ...rest }) => rest);
      return res.json({
        query: rawSearch,
        translatedQueries: enQueries,
        images: rasterFirst.slice(0, 12)
      });
    } catch {
      return res.json({
        query: "atlas_clinico",
        translatedQueries: [],
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
  app.post("/api/gemini/upload-file", async (req, res) => {
    try {
      const { name = "documento.pdf", mimeType = "application/pdf", base64Data = "" } = req.body || {};
      if (!base64Data || typeof base64Data !== "string") {
        return res.status(400).json({ error: "Arquivo base64Data ausente." });
      }
      const ai = getAiClient();
      if (!ai) {
        return res.status(200).json({
          fallback: true,
          error: "Chave GEMINI_API_KEY n\xE3o configurada no ambiente. Configure sua chave no painel Settings > Secrets."
        });
      }
      const uploaded = await uploadSinglePdfToGeminiFiles(ai, {
        name,
        mimeType,
        base64Data
      });
      return res.json({
        fileUri: uploaded.uri,
        fileName: uploaded.name,
        mimeType: uploaded.mimeType
      });
    } catch (error) {
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, "Erro ao enviar PDF para a Gemini Files API.")
      });
    }
  });
  const resolveEffectiveDomainProfile = (requestedProfile, deckKey, textHint = "") => {
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
  };
  app.post("/api/gemini/clinical-map", async (req, res) => {
    try {
      const {
        deckKey = "tema_clinico_internato",
        profile = "auto",
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
      const effectiveProfile = resolveEffectiveDomainProfile(
        profile,
        deckKey,
        existingJsonSummary
      );
      const profilePromptBlock = formatProfilePromptBlock(effectiveProfile);
      const parts = await resolveDocumentPartsForGemini(ai, pdfs);
      const prompt = `Analise os documentos PDF anexados (se houver) e o tema m\xE9dico indicado pela Deck Key "${deckKey}".
${existingJsonSummary ? `Resumo do deck atual enviado pelo usu\xE1rio:
${existingJsonSummary}
` : ""}
${useGoogleSearch ? "Utilize o Google Search para verificar diretrizes atualizadas do Minist\xE9rio da Sa\xFAde (MS), Sociedades M\xE9dicas Brasileiras (FEBRASGO, SBC, SBP, SBGG, CBC, CFM, etc.), consensos internacionais recentes e refer\xEAncias de exames/normas aplic\xE1veis a este tema." : ""}

${profilePromptBlock}

Gere um Mapa Cl\xEDnico estruturado segundo a Doutrina Internato-First (P1 a P4) ADAPTADA ESTRITAMENTE AO PERFIL DE DOM\xCDNIO "${effectiveProfile}" acima para guiar a cria\xE7\xE3o/recria\xE7\xE3o do deck.
- N\xE3o force cen\xE1rio de "Sala Vermelha" nem vi\xE9s obst\xE9trico/de emerg\xEAncia se o tema pertencer a outro perfil!
- Inclua em P2 conceitos de Reconhecimento Visual de exames/imagens reais da internet APENAS quando exames complementares visuais fizerem sentido para o tema (ex.: ECG, RX, TC, USG, CTG, dermoscopia, fundoscopia, l\xE2minas). Para temas normativos/\xE9tica/legais sem exame de imagem t\xEDpico, foque P2 em documenta\xE7\xE3o, prazos e interpreta\xE7\xE3o de medidas/indicadores.
- Aplique o Filtro Negativo: exclua gen\xE9tica de bancada, hist\xF3ria da medicina e epidemiologia percentual que n\xE3o mude conduta.

Retorne EXCLUSIVAMENTE um objeto JSON v\xE1lido (sem coment\xE1rios fora do JSON) no seguinte formato exato:
{
  "themeTitle": "Nome Completo do Tema M\xE9dico",
  "specialty": "Especialidade (Cl\xEDnica / Cirurgia / GO / Pediatria / Preventiva / \xC9tica)",
  "deckKey": "${deckKey}",
  "profile": "${effectiveProfile}",
  "guidelineUpdates": [
    "Resumo objetivo de atualiza\xE7\xE3o de diretriz MS / Sociedade Brasileira / Norma CFM / Consenso com pontos de corte e condutas"
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
Gere entre 8 e 14 itens distribu\xEDdos em P1, P2, P3 e P4 de acordo com o perfil "${effectiveProfile}", escolhendo fluidamente targetCardType ("basic" para decis\xE3o cl\xEDnica/diferencial/mecanismo/imagem e "cloze" para crit\xE9rios num\xE9ricos/limiares/doses em \xE2ncora), sem cota percentual r\xEDgida.`;
      parts.push({ text: prompt });
      let result;
      try {
        result = await generateContentWithRetry(ai, {
          model: "gemini-4-hydrogen",
          contents: { parts },
          config: {
            systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
            maxOutputTokens: 32768,
            thinkingConfig: {
              thinkingLevel: import_genai.ThinkingLevel.HIGH
            },
            ...useGoogleSearch ? { tools: [{ googleSearch: {} }] } : { responseMimeType: "application/json" }
          }
        });
      } catch (primaryErr) {
        if (useGoogleSearch && isRetryableGeminiError(primaryErr)) {
          console.warn(
            "[clinical-map] Retrying without googleSearch + ThinkingLevel.MEDIUM after primary failure:",
            extractErrorDetails(primaryErr)
          );
          result = await generateContentWithRetry(ai, {
            model: "gemini-4-hydrogen",
            contents: { parts },
            config: {
              systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
              maxOutputTokens: 32768,
              responseMimeType: "application/json",
              thinkingConfig: {
                thinkingLevel: import_genai.ThinkingLevel.MEDIUM
              }
            }
          });
        } else {
          throw primaryErr;
        }
      }
      const rawText = result.text || "{}";
      const cleanedJson = extractJsonBlock(rawText);
      const parsed = JSON.parse(cleanedJson);
      return res.json({
        ...parsed,
        deckKey: parsed.deckKey || deckKey,
        profile: resolveEffectiveDomainProfile(parsed.profile || profile, deckKey, existingJsonSummary),
        groundingSources: result.groundingSources.length > 0 ? result.groundingSources : parsed.groundingSources || []
      });
    } catch (error) {
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, "Erro ao gerar o Mapa Cl\xEDnico com Gemini.")
      });
    }
  });
  app.post("/api/gemini/generate-deck", async (req, res) => {
    try {
      const {
        deckKey = "tema_clinico_internato",
        pdfs = [],
        clinicalMap = null,
        existingMetadata = null,
        batchCards = null,
        batchIndex = 0,
        totalBatches = 1,
        nextNewIdStart = null,
        deckOutline = null
      } = req.body || {};
      const ai = getAiClient();
      if (!ai) {
        return res.status(200).json({
          fallback: true,
          error: "Chave GEMINI_API_KEY n\xE3o configurada no ambiente. Configure sua chave no painel Settings > Secrets."
        });
      }
      const parts = await resolveDocumentPartsForGemini(ai, pdfs);
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
      const runDeckBatch = async (subsetCards, subsetNewIdStart, depth = 0) => {
        const rawCardsSummary = buildFullCardsDigest(subsetCards);
        const batchInstruction = isBatchMode ? `MODO DE RECONSTRU\xC7\xC3O PROFUNDA EM LOTE (${batchIndex + 1}/${totalBatches} \u2014 ${subsetCards.length} cards neste lote):
- PROIBIDO PAR\xC1FRASE COSM\xC9TICA DE CLOZES FRACOS: Reconstrua cada conceito v\xE1lido **DO ZERO** segundo Andy Matuschak & Michael Nielsen (esfor\xE7o real de recupera\xE7\xE3o, anti-pattern-matching, racioc\xEDnio causal "por que / como", precis\xE3o cl\xEDnica).
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
- Reconstrua o baralho com rigor Matuschak & Nielsen preservando os IDs FSRS dos conceitos cl\xEDnicos distintos, podando duplicatas reais e criando novos IDs a partir de ${subsetNewIdStart} para cobrir integralmente o Mapa Cl\xEDnico P1\u2013P4.`;
        const prompt = `Reconstrua profundamente e lapide o baralho can\xF4nico para o tema "${deckKey}".

${profilePromptBlock}

${batchInstruction}

DADOS DO BARALHO ANTIGO (COMPLETO COM PERGUNTA, RESPOSTA E COMENT\xC1RIO ORIGINAL):
- Total de cards no baralho original: ${existingIds.length}
- Primeiro novo ID exclusivo reservado para este lote (se precisar desmembrar algum card deste lote): ${subsetNewIdStart}
- Tags de M\xEDdia Originais: ${JSON.stringify(mediaTags)}
${outlineText ? `- \xCDNDICE GLOBAL DE TODOS OS LOTES (use para n\xE3o duplicar outros lotes nem transformar um card deste lote no tema de outro lote):
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
4. Zero M\xEDdias \xD3rf\xE3s, Posicionamento Correto e Coer\xEAncia Factual: NUNCA invente nomes de arquivos locais inexistentes em <img src="..."> ou <audio>. Se o card original tiver <img src="..."> no "hint" (especialmente tabelas, algoritmos ou esquemas de resposta), MANTENHA a tag <img src="..."> e sua <i>Legenda</i> no IN\xCDCIO do "hint" ("<img ...><br><i>Legenda</i><br><br><b>Coment\xE1rio:</b> ..."), NUNCA movendo tabelas/esquemas para "question" nem colocando "<b>Coment\xE1rio:</b>" antes da imagem. Garanta 100% de coer\xEAncia num\xE9rica entre pergunta e hint (ex.: se o enunciado diz "3 semanas", o hint deve dizer "3 semanas / 21 dias", nunca "20 dias").
5. Duplo Salto Cognitivo Impl\xEDcito: NUNCA fa\xE7a pergunta composta ("Qual o diagn\xF3stico e a conduta?"). Apresente o caso cl\xEDnico e pergunte apenas 1 decis\xE3o at\xF4mica.
6. "topic": formato "Tema - Subtema", ZERO spoiler por palavra ou radical INCLUSIVE no prefixo antes do " - " (se a resposta contiver "alimento", "rinite" ou "imunoglobulinas", generalize o prefixo para "Alergia Pedi\xE1trica", "Vias A\xE9reas Superiores" ou "Imunidade Humoral") e NUNCA repita o topic em negrito dentro do question.
7. "question": ZERO spoiler entre par\xEAnteses e ZERO LaTeX ($...$, \\rightarrow).
8. "hint": deve ter "<b>Coment\xE1rio:</b> " logo antes da explica\xE7\xE3o textual (se houver <img ...><br><i>Legenda</i>, coloque no in\xEDcio ANTES de "<b>Coment\xE1rio:</b> "), com 1 a 2 frases (180 a 300 caracteres vis\xEDveis no coment\xE1rio textual, NUNCA passar de 310), termos-chave em <b>negrito</b> e contraste diferencial/causal obrigat\xF3rio.
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
        const response = await generateContentWithRetry(ai, {
          model: "gemini-4-hydrogen",
          contents: { parts: [...parts, { text: prompt }] },
          config: {
            systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
            responseMimeType: "application/json",
            maxOutputTokens: 65536,
            thinkingConfig: {
              thinkingLevel: import_genai.ThinkingLevel.HIGH
            }
          }
        });
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
          const [leftNotes, rightNotes] = await Promise.all([
            runDeckBatch(subsetCards.slice(0, mid), subsetNewIdStart, depth + 1),
            runDeckBatch(subsetCards.slice(mid), subsetNewIdStart + 50, depth + 1)
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
        totalBatches
      });
    } catch (error) {
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, "Erro ao gerar o Deck JSON Can\xF4nico com Gemini.")
      });
    }
  });
  app.post("/api/gemini/fill-map-gaps", async (req, res) => {
    try {
      const {
        deckKey = "tema_clinico_internato",
        clinicalMap = null,
        rebuiltCards = [],
        nextNewIdStart = 171000200
      } = req.body || {};
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
      const ai = getAiClient();
      if (!ai) {
        return res.status(200).json({
          fallback: true,
          error: "Chave GEMINI_API_KEY n\xE3o configurada no ambiente."
        });
      }
      const existingDigest = Array.isArray(rebuiltCards) ? rebuiltCards.slice(0, 160).map(
        (c) => `- ID:${c.id ?? "?"} | ${sanitizeCardTextForPrompt(c.topic, 80)} | Q: "${sanitizeCardTextForPrompt(c.question, 180)}"${c.answer ? ` | A: "${sanitizeCardTextForPrompt(c.answer, 90)}"` : ""}`
      ).join("\n") : "";
      const prompt = `Audite a cobertura cl\xEDnica do baralho reconstru\xEDdo "${deckKey}" comparando-o com o Mapa Cl\xEDnico P1\u2013P4 aprovado para o perfil "${effectiveProfile}".

${profilePromptBlock}

MAPA CL\xCDNICO APROVADO:
${JSON.stringify(checkedMapItems, null, 2)}

CARDS J\xC1 GERADOS NOS LOTES:
${existingDigest || "Nenhum card gerado."}

TAREFA CIR\xDARGICA:
- Identifique APENAS os conceitos essenciais do Mapa Cl\xEDnico que ficaram SEM UM CARD PR\xD3PRIO DEDICADO (aten\xE7\xE3o: uma men\xE7\xE3o passageira dentro do coment\xE1rio/"hint" ou lista lateral de outro card N\xC3O conta como card dedicado!). Exemplos t\xEDpicos de lacunas reais: exame inicial obrigat\xF3rio (como \u03B2-hCG na suspeita de DIP), crit\xE9rio de transi\xE7\xE3o IV\u2192VO ou diferencial P1 ausente.
- Para cada lacuna real encontrada, crie 1 card at\xF4mico seguindo rigorosamente Andy Matuschak & Michael Nielsen, atribuindo IDs sequenciais a partir de ${nextNewIdStart}:
  * "topic": formato "Tema - Subtema" sem spoiler por palavra ou radical INCLUSIVE no prefixo antes de " - " (ex.: se a resposta citar "imunoglobulinas", use "Imunidade Humoral - Investiga\xE7\xE3o Inicial", nunca "Imunodefici\xEAncia humoral").
  * Para lacunas marcadas no mapa com "image_mode": "recognition" quando n\xE3o existir arquivo de imagem no acervo original, formule pergunta cl\xEDnica objetiva pelo achado esperado sem simular ou inventar <img>.
  * Se "basic": "question" \u2264 45\u201350 palavras (vinheta ou pergunta causal), "answer" com 1 a 12 palavras terminado em ponto final (.), sem ";".
  * Se "cloze": exatamente 1 lacuna {{c1::...}} (1 a 5 palavras) e "answer": "".
  * "hint": comece com "<b>Coment\xE1rio:</b> ", tenha entre **180 e 300 caracteres vis\xEDveis** (medidos AP\xD3S "<b>Coment\xE1rio:</b> ", teto de 320), destaque termos-chave em <b>negrito</b> e traga contraste diferencial real pertinente ao tema (ex.: gravidez/ect\xF3pica vs. quadro n\xE3o gestacional \u2014 nunca use texto gen\xE9rico sobre "2\xAA linha").
- Se TODOS os conceitos do Mapa Cl\xEDnico j\xE1 possu\xEDrem card pr\xF3prio dedicado acima, retorne "notes": [].
- NUNCA duplique conceitos j\xE1 cobertos nos cards existentes acima.
- N\xC3O inclua o campo "sources".

Retorne EXCLUSIVAMENTE um JSON v\xE1lido:
{
  "deck_key": "${deckKey}",
  "notes": []
}`;
      const response = await generateContentWithRetry(ai, {
        model: "gemini-4-hydrogen",
        contents: [{ text: prompt }],
        config: {
          systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          maxOutputTokens: 65536,
          thinkingConfig: {
            thinkingLevel: import_genai.ThinkingLevel.HIGH
          }
        }
      });
      const { notes, wasTruncated } = parseOrRecoverNotesJsonWithMeta(response.text || "{}");
      if (wasTruncated) {
        console.warn("[fill-map-gaps] Resposta truncada recuperada parcialmente:", notes.length);
      }
      return res.json({ deck_key: deckKey, notes });
    } catch (error) {
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, "Erro ao auditar lacunas do Mapa Cl\xEDnico.")
      });
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
      const prompt = `Reescreva cirurgicamente APENAS os cards abaixo que foram reprovados pelo Linter Matuschak & Nielsen (andymatuschak.org/prompts/ e augmentingcognition.com/ltm.html).
Mantenha rigorosamente o mesmo "id" num\xE9rico e qualquer tag de m\xEDdia v\xE1lida de cada card. N\xC3O inclua o campo "sources".

REGRAS DE CORRE\xC7\xC3O CIR\xDARGICA (MATUSCHAK & NIELSEN):
- **Focused & Tractable:** Se a pergunta pede lista aberta ("Quais as causas/crit\xE9rios...?", "Cite...") ou a resposta tem m\xFAltiplos itens/ponto-e-v\xEDrgula, isole 1 \xFAnico atributo/decis\xE3o determinante.
- **Salience & Anti-Passivo (Nielsen):** Se a pergunta \xE9 uma defini\xE7\xE3o inerte ("O que \xE9 X?") ou bin\xE1ria ("Sim/N\xE3o"), transforme em um prompt de sali\xEAncia ancorado em cen\xE1rio cl\xEDnico ou mecanismo causal.
- **Precise & Consistent:** Se "type": "basic" -> "question" com <= 50 palavras e pergunta precisa (cen\xE1rio cl\xEDnico com decis\xE3o inequ\xEDvoca ou prompt causal/diferencial de Nielsen & Matuschak); "answer" DEVE ter entre 1 e 12 palavras (m\xE1x 15 palavras / 110 chars), terminar com ".", N\xC3O conter ";" e N\xC3O ter <b> envolvendo tudo. Use "basic" ou "cloze" livremente conforme o que melhor encaixar para o card.
- **Cloze At\xF4mico:** Se "type": "cloze" -> "question" DEVE ter estritamente 1 lacuna {{c1::...}} com 1 a 5 palavras, unidades fora da lacuna, sem preposi\xE7\xE3o pendurada no final, SEM "::dica", e "answer" DEVE ser "".
- **Effortful (Zero Spoiler):** Se spoiler por radical ou palavra no "topic" ou entre par\xEAnteses na "question" -> remova imediatamente a palavra/radical da resposta (ex.: "Manobras" quando a resposta \xE9 "Manobra de...") mantendo formato "Tema - Subtema".
- Substitua qualquer LaTeX ($...$, \\rightarrow) por Unicode puro (\u2192, \u2265, \u2264).
- "hint": DEVE conter "<b>Coment\xE1rio:</b> ", ter entre 180 e 295 caracteres vis\xEDveis AP\xD3S o prefixo "<b>Coment\xE1rio:</b> " (PROIBIDO passar de 320 caracteres vis\xEDveis), com termos-chave em <b>negrito</b> e contraste diferencial/causal.

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
      const response = await generateContentWithRetry(ai, {
        model: "gemini-4-hydrogen",
        contents: prompt,
        config: {
          systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          maxOutputTokens: 65536,
          thinkingConfig: {
            thinkingLevel: import_genai.ThinkingLevel.HIGH
          }
        }
      });
      const rawText = response.text || "{}";
      const cleanedJson = extractJsonBlock(rawText);
      const parsed = JSON.parse(cleanedJson);
      const repairedCards = Array.isArray(parsed) ? parsed : Array.isArray(parsed.repairedCards) ? parsed.repairedCards : [];
      return res.json({ repairedCards, deckKey });
    } catch (error) {
      return res.status(200).json({
        fallback: true,
        error: formatGeminiError(error, "Erro ao auto-reparar cards com Gemini.")
      });
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
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Internato-First Card Architect server running at http://localhost:${PORT}`);
  });
  server.requestTimeout = 10 * 60 * 1e3;
  server.headersTimeout = 120 * 1e3;
  server.keepAliveTimeout = 65 * 1e3;
}
startServer();
