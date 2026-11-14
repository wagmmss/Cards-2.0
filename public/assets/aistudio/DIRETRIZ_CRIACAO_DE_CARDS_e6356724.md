# Diretriz de Criação de Cards — Design Instrucional Atômico (Internato e Residência)

## 1. Autoridade e Escopo

Esta é a especificação editorial soberana do projeto **Criador de Cards**. A [skill principal](../.agents/skills/criar-cards/SKILL.md) e o [prompt operacional](SYSTEM_PROMPT_CRIADOR.md) seguem estritamente este documento.

O objetivo central é converter apostilas, fichas-resumo, transcrições e diretrizes médicas em **flashcards atômicos de alta retenção (estilo Anki / SuperMemo)** nos formatos **Cloze** e **Q&A (`basic`)**, consagrando as **Leis Científicas de Piotr Wozniak (SuperMemo) e Andy Matuschak**:
1. **Lei da Resposta Ultra-Curta (< 2,5 segundos) (Wozniak):** Em cards basic, o campo `answer` deve ter **1 a 12 palavras** (limite máximo absoluto de **15 palavras / 110 caracteres**), contendo um único fato, diagnóstico ou conduta, sem ponto-e-vírgula (`;`), sem tags `<b>` externas e finalizado com ponto final `.`. Em cards cloze, lacuna única `{{c1::...}}` de 1 a 5 palavras.
2. **Proibição Absoluta de Perguntas Compostas ("Qual X e qual Y?") (Matuschak / Wozniak):** Um card nunca deve conter dois comandos simultâneos (proibido terminantemente: *"Qual é o diagnóstico e a conduta imediata?"*). Perguntas bifurcadas geram acertos parciais que corrompem o agendamento do FSRS.
3. **Duplo Salto Cognitivo Implícito:** Descrever os sinais clínicos/vitais no enunciado sem dar o nome da patologia e perguntar APENAS a conduta imediata. O aluno deduz internamente o diagnóstico para responder a conduta. Para testar 2ª linha/refratariedade, explicitar no enunciado que a 1ª linha já foi realizada e falhou, perguntando apenas o próximo passo.
4. **Enunciados Enxutos Anti-Pattern-Matching (Matuschak):** Limitar o campo `question` a no máximo **45–50 palavras** (1 a 2 frases diretas), eliminando detalhes decorativos que induzam reconhecimento superficial sem raciocínio clínico autêntico.
5. **Promoção Visual Obrigatória (`image_mode: "recognition"`):** Exames diagnósticos complementares extraídos do PDF (ECG, RX, TC, USG, lâminas, partograma) devem ir OBRIGATORIAMENTE na `question` de cards basic com `"image_mode": "recognition"`, nunca ocultos no `hint` enquanto o enunciado entrega o laudo escrito.
6. **Inserção direta de mídias clínicas reais pelo próprio agente:** Zero terceirização ou placeholders como `[BUSCAR IMAGEM]`.
7. **Compilação rápida e sem burocracia:** Exportação para `.apkg` e sincronização via AnkiConnect preservando GUIDs e o histórico FSRS.

---

## 2. Seleção de Conteúdo e Objetivos Essenciais (`<planejamento>`)

Antes de gerar qualquer card, o agente deve ler as fontes canônicas primárias do tema — constituídas pelo dueto oficial **Medway + Medcof** (Fichas Resumo Medway, Fichas Resumo Medcof integradas, Transcrições de Aulas, Apostilas e questões do MedQuest) — e estruturar o raciocínio dentro da tag `<planejamento>...</planejamento>` (ou `<mapa_clinico>` no gerador automatizado):

1. **Seleção por Relevância para Prova ou Assistência**:
   - Separe conteúdo essencial, complementar e dispensável. A simples presença na transcrição não justifica um card.
   - Selecione fatos de alto rendimento (*high-yield*): **fisiopatologia aplicada, cronologia, quadro clínico típico, critérios diagnósticos, exames de beira de leito vs. padrão-ouro, condutas de primeira linha, contraindicações fatais, pontos de corte numéricos e pegadinhas clássicas das bancas paulistas (USP-SP, USP-RP, Unicamp)**.
2. **Volume Guiado por Densidade e Equilíbrio de Formatos (~50% Basic / ~50% Cloze)**:
   - O número total de cards decorre estritamente da densidade clínica do tema, sem cotas mínimas ou máximas artificiais de volume total.
   - **Distribuição Balanceada:** Manter proporção equilibrada (45% a 55% Basic e 45% a 55% Cloze) para prevenir fadiga cognitiva de formato e passividade de estudo.
   - **Conferência de cobertura pelo que é perguntado**: um conceito mencionado apenas no comentário não foi treinado por recuperação ativa.
3. **Protocolo de Inversão de Prioridade (Leitura de Trás para Frente)**:
   - As apostilas deixam o tratamento para o fim. Priorize a geração na ordem:
     - **P1 (Sala Vermelha / Minuto Zero):** Estabilização, primeira droga, doses de emergência, vias, manobras salvadoras.
     - **P2 (Decisão Diagnóstica):** Exame inicial vs. confirmatório; pontos de corte numéricos exatos.
     - **P3 (Prescrição Ambulatorial / UBS):** Primeira linha, gestantes/alérgicos, critérios de internação e cura.
     - **P4 (Fisiopatologia Aplicada e Diferenciais Paulistas):** Mecanismos que justificam condutas e peculiaridades de bancas.

---

## 3. Unidade de Avaliação e Seleção de Formato

### 3.1. Atomicidade Estrita e Proibição Absoluta de Perguntas Compostas
- Cada flashcard deve testar uma única unidade de avaliação, com critério binário e inequívoco de acerto.
- **Proibição Absoluta de Perguntas Compostas ("Qual X e qual Y?"):**
  - É expressamente PROIBIDO fazer perguntas com dois comandos simultâneos (ex.: *"Qual é o diagnóstico e a conduta imediata?"*).
  - Cada cartão deve exigir exatamente um passo decisório.
- **Aplicação do Duplo Salto Cognitivo Implícito:**
  - Quando a vinheta clínica descrever sinais clínicos, vitais e laboratoriais e o objetivo for avaliar a tomada de decisão médica, **NUNCA entregue o diagnóstico no enunciado**.
  - O enunciado apresenta o quadro e pergunta **APENAS** a conduta imediata.
  - Para testar 2ª linha ou refratariedade: informe no enunciado que a 1ª linha canônica já foi instituída e falhou (ou que há contraindicação formal), perguntando apenas o próximo passo.
- **Enunciados Enxutos Anti-Pattern-Matching:**
  - Limite a `question` a no máximo **45–50 palavras** (1 a 2 frases diretas e densas).
  - Elimine dados supérfluos que permitam ao aluno deduzir a resposta por pistas gramaticais ou estruturais superficiais.
- **Tríades Curtas e Pares Indissociáveis vs. Listas Longas:**
  - Uma tríade curta consagrada (ex.: *Tríade de Bumm*) ou um par indissociável (ex.: perda sanguínea superior a `{{c1::500}}` mL após parto vaginal ou superior a `{{c1::1000}}` mL após cesariana) é uma unidade legítima de avaliação e não deve sofrer divisão artificial.
  - Já listas de 3 ou mais itens independentes devem ser desmembradas ocultando 1 item por card.
  - Se uma frase contiver dois conceitos independentes, gere dois cards separados, mantendo sempre a sintaxe `{{c1::...}}` (nunca use `c2` ou `c3` em novos cards).

### 3.2. Flashcard de Omissão (`type: "cloze"`)
- Formato direcionado a pontos de corte, valores numéricos, critérios diagnósticos, doses e contraindicações.
- **Estritamente UMA lacuna `{{c1::...}}` por nota:** É terminantemente PROIBIDO colocar dois `{{c1::...}}` na mesma nota.
- **Extensão da Lacuna:** 1 a 5 palavras no máximo. Oculte apenas o núcleo decisório sem mutilar nem truncar partículas gramaticais (não termine lacunas em preposições como *"de"*, *"para"*).
- **Proibição Terminante de Dicas Genéricas:**
  - NUNCA utilize dicas genéricas dentro da lacuna: proibido `::valor`, `::valores`, `::fármaco`, `::conduta`, `::quantidade`, `::tempo`, `::critério`, `::criterio`, `::droga`, `::número`, `::classe`, `::aumento ou diminuição`.
  - O enunciado deve ser construído de forma completa e unívoca, dispensando muletas artificiais.
  - Dica (`::dica`) só é admissível em situações excepcionais em que existam sinônimos técnicos legítimos e a dica oriente o termo exato sem revelar a resposta.
- **Regra para Valores Numéricos e Posologias:**
  - Mantenha a unidade de medida **fora da omissão** (ex.: `> {{c1::126}} mg/dL`, `até {{c1::3}} horas`, `{{c1::10}} UI de ocitocina`).
- **Campo `answer` Vazio:** Em cards cloze, o campo `answer` deve ser sempre uma string vazia (`""`).

### 3.3. Flashcard Básico Q&A (`type: "basic"`)
- Formato de eleição para vinhetas clínicas situacionais de beira de leito, reconhecimento visual de exames, relações de causa/efeito e perguntas de *"Qual é o padrão-ouro / primeira escolha / manobra / conduta imediata?"*.
- **Lei da Resposta Ultra-Curta (< 2,5 segundos):**
  - O campo `answer` deve ter **1 a 12 palavras** (limite máximo absoluto de **15 palavras / 110 caracteres**).
  - Deve conter **UM ÚNICO fato, diagnóstico ou conduta**.
  - **TERMINANTEMENTE PROIBIDO ponto-e-vírgula (`;`):** Qualquer presença de `;` ou listagem múltipla de condutas indica violação de atomicidade e pergunta composta.
  - **Regra de Formatação:** O template `BASIC_MODEL` do Anki já aplica negrito nativo (`<b>{{Answer}}</b>`). Portanto, **NÃO envolva o texto do campo `answer` em tags `<b>...</b>` ou `<strong>`**.
  - **Finalização obrigatória:** Termine sempre com ponto final `.`.
  - Não escreva a palavra `"Resposta:"`.

---

## 4. Contexto, Comentário Enxuto, Precisão Clínica e Mídias Reais

### 4.1. Cabeçalho e Sub-cabeçalho de Contexto (`topic`)
- Identifique o tema e o subtema de forma curta e hierárquica no campo `topic` (ex.: `Puerpério fisiológico - Involução uterina`, `Hemorragia pós-parto - Tratamento farmacológico`, `Puerpério patológico - Endometrite`) para evitar cegueira de contexto sem entregar a resposta.
- Use texto puro, sem caixa alta total, e nunca repita o tópico no início da pergunta.

### 4.2. Proibição Estrita de Spoiler entre Parênteses no Enunciado
- É terminantemente PROIBIDO colocar entre parênteses no enunciado (`question`) a resposta da pergunta, o termo ocultado na lacuna `{{c1::...}}`, sinônimos diretos, siglas correspondentes ou pistas reveladoras que entreguem o card.
- O contexto de beira do leito deve apresentar a história e dados do exame físico sem adiantar o diagnóstico ou a conduta entre parênteses.

### 4.3. Uso de Maiúsculas e Unicode
- Use maiúsculas apenas no início de frases, nomes próprios ou siglas. Não capitalize termos médicos no meio da frase.
- Utilize caracteres Unicode nativos (`→`, `≥`, `≤`, `±`, `×`, `α`, `β`), evitando comandos LaTeX crus (`\ge`, `\rightarrow`, `$`) que sofram corrupção de escape.

### 4.4. Comentário Enxuto, Contraste Seletivo e Precisão Clínica (`hint`)
- Obrigatório em todos os cards, iniciado por `<b>Comentário:</b> `.
- Deve conter **1 a 2 frases breves** com **termos-chave em negrito (`<b>...</b>`)** explicando o porquê ou uma confusão frequente.
- **Teto Estrito de Extensão:** O texto visível após `<b>Comentário:</b>` deve conter **no máximo 320 caracteres** (alvo recomendado: 200–300 caracteres) para aprovação compulsória no linter estrito.
- **Contraste Diferencial Obrigatório:** Inclua obrigatoriamente contraste diferencial quando houver condutas, fármacos ou diagnósticos gêmeos confundíveis (ex.: *"DPP cursa com dor e hipertonia, enquanto na placenta prévia o sangramento é indolor e o útero é relaxado."*).
- **Proibições:** Sem marcadores legados (`[ALVO DE BANCA]`, `[BEIRA-LEITO]`), sem blocos de preceptoria/armadilha e sem tabelas gigantes.

### 4.5. Mídias Clínicas Reais e Promoção Visual Obrigatória (`image_mode: "recognition"`)
- **Promoção Visual Obrigatória:** Exames diagnósticos complementares extraídos do PDF (ECG, RX, TC, USG, lâminas histológicas, partograma) DEVEM ir obrigatoriamente na `question` de cards basic com `"image_mode": "recognition"`.
  - **NUNCA oculte o exame apenas no `hint` enquanto o enunciado entrega o laudo escrito** (ex.: proibido *"No ECG que demonstra ritmo sinusal com onda delta..."* com imagem no verso). O estudante deve interpretar ativamente o exame na frente do card.
- **Card de Reconhecimento Visual (`type: "basic"`, `image_mode: "recognition"`):**
  - A imagem sem legenda reveladora entra exclusivamente em `question`: `Pergunta objetiva.<br><img src="figura.png">`.
  - O template Basic do Anki já exibe a frente no verso; portanto, **NUNCA repita a tag `<img>` no campo `hint`**.
  - `answer`: Diagnóstico conciso em 1 a 12 palavras, com ponto final.
  - `hint`: Inicia compulsoriamente com a descrição do achado semiológico/radiológico em `<i>Legenda detalhada do achado...</i><br><br>` (≥ 6 palavras) seguida de `<b>Comentário:</b>` com contraste diferencial.
- **Card Tradicional (`image_mode: "feedback"` ou Cloze):**
  - Aplicável apenas a ilustrações conceituais, esquemas anatômicos ou algoritmos recapitulativos exibidos exclusivamente no verso.
  - A imagem entra no início do `hint`: `<img src="arquivo.png"><br><i>Legenda explicativa do esquema.</i><br><br><b>Comentário:</b> ...`
- **Inserção Direta (Zero `[BUSCAR IMAGEM]`):** O agente deve extrair/recortar a figura real do PDF (`02_Capítulos_PDF/`) para `04_Mídias/` e inseri-la diretamente no card. É terminantemente proibido terceirizar com marcadores de busca.
- **Áudios (`<audio controls preload="none" class="med-audio">`):** Opcionais, máximo 1 por card, estritamente sem `[sound:...]` (zero autoplay).

---

## 5. Contrato JSON Simplificado ([`card_schema.json`](../card_schema.json))

O arquivo configurado em `decks.toml` (`data/decks/<chave>_notes.json`) contém um array JSON de notas enxutas:

| Campo | Regra |
| :--- | :--- |
| `id` | Inteiro positivo único e estável (preserva o agendamento FSRS no Anki). |
| `type` | `"cloze"` ou `"basic"`. |
| `topic` | `"Tema - Subtema"` (texto puro, sem spoiler da resposta, sem repetição na pergunta). |
| `question` | Enunciado enxuto (≤ 45–50 palavras). Em `cloze`, contém UMA lacuna `{{c1::...}}` (sem dicas genéricas). Em `basic`, pergunta com comando temporal único; se exame visual, inclui `<br><img src="...">` com `image_mode: "recognition"`. |
| `answer` | Em `cloze`: string vazia (`""`). Em `basic`: resposta ultra-curta (< 2,5s) de 1 a 12 palavras (máx. 15 palavras / 110 caracteres), sem `;`, sem `<b>` e com ponto final `.`. |
| `hint` | Em `recognition`: `<i>Legenda do achado...</i><br><br>` seguida de `<b>Comentário:</b> ` conciso (≤ 320 caracteres) com termos em negrito e contraste diferencial. Em `feedback`: `<img src="...">` + `<i>Legenda...</i><br><br>` + `<b>Comentário:</b>`. |
| `tags` | Array com a tag temática do deck (ex.: `["puerperio"]`). |
| `image_mode` | Opcional: `"recognition"` (obrigatório para exames visuais na frente) ou `"feedback"` (padrão). |
| `sources` | Array de referências documentais com `file` existente em `02_Capítulos_PDF/` e `page` inteiro válido dentro do documento. |
| `exam_refs` | Opcional: array de referências reais do MedQuest (`institution`, `year`, `question_id` verificado no banco). |

---

## 6. Exemplos Canônicos de Estrutura

```json
[
  {
    "id": 1,
    "type": "cloze",
    "topic": "Puerpério fisiológico - Involução uterina",
    "question": "No processo fisiológico de involução puerperal, o útero torna-se um órgão totalmente intrapélvico por volta do {{c1::12.º ao 15.º}} dia pós-parto.",
    "answer": "",
    "hint": "<b>Comentário:</b> A taxa média de involução uterina é de <b>1 cm ao dia</b>, alcançando as dimensões pré-gravídicas completas em cerca de <b>4 semanas</b>.",
    "tags": [
      "puerperio"
    ]
  },
  {
    "id": 2,
    "type": "basic",
    "topic": "Hemorragia pós-parto - Conduta farmacológica",
    "question": "Na Sala de Parto, puérpera imediata apresenta sangramento vaginal maciço e útero hipotônico amolecido acima da cicatriz umbilical após a saída da placenta. Qual é a conduta farmacológica imediata de primeira escolha?",
    "answer": "Ocitocina endovenosa em infusão contínua.",
    "hint": "<b>Comentário:</b> A <b>atonia uterina</b> responde por 70% das hemorragias pós-parto e exige <b>ocitocina EV</b> de imediato, reservando-se a <b>metilergometrina</b> como adjuvante em pacientes sem hipertensão.",
    "tags": [
      "puerperio"
    ]
  },
  {
    "id": 3,
    "type": "cloze",
    "topic": "Doença de Crohn - Fisiopatologia",
    "question": "Na doença de Crohn, o processo inflamatório intestinal caracteriza-se pelo acometimento {{c1::transmural}} com padrão de lesões salteadas.",
    "answer": "",
    "hint": "<b>Comentário:</b> O caráter <b>transmural</b> explica a formação típica de <b>fístulas e estenoses</b>, diferindo da <b>retocolite ulcerativa (RCU)</b>, na qual a inflamação é contínua e restrita à mucosa.",
    "tags": [
      "doenca_inflamatoria_intestinal"
    ]
  },
  {
    "id": 4,
    "type": "basic",
    "topic": "Eletrocardiografia - Taquiarritmias",
    "question": "Qual é a taquiarritmia supraventricular regular demonstrada no traçado eletrocardiográfico?<br><img src=\"ecg_trn_pseudo_s_pseudo_r.png\">",
    "answer": "Taquicardia por reentrada nodal.",
    "hint": "<i>Figura 8: Eletrocardiograma de 12 derivações em taquicardia por reentrada nodal demonstrando pseudo-s em D2 e pseudo-r' em V1.</i><br><br><b>Comentário:</b> Na <b>taquicardia por reentrada nodal (TRN)</b> típica, a despolarização atrial retrógrada simultânea produz <b>pseudo-r' em V1</b> e pseudo-s inferior, diferindo do <b>flutter atrial</b> pelo ritmo estritamente regular e ausência de ondas F em dente de serra.",
    "tags": [
      "arritmias_sincope_pcr"
    ],
    "image_mode": "recognition"
  }
]
```
