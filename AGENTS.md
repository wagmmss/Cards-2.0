# Cards-2.0 — Instruções para Google AI Studio e Agentes

Este repositório implementa o **Internato-First Card Architect** (validador, curador, buscador de mídias médicas e exportador/sincronizador Anki FSRS).

## Modo Cérebro Externo (Google AI Studio / Antigravity)
Quando você (ou qualquer conta do Google AI Studio conectada a este repositório) atuar como o cérebro clínico para criar ou refatorar decks JSON:

1. **Doutrina Internato-First (Poda Estrita):**
   - Foco em raciocínio clínico prático à beira do leito: condutas imediatas, diagnósticos diferenciais, prescrições/doses, classificação de gravidade e semiologia. Residência (R1) é estritamente secundária.
   - **Podar sem dó:** duplicatas conceituais, séries fragmentadas (`1/3`, `2/3`), decoreba histopatológica/bioquímica sem decisão clínica, medidas anatômicas estáticas sem conduta e escores/epônimos obsoletos.
2. **Regras Estritas do Linter (`src/utils/wozniakLinter.ts`):**
   - **`basic` (ativo):** pergunta atômica (1 única decisão/alavanca, sem `COMPOUND_QUESTION`, sem resposta Sim/Não passiva), resposta curta (`<= 15` palavras e `<= 110` caracteres, **sem `;`**).
   - **`cloze`:** **apenas 1 lacuna `{{c1::...}}`** (ou múltiplas ocorrências de `c1` se necessário, nunca `c2+`), **proibido usar `::dica`** (`CLOZE_HAS_HINT`), `answer` deve ser `""`.
   - **`topic`:** proibido conter palavras-chave ou radicais da resposta/lacuna (`TOPIC_SPOILER`).
   - **Verso (`hint`):** `<b>Comentário:</b>` conciso (1–2 frases com contraste diferencial quando houver diagnóstico/conduta confundível).
3. **Mídias e Reconhecimento Visual:**
   - Zero imagens duplicadas no mesmo deck (`DUPLICATE_IMAGE_IN_DECK`).
   - Toda `<img>` exige legenda `<i>...</i>` com `>= 6` palavras descritivas.
   - Cards de reconhecimento de imagem na frente devem usar `image_mode: "recognition"` (sem dar spoiler textual na pergunta).
   - Preservar áudios locais (`[sound:...]`), respeitando o limite máximo de **1 áudio por card**.
4. **Validação Obrigatória:**
   - Todo deck refatorado deve passar por `reconcileDeckIdsAndMedia`, `curateAndRebalanceDeck` e `lintDeck` atingindo **`0` erros, `0` avisos e `canExport: true`**.
   - Preservar os `id` numéricos originais para manter o histórico FSRS no Anki; ao desmembrar um card, manter o `id` original no primeiro polo e gerar novos IDs únicos para os demais.
