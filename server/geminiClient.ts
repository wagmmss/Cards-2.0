import crypto from 'crypto';
import {
  createPartFromUri,
  GenerateContentResponse,
  GoogleGenAI,
  Part,
  ThinkingLevel,
} from '@google/genai';

export function parseGeminiApiKeys(): string[] {
  const rawList = [process.env.GEMINI_API_KEYS || '', process.env.GEMINI_API_KEY || '']
    .join('\n')
    .split(/[\s,;]+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 10 && k !== 'MY_GEMINI_API_KEY');
  return Array.from(new Set(rawList));
}

const geminiKeyCooldownUntil = new Map<string, number>();
let geminiKeyCursor = 0;

function getKeyFingerprint(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
}

function createGoogleGenAiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 120_000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function getAiClient(): GoogleGenAI | null {
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

function isKeyRotationError(error: unknown): boolean {
  const raw = extractErrorDetails(error);
  return /429|RESOURCE_EXHAUSTED|quota exceeded|402|prepayment credits|API_KEY_INVALID|PERMISSION_DENIED|403|503|UNAVAILABLE|high demand/i.test(
    raw
  );
}

function markKeyCooldown(apiKey: string, error: unknown): void {
  const raw = extractErrorDetails(error);
  const isHardQuota = /per day|PerDay|limit:\s*20|402|prepayment credits|API_KEY_INVALID|PERMISSION_DENIED/i.test(
    raw
  );
  const cooldownMs = isHardQuota ? 1000 * 60 * 60 : 1000 * 65;
  geminiKeyCooldownUntil.set(apiKey, Date.now() + cooldownMs);
}

export async function withGeminiKeyRotation<T>(
  task: (ai: GoogleGenAI, keyFingerprint: string, keyIndex: number, totalKeys: number) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const keys = parseGeminiApiKeys();
  if (keys.length === 0) {
    throw new Error(
      'Chave GEMINI_API_KEY não configurada no ambiente. Configure sua chave no .env ou painel Secrets.'
    );
  }

  const now = Date.now();
  const orderedKeys: Array<{ key: string; idx: number }> = [];
  const cooledKeys: Array<{ key: string; idx: number }> = [];

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
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i++) {
    if (signal?.aborted) {
      throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
    }
    const { key, idx } = candidates[i];
    const fp = getKeyFingerprint(key);
    const ai = createGoogleGenAiClient(key);
    try {
      const result = await task(ai, fp, idx, keys.length);
      geminiKeyCursor = idx;
      return result;
    } catch (error: unknown) {
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

export const INTERNATO_SYSTEM_INSTRUCTION = `Você é o "Internato-First Card Architect (USP/Unicamp + FSRS)", um preceptor sênior do Internato da FMUSP e Unicamp e especialista em design de prompts de repetição espaçada segundo **Andy Matuschak ("How to write good prompts: using spaced repetition to create understanding" — https://andymatuschak.org/prompts/)** e **Michael Nielsen ("Augmenting Long-Term Memory" — https://augmentingcognition.com/ltm.html)**.

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
  a) REFAZER EM VEZ DE DELETAR (PRESERVANDO TODOS OS POLOS CLÍNICOS): Se um card antigo for uma lista aberta, pergunta vaga, definição passiva ou cloze com 2+ lacunas sobre conceitos P1–P4 clinicamente úteis, **NÃO o exclua** e **NÃO descarte o segundo conceito no comentário**: reconstrua o conceito principal preservando o "id" numérico original e desmembre os demais polos clinicamente relevantes (ex.: doença atual vs. prévia, grau leve vs. grave, 1ª linha vs. 2ª linha) em novos IDs (max_id + 1...).
  b) QUANDO PODAR (EXCLUIR IDs — RIGOR INTERNATO-FIRST): Exclua um "id" original sempre que o card for: (i) duplicata semântica, fragmentação artificial em série ("1/3", "2/3", "3/3" da mesma frase) ou redundância conceitual cruzada (o mesmo sinal, epônimo ou critério já é testado em outro card mais completo do baralho), (ii) reprovado pelo Filtro Negativo (genética/biologia molecular de bancada sem conduta, história/datas), (iii) fisiologia/anatomia teórica pura, medidas anatômicas estáticas sem impacto na conduta, detalhes técnicos de subespecialista fora da alçada do interno, propedêutica passiva substituída por conduta padrão atual ou classificação/modelo obsoleto substituído por diretriz vigente (quando um achado decidir conduta imediata, reconstrua cobrando a CONDUTA, nunca a medida isolada), ou (iv) preenchimento trivial sem decisão clínica real.
  c) ESCOLHA FLUIDA DE FORMATO (SEM COTA 50/50): Para cada card sobrevivente ou novo, escolha livremente "basic" (condutas, diferenciais, imagens recognition, mecanismos causais "por que/como") ou "cloze" (critérios numéricos, limiares, doses críticas e alvos em âncora clínica enxuta com 1 única lacuna {{c1::...}}). Em "cloze" de regra geral, NÃO force vinheta artificial com idade/tempo de uso quando isso não altera a conduta.
- NÃO inclua o campo "sources" nos cards.

4. DOUTRINA INTERNATO-FIRST GERAL (P1 -> P4 ADAPTÁVEL POR PERFIL DE DOMÍNIO), IMAGENS FIDEDIGNAS E FORMATAÇÃO:
- A matriz P1–P4 adapta-se dinamicamente ao **Perfil de Domínio** ativo do tema ("emergencia", "ambulatorio", "cirurgico", "preventiva_normativo"), conforme bloco de perfil fornecido em cada requisição:
  * **P1** = Prioridade Máxima / Conduta Crítica do Perfil (emergência/minuto zero no perfil Emergência; indicação cirúrgica/choque/dano no Cirúrgico; indicação/contraindicação/critério diagnóstico no Ambulatorial; lei/sigilo/notificação/princípio ético-SUS no Preventiva/Normativo).
  * **P2** = Decisão Diagnóstica, Estadiamento, Escores e Reconhecimento Visual (exames reais em image_mode: "recognition", pontos de corte numéricos exatos, interpretação de medidas/índices).
  * **P3** = Manejo Longitudinal / Seguimento / Prevenção / Fluxo Operacional (tratamento de 1ª linha, populações especiais, rastreamento, vacinas, reabilitação, prazos/fluxos documentais).
  * **P4** = Fisiopatologia Aplicada, Diferenciais e Armadilhas Clássicas de Banca (mecanismos causais, pares confundíveis, exceções normativas).
- AVALIAÇÃO VISUAL PROATIVA EM TODOS OS CARDS (MATERIAIS ANEXADOS + WEB):
  * Não se limite a manter ou trocar imagens que já existiam no deck original. Para CADA card gerado ou reconstruído, raciocine se um exame visual real (ECG, RX, TC, USG, CTG, dermoscopia, fundoscopia, esfregaço/lâmina, foto semiológica, fluxograma ou tabela clínica) melhora significativamente a retenção e o raciocínio do estudante.
  * Se existir uma figura compatível no "CATÁLOGO DE IMAGENS DOS MATERIAIS ANEXADOS" fornecido no prompt, insira <img src="pdfimg:ID_EXATO">.
  * Se não houver figura correspondente nos PDFs, mas o card ganhar valor com imagem clínica real, insira <img src="buscar_imagem: termo clínico específico em PT ou EN"> (ex.: <img src="buscar_imagem: bloqueio de ramo direito ECG">, <img src="buscar_imagem: pneumotorax hipertensivo radiografia torax">).
  * Coloque <img ...> na "question" ("image_mode": "recognition") quando o estudante precisa reconhecer o achado visual para responder; ou coloque no início do "hint" ("image_mode": "feedback", antes de <b>Comentário:</b>) quando a imagem reforça a explicação, classificação ou algoritmo sem entregar a resposta na frente.
  * Em cards puramente normativos, de dose ou cálculo simples onde imagem não acrescenta, NÃO force <img>.
  * Para escores, critérios diagnósticos ou correlações topográficas estruturadas (ex.: Índice de Bishop, Apgar, Wells, CURB-65, Sgarbossa, Paredes/Coronárias no IAM) sem figura correspondente nos PDFs, renderize proativamente uma tabela HTML compacta <table class="med-table"><thead><tr><th>...</th></tr></thead><tbody>...</tbody></table> no "hint" APÓS o texto de <b>Comentário:</b> (máx. 4 colunas, células curtas; a tabela NÃO entra na contagem de 180–300 chars do comentário).
  * Toda <img> anexada exige legenda descritiva em <i>...</i> com ≥ 6 palavras descrevendo o achado visível real (PROIBIDO legenda genérica/tautológica ou que dê spoiler da resposta em cards recognition).
- PRECISÃO TERMINOLÓGICA ESTRITA: valide cada termo bioquímico, anatômico e eletrocardiográfico com rigor absoluto (ex.: potássio = "calemia" / hipercalemia, NUNCA confundir com "litemia" de lítio; parear corretamente parede cardíaca × derivações × artéria culpada).
- FILTRO NEGATIVO ESTRITO: ZERO genética/biologia molecular de bancada sem impacto terapêutico imediato, ZERO história da medicina/datas e ZERO epidemiologia percentual solta que não mude conduta.
- PROIBIDO LaTeX ($...$, \\rightarrow, \\ge, \\le): use exclusivamente Unicode nativo (→, ≥, ≤, ±, α, β, µg, mEq/L) e HTML (<sub>, <sup>, <b>, <table class="med-table">).
- PROIBIDO categorias antigas da FDA na gestação ("Categoria B/C/D/X").
- "hint": sempre iniciando com "<b>Comentário:</b> " (ou precedido por <i>Legenda visual...</i><br><br> nos cards recognition, ou por <img ...><br> nos feedback) de 1 a 2 frases (180 a 300 caracteres visíveis medidos APÓS o prefixo "<b>Comentário:</b> " excluindo <table>, teto estrito de 320 chars), termos-chave em <b>negrito</b> e contraste diferencial/causal obrigatório.`;

export function extractJsonBlock(text: string): string {
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

export function sanitizeCardTextForPrompt(value: unknown, maxLen: number): string {
  return String(value || '')
    .replace(/src=["']data:image\/[^"']+["']/gi, 'src="[IMAGEM_EMBUTIDA]"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function buildFullCardsDigest(rawCards: Array<Record<string, unknown>>): string {
  if (!Array.isArray(rawCards) || rawCards.length === 0) {
    return 'Nenhum JSON anterior enviado.';
  }
  return rawCards
    .map((c) => {
      const id = c.id ?? '';
      const type = c.type === 'cloze' ? 'cloze' : 'basic';
      const priority = c.priority ? ` ${String(c.priority)}` : '';
      const topic = sanitizeCardTextForPrompt(c.topic, 140);
      const verdict =
        c.auditVerdict === 'rebuild' || c.auditVerdict === 'split'
          ? String(c.auditVerdict)
          : '';

      if (verdict) {
        const targetConcept = sanitizeCardTextForPrompt(c.auditTargetConcept, 200);
        const auditReason = sanitizeCardTextForPrompt(c.auditReason, 220);
        const suggestedType =
          c.auditSuggestedType === 'cloze' || c.auditSuggestedType === 'basic'
            ? String(c.auditSuggestedType)
            : type;
        const imgTags = `${String(c.question || '')} ${String(c.hint || '')}`.match(
          /<img\b[^>]*>/gi
        );
        const preservedMedia = imgTags
          ? imgTags
              .filter((tag) => !/(?:buscar_imagem|pdfimg):/i.test(tag))
              .map((tag) => sanitizeCardTextForPrompt(tag, 180))
              .slice(0, 2)
              .join(' ')
          : '';
        return [
          `- ID:${id} [${type}${priority}] [AUDITORIA: ${verdict} → REFAZER DO ZERO — NÃO PARAFRASEAR TEXTO ANTIGO]`,
          `  Topic: "${topic}"`,
          targetConcept ? `  Conceito-Alvo: "${targetConcept}"` : null,
          auditReason ? `  Motivo da Reconstrução: "${auditReason}"` : null,
          `  Tipo Recomendado: "${suggestedType}"`,
          preservedMedia ? `  Mídia Existente Válida (reutilizar somente se compatível): ${preservedMedia}` : null,
        ]
          .filter(Boolean)
          .join('\n');
      }

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function extractBalancedJsonObjects(
  rawText: string,
  requiredKeys: string[] = []
): Array<Record<string, unknown>> {
  if (!rawText || typeof rawText !== 'string') return [];

  const candidates: Array<{ start: number; end: number; obj: Record<string, unknown> }> = [];
  const braceStack: number[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      braceStack.push(i);
    } else if (ch === '}') {
      const start = braceStack.pop();
      if (start === undefined) continue;
      // Skip outer wrappers when an already-matched item sits completely inside this span
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
          return v !== undefined && v !== null && v !== '';
        });
        if (!hasAllRequired) continue;
        candidates.push({ start, end: i, obj: parsed });
      } catch {
        // Ignore malformed partial object
      }
    }
  }

  return candidates.map((c) => c.obj);
}

export function parseOrRecoverJsonArrayField(
  rawText: string,
  arrayFieldName: string,
  requiredKeys: string[] = ['id', 'question']
): {
  items: Array<Record<string, unknown>>;
  wasTruncated: boolean;
} {
  const cleanedJson = extractJsonBlock(rawText);
  try {
    const parsed = JSON.parse(cleanedJson);
    if (Array.isArray(parsed)) {
      return { items: parsed.filter(isPlainObject), wasTruncated: false };
    }
    if (isPlainObject(parsed) && Array.isArray(parsed[arrayFieldName])) {
      return {
        items: (parsed[arrayFieldName] as unknown[]).filter(isPlainObject),
        wasTruncated: false,
      };
    }
  } catch {
    const recovered = extractBalancedJsonObjects(rawText, requiredKeys);
    if (recovered.length > 0) {
      return { items: recovered, wasTruncated: true };
    }
    throw new Error('Resposta JSON truncada ou inválida do modelo.');
  }
  return { items: [], wasTruncated: false };
}

export function parseOrRecoverNotesJsonWithMeta(rawText: string): {
  notes: Array<Record<string, unknown>>;
  wasTruncated: boolean;
} {
  const { items, wasTruncated } = parseOrRecoverJsonArrayField(rawText, 'notes', [
    'id',
    'question',
  ]);
  return {
    notes: items.filter((obj) => Boolean(obj.question)),
    wasTruncated,
  };
}

export function parseOrRecoverClinicalMapJson(
  rawText: string,
  fallbackDeckKey: string
): Record<string, unknown> {
  const cleanedJson = extractJsonBlock(rawText);
  try {
    const parsed = JSON.parse(cleanedJson);
    if (isPlainObject(parsed)) {
      return parsed;
    }
  } catch {
    // Recover partial clinical map if truncated near the end of output
    const recoveredItems = extractBalancedJsonObjects(rawText, ['subtopic', 'concept']);
    if (recoveredItems.length > 0) {
      const themeMatch = rawText.match(/"themeTitle"\s*:\s*"([^"]+)"/);
      const specMatch = rawText.match(/"specialty"\s*:\s*"([^"]+)"/);
      const deckKeyMatch = rawText.match(/"deckKey"\s*:\s*"([^"]+)"/);
      const profileMatch = rawText.match(/"profile"\s*:\s*"([^"]+)"/);
      const updatesBlockMatch = rawText.match(
        /"guidelineUpdates"\s*:\s*\[((?:\s*"(?:[^"\\]|\\.)*"\s*,?)*)/
      );
      const guidelineUpdates: string[] = [];
      if (updatesBlockMatch?.[1]) {
        const strMatches = updatesBlockMatch[1].matchAll(/"((?:[^"\\]|\\.)*)"/g);
        for (const m of strMatches) {
          try {
            guidelineUpdates.push(JSON.parse(`"${m[1]}"`));
          } catch {
            // ignore malformed string
          }
        }
      }
      return {
        themeTitle: themeMatch?.[1] || fallbackDeckKey.replace(/_/g, ' '),
        specialty: specMatch?.[1] || 'Clínica',
        deckKey: deckKeyMatch?.[1] || fallbackDeckKey,
        ...(profileMatch?.[1] ? { profile: profileMatch[1] } : {}),
        guidelineUpdates,
        items: recoveredItems,
        wasTruncated: true,
      };
    }
  }
  throw new Error('Resposta JSON do Mapa Clínico truncada ou inválida.');
}

export function extractErrorDetails(error: unknown): string {
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

export function formatGeminiError(error: unknown, fallbackMessage: string): string {
  const raw = extractErrorDetails(error) || fallbackMessage;
  if (/AbortError|aborted|cancelado pelo usuário/i.test(raw)) {
    return 'Operação cancelada pelo usuário.';
  }
  if (/402|prepayment credits are depleted|billing#prepay/i.test(raw)) {
    return 'Créditos pré-pagos da chave Gemini esgotados (402). Troque a chave ou adicione créditos em AI Studio.';
  }
  if (/API_KEY_INVALID|PERMISSION_DENIED|403|401/i.test(raw)) {
    return 'Chave GEMINI_API_KEY inválida ou sem permissão. Verifique a chave em Settings > Secrets.';
  }
  if (/503|UNAVAILABLE|high demand/i.test(raw)) {
    return 'Servidor da API Gemini temporariamente sobrecarregado (503). Tente novamente em alguns segundos.';
  }
  if (/429|RESOURCE_EXHAUSTED|quota exceeded/i.test(raw)) {
    const isDaily = /per day|PerDay|limit:\s*20/i.test(raw);
    return isDaily
      ? 'Cota diária da API Gemini esgotada (429). Aguarde a renovação da cota ou configure uma chave com faturamento.'
      : 'Limite de requisições por minuto da API Gemini atingido (429). Aguarde alguns segundos e tente novamente.';
  }
  if (
    /fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_|socket hang up|other side closed|TimeoutError|timed out/i.test(
      raw
    )
  ) {
    return `Tempo limite ou falha de conexão com a API Gemini (${raw}). Tente novamente ou reduza a quantidade de PDFs simultâneos.`;
  }
  return raw || fallbackMessage;
}

export function isRetryableGeminiError(error: unknown): boolean {
  const raw = extractErrorDetails(error);
  if (/402|prepayment credits|PerDay|limit:\s*20|API_KEY_INVALID|PERMISSION_DENIED|AbortError|cancelado/i.test(raw)) {
    return false;
  }
  return /fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_|socket hang up|other side closed|network|terminated|503|502|504|500|UNAVAILABLE|high demand|DEADLINE_EXCEEDED|429|RESOURCE_EXHAUSTED|TimeoutError|timed out/i.test(
    raw
  );
}

export function isModelOverloadOrQuotaError(error: unknown): boolean {
  const raw = extractErrorDetails(error);
  return /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|high demand|DEADLINE_EXCEEDED|timed out|TimeoutError|404|NOT_FOUND|is not found|not supported/i.test(
    raw
  );
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Operação cancelada pelo usuário.', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException('Operação cancelada pelo usuário.', 'AbortError'));
    };
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function withTimeoutAndAbort<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
  timeoutMessage = 'Tempo limite excedido na chamada à API Gemini.'
): Promise<T> {
  if (signal?.aborted) {
    throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`TimeoutError: ${timeoutMessage}`));
    }, timeoutMs);

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException('Operação cancelada pelo usuário.', 'AbortError'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
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

export const PRIMARY_GEMINI_MODEL = 'gemini-4-hydrogen';
export const FALLBACK_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const ALLOWED_GEMINI_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
]);

const geminiModelCooldownUntil = new Map<string, number>();

function parseGeminiRetryDelayMs(error: unknown): number {
  const raw = extractErrorDetails(error);
  const match = raw.match(/Please\s+retry\s+in\s+(\d+(?:\.\d+)?)\s*(ms|s)/i);
  if (match && match[1]) {
    const val = Number(match[1]);
    if (Number.isFinite(val) && val > 0) {
      const ms = match[2].toLowerCase() === 'ms' ? val : val * 1000;
      return Math.min(25_000, Math.max(2_500, Math.ceil(ms) + 400));
    }
  }
  return 18_000;
}

export function resolveGeminiModel(requestedModel: unknown): string {
  if (typeof requestedModel === 'string') {
    const clean = requestedModel.trim();
    if (ALLOWED_GEMINI_MODELS.has(clean)) {
      return clean;
    }
  }
  return PRIMARY_GEMINI_MODEL;
}

export interface GenerateWithRetryOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  enableModelFallback?: boolean;
}

/**
 * Executa geração em streaming com timeout explícito por tentativa, cancelamento por AbortSignal
 * e fallback automático de modelo/thinkingLevel quando houver 429/503/sobrecarga.
 */
export async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0],
  options: GenerateWithRetryOptions = {}
): Promise<{
  text: string;
  finishReason?: string;
  modelUsed: string;
  groundingSources: Array<{ title: string; uri: string }>;
  searchQueries: string[];
}> {
  const { signal, timeoutMs = 150_000, enableModelFallback = true } = options;

  const baseModel = params.model || PRIMARY_GEMINI_MODEL;
  const baseThinking = params.config?.thinkingConfig?.thinkingLevel;

  const attemptPlans: Array<{
    model: string;
    thinkingLevel?: ThinkingLevel;
    delayBeforeMs: number;
  }> = [
    { model: baseModel, thinkingLevel: baseThinking, delayBeforeMs: 0 },
    {
      model: baseModel,
      thinkingLevel:
        baseThinking === ThinkingLevel.HIGH ? ThinkingLevel.MEDIUM : baseThinking,
      delayBeforeMs: 1800,
    },
    ...(enableModelFallback
      ? [
          {
            model: FALLBACK_GEMINI_MODEL,
            thinkingLevel: ThinkingLevel.MEDIUM,
            delayBeforeMs: 2500,
          },
          {
            model: FALLBACK_GEMINI_MODEL,
            thinkingLevel: ThinkingLevel.LOW,
            delayBeforeMs: 3500,
          },
        ]
      : [
          {
            model: baseModel,
            thinkingLevel: ThinkingLevel.LOW,
            delayBeforeMs: 4000,
          },
        ]),
  ];

  let lastError: unknown;
  let lastFailedModel: string | null = null;
  let lastSuggestedDelayMs = 0;

  for (let i = 0; i < attemptPlans.length; i++) {
    const plan = attemptPlans[i];
    if (signal?.aborted) {
      throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
    }

    const now = Date.now();
    const modelCoolingUntil = geminiModelCooldownUntil.get(plan.model) || 0;
    const hasUncooledAlternatePlan = attemptPlans
      .slice(i + 1)
      .some((p) => p.model !== plan.model && (geminiModelCooldownUntil.get(p.model) || 0) <= now);

    // If this model is already in a recent 429 cooldown and an uncooled fallback model exists, skip straight to fallback
    if (modelCoolingUntil > now && hasUncooledAlternatePlan) {
      continue;
    }

    // Never wait 2.5s when switching immediately from a failed baseModel to FALLBACK_GEMINI_MODEL on 429/timeout
    const isFreshFallbackSwitch = lastFailedModel !== null && plan.model !== lastFailedModel;
    const delayMs = isFreshFallbackSwitch
      ? 250
      : lastSuggestedDelayMs > 0 && plan.model === lastFailedModel
        ? Math.min(10_000, Math.max(plan.delayBeforeMs, Math.min(lastSuggestedDelayMs, 8_000)))
        : plan.delayBeforeMs;

    if (delayMs > 0) {
      await sleepWithAbort(delayMs, signal);
    }

    const attemptConfig = {
      ...(params.config || {}),
      abortSignal: signal,
      ...(plan.thinkingLevel
        ? {
            thinkingConfig: {
              ...(params.config?.thinkingConfig || {}),
              thinkingLevel: plan.thinkingLevel,
            },
          }
        : {}),
    };

    try {
      const result = await withTimeoutAndAbort(
        (async () => {
          const stream = await ai.models.generateContentStream({
            ...params,
            model: plan.model,
            config: attemptConfig,
          });
          let fullText = '';
          let finishReason: string | undefined;
          const groundingChunks: Array<{ web?: { uri?: string; title?: string } }> = [];
          const rawSearchQueries: string[] = [];

          for await (const chunk of stream) {
            if (signal?.aborted) {
              throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
            }
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
            const queries = cand?.groundingMetadata?.webSearchQueries;
            if (Array.isArray(queries) && queries.length > 0) {
              for (const q of queries) {
                if (typeof q === 'string' && q.trim()) {
                  rawSearchQueries.push(q.trim());
                }
              }
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

          const searchQueries = Array.from(new Set(rawSearchQueries));

          return {
            text: fullText,
            finishReason,
            modelUsed: plan.model,
            groundingSources,
            searchQueries,
          };
        })(),
        timeoutMs,
        signal,
        `Timeout após ${Math.round(timeoutMs / 1000)}s no modelo ${plan.model}`
      );

      geminiModelCooldownUntil.delete(plan.model);
      return result;
    } catch (error: unknown) {
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

      const canRetry =
        isRetryableGeminiError(error) ||
        (enableModelFallback && isModelOverloadOrQuotaError(error));

      if (!canRetry || i === attemptPlans.length - 1) {
        throw error;
      }

      // On 429 or TimeoutError, jump past any remaining retry on the exact same model when an alternate fallback model exists
      if (
        enableModelFallback &&
        (isQuotaError || /TimeoutError|timed out|DEADLINE_EXCEEDED/i.test(errDetails))
      ) {
        while (
          i + 1 < attemptPlans.length &&
          attemptPlans[i + 1].model === plan.model &&
          attemptPlans.slice(i + 2).some((p) => p.model !== plan.model)
        ) {
          i++;
        }
      }
    }
  }

  throw lastError;
}

export interface UploadedFileCacheEntry {
  uri: string;
  mimeType: string;
  name: string;
  uploadedAt: number;
  fileSha256: string;
  keyFingerprint: string;
}

const GEMINI_FILE_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const geminiUploadedFileCache = new Map<string, UploadedFileCacheEntry>();
const geminiUploadInFlight = new Map<string, Promise<UploadedFileCacheEntry>>();

const PDF_RAW_BYTES_CACHE_MAX_BYTES = 120 * 1024 * 1024;
const pdfRawBytesCache = new Map<
  string,
  { base64Data: string; mimeType: string; name: string; approxBytes: number }
>();
let pdfRawBytesCacheTotalBytes = 0;

function rememberPdfRawBytes(
  sha256: string,
  base64Data: string,
  mimeType: string,
  name: string
): void {
  if (!sha256 || !base64Data) return;
  const approxBytes = Math.ceil((base64Data.length * 3) / 4);
  if (approxBytes > 60 * 1024 * 1024) return;
  const existing = pdfRawBytesCache.get(sha256);
  if (existing) {
    pdfRawBytesCache.delete(sha256);
    pdfRawBytesCache.set(sha256, existing);
    return;
  }
  while (
    pdfRawBytesCacheTotalBytes + approxBytes > PDF_RAW_BYTES_CACHE_MAX_BYTES &&
    pdfRawBytesCache.size > 0
  ) {
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

export interface InputDocumentPayload {
  name?: string;
  mimeType?: string;
  base64Data?: string;
  fileUri?: string;
  fileName?: string;
  fileSha256?: string;
  keyFingerprint?: string;
  textContent?: string;
  docRole?: string;
}

export async function uploadSinglePdfToGeminiFiles(
  ai: GoogleGenAI,
  doc: InputDocumentPayload,
  signal?: AbortSignal,
  keyFingerprint = 'default'
): Promise<UploadedFileCacheEntry> {
  const base64Data = String(doc.base64Data || '');
  const mimeType = doc.mimeType || 'application/pdf';
  const hash = crypto.createHash('sha256').update(base64Data).digest('hex');
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

  const uploadTask = (async (): Promise<UploadedFileCacheEntry> => {
    const buffer = Buffer.from(base64Data, 'base64');
    const blob = new Blob([buffer], { type: mimeType });
    let lastErr: unknown;

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (signal?.aborted) {
        throw new DOMException('Upload cancelado pelo usuário.', 'AbortError');
      }
      try {
        let uploaded = await withTimeoutAndAbort(
          ai.files.upload({
            file: blob,
            config: {
              mimeType,
              displayName: doc.name || `documento_${hash.slice(0, 8)}.pdf`,
            },
          }),
          60_000,
          signal,
          `Timeout ao enviar "${doc.name || 'PDF'}" para a Gemini Files API`
        );

        let polls = 0;
        while (uploaded.state === 'PROCESSING' && uploaded.name && polls < 15) {
          await sleepWithAbort(1000, signal);
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
          fileSha256: hash,
          keyFingerprint,
        };
        geminiUploadedFileCache.set(cacheKey, entry);
        return entry;
      } catch (err: unknown) {
        lastErr = err;
        console.error(
          `[gemini-files-upload] attempt ${attempt}/3 failed for ${doc.name || 'PDF'}:`,
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

export async function resolveDocumentPartsForGemini(
  ai: GoogleGenAI,
  pdfs: InputDocumentPayload[],
  signal?: AbortSignal,
  keyFingerprint = 'default'
): Promise<Part[]> {
  const parts: Part[] = [];
  if (!Array.isArray(pdfs)) return parts;

  for (const pdf of pdfs) {
    if (signal?.aborted) {
      throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
    }
    if (pdf?.textContent && typeof pdf.textContent === 'string') {
      parts.push({
        text: `DOCUMENTO ANEXADO (${pdf.name || 'Texto/Questões'}):\n${pdf.textContent.slice(0, 60000)}`,
      });
      continue;
    }

    const mimeType = pdf?.mimeType || 'application/pdf';
    const base64Data = typeof pdf?.base64Data === 'string' ? pdf.base64Data : '';
    const sha256 =
      (typeof pdf?.fileSha256 === 'string' && pdf.fileSha256.trim()) ||
      (base64Data ? crypto.createHash('sha256').update(base64Data).digest('hex') : '');

    if (base64Data && sha256) {
      rememberPdfRawBytes(sha256, base64Data, mimeType, pdf.name || 'documento.pdf');
    }

    if (pdf?.fileUri && typeof pdf.fileUri === 'string') {
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

      const cachedRaw = sha256 ? pdfRawBytesCache.get(sha256)?.base64Data : undefined;
      const availableBase64 = base64Data || cachedRaw || '';
      if (!availableBase64) {
        throw new Error(
          `O arquivo "${pdf.name || 'PDF'}" pertence a outra chave Gemini e seus bytes não estão mais em cache; reenvie o arquivo.`
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
        if (availableBase64.length < 13_500_000) {
          console.warn(
            `[gemini] Falling back to inlineData after cross-key re-upload error for ${pdf.name || 'PDF'}:`,
            extractErrorDetails(uploadErr)
          );
          parts.push({
            inlineData: {
              mimeType,
              data: availableBase64,
            },
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
        if (base64Data.length < 13_500_000) {
          console.warn(
            `[gemini] Falling back to inlineData for ${pdf.name || 'PDF'}:`,
            extractErrorDetails(uploadErr)
          );
          parts.push({
            inlineData: {
              mimeType,
              data: base64Data,
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
