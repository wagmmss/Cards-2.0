import express, { Request, Response } from 'express';
import type { Part } from '@google/genai';
import { ThinkingLevel } from '@google/genai';
import type { DomainProfile } from '../../src/types/deck';
import { formatProfilePromptBlock, inferDomainProfile } from '../../src/utils/domainProfiles';
import {
  buildFullCardsDigest,
  extractErrorDetails,
  extractJsonBlock,
  formatGeminiError,
  generateContentWithRetry,
  INTERNATO_SYSTEM_INSTRUCTION,
  isRetryableGeminiError,
  parseGeminiApiKeys,
  parseOrRecoverNotesJsonWithMeta,
  PRIMARY_GEMINI_MODEL,
  resolveDocumentPartsForGemini,
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
      } = req.body || {};

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

      let result: {
        text: string;
        finishReason?: string;
        modelUsed: string;
        groundingSources: Array<{ title: string; uri: string }>;
      };

      try {
        result = await withGeminiKeyRotation(async (ai, keyFp) => {
          const parts: Part[] = await resolveDocumentPartsForGemini(ai, pdfs, signal, keyFp);
          parts.push({ text: prompt });
          return generateContentWithRetry(
            ai,
            {
              model: PRIMARY_GEMINI_MODEL,
              contents: { parts },
              config: {
                systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
                maxOutputTokens: 32768,
                thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
                ...(useGoogleSearch
                  ? { tools: [{ googleSearch: {} }] }
                  : { responseMimeType: 'application/json' }),
              },
            },
            { signal, timeoutMs: 120_000, enableModelFallback: true }
          );
        }, signal);
      } catch (primaryErr) {
        if (!signal.aborted && useGoogleSearch && isRetryableGeminiError(primaryErr)) {
          console.warn(
            '[clinical-map] Retrying without googleSearch + ThinkingLevel.MEDIUM after primary failure:',
            extractErrorDetails(primaryErr)
          );
          result = await withGeminiKeyRotation(async (ai, keyFp) => {
            const parts: Part[] = await resolveDocumentPartsForGemini(ai, pdfs, signal, keyFp);
            parts.push({ text: prompt });
            return generateContentWithRetry(
              ai,
              {
                model: PRIMARY_GEMINI_MODEL,
                contents: { parts },
                config: {
                  systemInstruction: INTERNATO_SYSTEM_INSTRUCTION,
                  maxOutputTokens: 32768,
                  responseMimeType: 'application/json',
                  thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
                },
              },
              { signal, timeoutMs: 90_000, enableModelFallback: true }
            );
          }, signal);
        } else {
          throw primaryErr;
        }
      }

      if (res.writableEnded) return;
      const rawText = result.text || '{}';
      const cleanedJson = extractJsonBlock(rawText);
      const parsed = JSON.parse(cleanedJson);

      return res.json({
        ...parsed,
        deckKey: parsed.deckKey || deckKey,
        profile: resolveEffectiveDomainProfile(
          parsed.profile || profile,
          deckKey,
          existingJsonSummary
        ),
        modelUsed: result.modelUsed,
        groundingSources:
          result.groundingSources.length > 0
            ? result.groundingSources
            : parsed.groundingSources || [],
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

  // Passo 2 — Recriar Deck JSON Canônico em Lotes (Preservando IDs FSRS e Reconstruindo do Zero)
  router.post('/generate-deck', async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 300_000);
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

      let lastModelUsed = PRIMARY_GEMINI_MODEL;

      const runDeckBatch = async (
        subsetCards: Array<Record<string, unknown>>,
        subsetNewIdStart: number,
        depth = 0
      ): Promise<Array<Record<string, unknown>>> => {
        if (signal.aborted) {
          throw new DOMException('Operação cancelada pelo usuário.', 'AbortError');
        }
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
4. Zero Mídias Órfãs, Posicionamento Correto e Coerência Factual: NUNCA invente nomes de arquivos locais inexistentes em <img src="..."> ou <audio>. Se o card original tiver <img src="..."> no "hint" (especialmente tabelas, algoritmos ou esquemas de resposta), MANTENHA a tag <img src="..."> e sua <i>Legenda</i> no INÍCIO do "hint" ("<img ...><br><i>Legenda</i><br><br><b>Comentário:</b> ..."), NUNCA movendo tabelas/esquemas para "question" nem colocando "<b>Comentário:</b>" antes da imagem. Garanta 100% de coerência numérica entre pergunta e hint.
5. Duplo Salto Cognitivo Implícito: NUNCA faça pergunta composta ("Qual o diagnóstico e a conduta?"). Apresente o caso clínico e pergunte apenas 1 decisão atômica.
6. "topic": formato "Tema - Subtema", ZERO spoiler por palavra ou radical INCLUSIVE no prefixo antes do " - " e NUNCA repita o topic em negrito dentro do question.
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

        const response = await withGeminiKeyRotation(async (ai, keyFp) => {
          const parts: Part[] = await resolveDocumentPartsForGemini(ai, pdfs, signal, keyFp);
          return generateContentWithRetry(
            ai,
            {
              model: PRIMARY_GEMINI_MODEL,
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
          const [leftNotes, rightNotes] = await Promise.all([
            runDeckBatch(subsetCards.slice(0, mid), subsetNewIdStart, depth + 1),
            runDeckBatch(subsetCards.slice(mid), subsetNewIdStart + 50, depth + 1),
          ]);
          return [...leftNotes, ...rightNotes];
        }

        return parsedNotes;
      };

      const notes = await runDeckBatch(cardsForPrompt, effectiveNewIdStart);
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

      const prompt = `Audite a cobertura clínica do baralho reconstruído "${deckKey}" comparando-o com o Mapa Clínico P1–P4 aprovado para o perfil "${effectiveProfile}".

${profilePromptBlock}

MAPA CLÍNICO APROVADO:
${JSON.stringify(checkedMapItems, null, 2)}

CARDS JÁ GERADOS NOS LOTES:
${existingDigest || 'Nenhum card gerado.'}

TAREFA CIRÚRGICA:
- Identifique APENAS os conceitos essenciais do Mapa Clínico que ficaram SEM UM CARD PRÓPRIO DEDICADO (uma menção passageira dentro do comentário/"hint" ou lista lateral de outro card NÃO conta como card dedicado!).
- Para cada lacuna real encontrada, crie 1 card atômico seguindo rigorosamente Andy Matuschak & Michael Nielsen, atribuindo IDs sequenciais a partir de ${nextNewIdStart}:
  * "topic": formato "Tema - Subtema" sem spoiler por palavra ou radical INCLUSIVE no prefixo antes de " - ".
  * Para lacunas marcadas no mapa com "image_mode": "recognition" quando não existir arquivo de imagem no acervo original, formule pergunta clínica objetiva pelo achado esperado sem simular ou inventar <img>.
  * Se "basic": "question" <= 45–50 palavras (vinheta ou pergunta causal), "answer" com 1 a 12 palavras terminado em ponto final (.), sem ";".
  * Se "cloze": exatamente 1 lacuna {{c1::...}} (1 a 5 palavras) e "answer": "".
  * "hint": comece com "<b>Comentário:</b> ", tenha entre 180 e 300 caracteres visíveis (medidos APÓS "<b>Comentário:</b> ", teto de 320), destaque termos-chave em <b>negrito</b> e traga contraste diferencial real pertinente ao tema.
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
              model: PRIMARY_GEMINI_MODEL,
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
      return res.json({ deck_key: deckKey, notes, modelUsed: response.modelUsed });
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

  // Auto-Reparar Avisos com IA (Reescrita Cirúrgica apenas dos cards sinalizados)
  router.post('/repair-cards', async (req, res) => {
    const { signal, cleanup } = createRequestAbortSignal(req, res, 180_000);
    try {
      const { flaggedCards = [], deckKey = 'internato_deck' } = req.body || {};

      if (parseGeminiApiKeys().length === 0) {
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

      const response = await withGeminiKeyRotation(
        (ai) =>
          generateContentWithRetry(
            ai,
            {
              model: PRIMARY_GEMINI_MODEL,
              contents: prompt,
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
      const rawText = response.text || '{}';
      const cleanedJson = extractJsonBlock(rawText);
      const parsed = JSON.parse(cleanedJson);
      const repairedCards = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.repairedCards)
        ? parsed.repairedCards
        : [];

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

  return router;
}
