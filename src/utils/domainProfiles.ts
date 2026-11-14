import { DomainProfile, PriorityLevel } from '../types/deck';

export interface DomainProfileConfig {
  id: DomainProfile;
  label: string;
  shortLabel: string;
  description: string;
  priorityLabels: Record<PriorityLevel, string>;
  priorityPrompts: Record<PriorityLevel, string>;
  scenarioGuidance: string;
  closedCommands: string[];
}

export const DOMAIN_PROFILE_ORDER: DomainProfile[] = [
  'emergencia',
  'ambulatorio',
  'cirurgico',
  'preventiva_normativo',
];

export const DOMAIN_PROFILE_CONFIGS: Record<DomainProfile, DomainProfileConfig> = {
  emergencia: {
    id: 'emergencia',
    label: 'Urgência & Emergência',
    shortLabel: 'Emergência',
    description:
      'Sala Vermelha, minuto zero, estabilização hemodinâmica, drogas de emergência, pós-estabilização e fisiopatologia aplicada.',
    priorityLabels: {
      P1: 'P1 · Sala Vermelha / Minuto Zero',
      P2: 'P2 · Diagnóstico & Reconhecimento',
      P3: 'P3 · Pós-Estabilização & Alta/UTI',
      P4: 'P4 · Fisiopatologia & Diferenciais',
    },
    priorityPrompts: {
      P1: 'Sala Vermelha / Minuto Zero: sinais de alarme (red flags), critérios de instabilidade, estabilização imediata, manobras salvadoras, 1ª droga (dose/via), conduta na refratariedade (2ª linha), antídotos e contraindicações fatais.',
      P2: 'Decisão Diagnóstica & Reconhecimento Visual: exame inicial à beira-leito vs. padrão-ouro confirmatório, interpretação de exames reais em image_mode: "recognition" (ECG, RX, TC, USG, CTG) e escores/cortes de gravidade.',
      P3: 'Pós-Estabilização, Enfermaria & Prevenção Secundária: transição de via, terapias de manutenção pós-alta, profilaxias, populações especiais e critérios de internação em UTI ou alta segura.',
      P4: 'Fisiopatologia Aplicada & Diferenciais: mecanismos causais que explicam sinais clínicos/condutas agudas e armadilhas clássicas das bancas.',
    },
    scenarioGuidance:
      '[CENÁRIO (Sala Vermelha / Pronto-Socorro / UTI / Centro Obstétrico) + PERFIL (idade, sexo, comorbidades ou IG se aplicável)] + [CLÍNICA + SINAIS VITAIS] + [COMANDO TEMPORAL INEQUÍVOCO].',
    closedCommands: [
      'Qual é a conduta imediata de minuto zero à beira do leito antes de exames complementares?',
      'Qual é o primeiro exame a ser solicitado na sala de emergência (ou o exame padrão-ouro confirmatório)?',
      'Qual é a prescrição farmacológica imediata de primeira escolha (fármaco, dose e via)?',
      'Após falha da primeira linha ou estabilização inicial, qual é o próximo passo terapêutico indicado?',
    ],
  },
  ambulatorio: {
    id: 'ambulatorio',
    label: 'Ambulatório, Crônicos & Híbridos',
    shortLabel: 'Ambulatório',
    description:
      'UBS/ambulatório, rastreio, diagnóstico, metas terapêuticas, populações especiais e eventuais descompensações agudas.',
    priorityLabels: {
      P1: 'P1 · Segurança, Red Flags & Descompensações',
      P2: 'P2 · Diagnóstico, Rastreio & Estratificação',
      P3: 'P3 · 1ª Linha, Metas & Populações Especiais',
      P4: 'P4 · Fisiopatologia & Diferenciais',
    },
    priorityPrompts: {
      P1: 'Segurança do Paciente, Contraindicações Absolutas & Descompensações: erros iatrogênicos graves (ex.: fármacos proscritos, categoria 4, teratogênicos), sinais de alarme para encaminhamento/internação e manejo de descompensações agudas do tema quando presentes no material (ex.: crise hipertensiva, CAD/EHH, crise asmática, pré-eclâmpsia grave).',
      P2: 'Diagnóstico, Rastreamento & Estratificação: critérios diagnósticos exatos, exames iniciais vs. confirmatórios, fluxogramas de rastreio/seguimento, interpretação visual de exames (image_mode: "recognition") e pontos de corte numéricos.',
      P3: 'Manejo de 1ª Linha, Metas & Populações Especiais: terapia inicial, escalonamento/2ª linha, metas clínicas/laboratoriais, prevenção/profilaxias e ajustes em populações especiais (crianças/peso, idosos, gestantes, nefropatas, hepatopatas, alérgicos).',
      P4: 'Fisiopatologia Aplicada & Diferenciais: mecanismos que explicam sinais, efeitos adversos ou escolhas terapêuticas e diagnósticos diferenciais gêmeos.',
    },
    scenarioGuidance:
      '[CENÁRIO (UBS / Ambulatório / Enfermaria / Pronto-Atendimento se descompensado) + PERFIL DO PACIENTE (idade, sexo, comorbidades, peso ou IG apenas se aplicável)] + [DADOS CLÍNICOS/EXAMES] + [COMANDO INEQUÍVOCO].',
    closedCommands: [
      'Qual é a contraindicação absoluta (ou sinal de alarme que indica internação imediata) neste cenário?',
      'Qual é o exame confirmatório padrão-ouro (ou critério diagnóstico) indicado para este caso?',
      'Qual é a terapia de primeira linha (ou ajuste em população especial) indicada para controle e seguimento?',
      'Após falha ou intolerância ao esquema inicial, qual é a conduta de segunda linha recomendada?',
    ],
  },
  cirurgico: {
    id: 'cirurgico',
    label: 'Cirúrgico & Trauma',
    shortLabel: 'Cirúrgico',
    description:
      'Indicação cirúrgica vs. conservadora, ATLS, propedêutica armada, estadiamento, pré/pós-operatório e complicações.',
    priorityLabels: {
      P1: 'P1 · Indicação Cirúrgica & Trauma',
      P2: 'P2 · Propedêutica Armada & Estadiamento',
      P3: 'P3 · Pré/Pós-Op, Técnica & Complicações',
      P4: 'P4 · Anatomia Cirúrgica & Diferenciais',
    },
    priorityPrompts: {
      P1: 'Indicação Cirúrgica Imediata vs. Manejo Conservador & Sala de Trauma: critérios de laparotomia/toracotomia/drenagem imediata, sequência ABCDE/ATLS, choque hemorrágico, abdome agudo perfurativo/isquêmico e medidas salvadoras no minuto zero.',
      P2: 'Propedêutica Armada & Estadiamento: indicação de e-FAST, TC, USG ou RX (incluindo image_mode: "recognition"), classificações e escores cirúrgicos (Hinchey, Tóquio, AAST, Alvarado, risco cirúrgico).',
      P3: 'Pré-Operatório, Técnica Essencial, Pós-Operatório & Complicações: jejum/preparo, antibioticoprofilaxia e profilaxia de TEV, via de acesso/princípio cirúrgico e manejo de complicações (fístulas, deiscência, infecção de sítio, íleo).',
      P4: 'Anatomia Cirúrgica Aplicada, Fisiopatologia & Diferenciais: relações anatômicas que evitam lesão iatrogênica, mecanismos fisiopatológicos e diferenciais cirúrgicos.',
    },
    scenarioGuidance:
      '[CENÁRIO (Sala de Trauma / Pronto-Socorro Cirúrgico / Enfermaria Pós-Op / Ambulatório Cirúrgico) + PERFIL DO PACIENTE] + [EXAME FÍSICO / SINAIS VITAIS / IMAGEM] + [COMANDO CIRÚRGICO INEQUÍVOCO].',
    closedCommands: [
      'Qual é a indicação cirúrgica imediata (ou medida invasiva prioritária) diante destes achados?',
      'Qual é o exame de imagem inicial (ou padrão-ouro para estadiamento) indicado após a estabilização?',
      'Qual é a conduta padronizada no pré-operatório (ou no manejo da complicação pós-operatória apresentada)?',
      'Qual é o critério que contraindica o manejo conservador e impõe abordagem cirúrgica?',
    ],
  },
  preventiva_normativo: {
    id: 'preventiva_normativo',
    label: 'Preventiva, Ética, SUS & Conceitual',
    shortLabel: 'Preventiva / Ética',
    description:
      'Ética médica, documentação (DO/CAT), SUS/PNAB, epidemiologia, bioestatística, vigilância e calendário vacinal.',
    priorityLabels: {
      P1: 'P1 · Deveres Legais, Ética & Notificação',
      P2: 'P2 · Critérios, Fórmulas & Epidemiologia',
      P3: 'P3 · Regras Práticas, Fluxos & Exceções',
      P4: 'P4 · Fundamentos & Armadilhas de Banca',
    },
    priorityPrompts: {
      P1: 'Deveres Ético-Legais Inegociáveis, Documentação & Notificação Urgente: quem preenche Declaração de Óbito (DO) vs. SVO vs. IML, emissão de CAT, hipóteses taxativas de quebra de sigilo, notificação compulsória imediata (≤ 24h) e proibições éticas graves.',
      P2: 'Critérios, Fórmulas, Desenhos de Estudo & Métricas: sensibilidade, especificidade, VPP/VPN, razão de verossimilhança, RR vs. OR vs. NNT, desenhos epidemiológicos e seus vieses principais, níveis de prevenção e testes estatísticos.',
      P3: 'Regras Práticas, Fluxos do SUS, Prazos & Exceções: princípios e diretrizes do SUS/PNAB, calendário vacinal e bloqueios pós-exposição, rastreamentos populacionais, prazos legais e exceções clássicas.',
      P4: 'Fundamentos Conceituais, Interpretação Crítica & Armadilhas de Banca: interpretação correta de p-valor/intervalo de confiança, confusão vs. modificação de efeito e pegadinhas conceituais das bancas.',
    },
    scenarioGuidance:
      '[CENÁRIO INSTITUCIONAL OU EPIDEMIOLÓGICO (UBS / Plantão / IML / Estudo / Gestão SUS)] + [FATOS OBJETIVOS OU DADOS NUMÉRICOS] + [COMANDO NORMATIVO OU ANALÍTICO INEQUÍVOCO].',
    closedCommands: [
      'A qual médico ou órgão compete legalmente a emissão do documento (ou a notificação imediata) neste caso?',
      'Qual é a medida epidemiológica (ou desenho de estudo / teste diagnóstico) mais adequada para esta situação?',
      'Qual é a conduta ética/normativa correta (ou exceção legal aplicável) segundo o CFM / Ministério da Saúde?',
      'Por que o parâmetro ou viés citado altera a validade (ou interpretação) dos resultados apresentados?',
    ],
  },
};

export function inferDomainProfile(deckKey: string, textHint: string = ''): DomainProfile {
  const combined = `${deckKey} ${textHint}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ');

  if (
    /\b(etica|bioetica|declaracao de obito|sigilo|prontuario|cfm|cat|sus|pnab|saude coletiva|preventiva|epidemiolog[a-z]*|bioestatistica|sensibilidade|especificidade|coorte|caso controle|ensaio clinico|vigilancia|notificacao compulsoria|calendario vacinal|imunizac[a-z]*|saude do trabalhador|financiamento sus|atencao primaria)\b/.test(
      combined
    )
  ) {
    return 'preventiva_normativo';
  }

  if (
    /\b(cirurg[a-z]*|abdome agudo|apendicite|colecistite|diverticulite|pancreatite|hernia|trauma|atls|pneumotorax|hemotorax|obstrucao intestinal|queimadura|vias biliares|pos operatorio|laparotom[a-z]*|urologia|ortopedia|fratura|traumatologia)\b/.test(
      combined
    )
  ) {
    return 'cirurgico';
  }

  if (
    /\b(emergencia|emergencias|urgencia|urgencias|sala vermelha|pcr|acls|pals|arritmia|arritmias|coronariana|coronarianas|sca|iam|choque|sepse|anafilaxia|avc|intoxicacao|cetoacidose|hemorragia pos parto|hpp|eclampsia|crise hipertensiva|parada cardiorrespiratoria)\b/.test(
      combined
    )
  ) {
    return 'emergencia';
  }

  return 'ambulatorio';
}

export function formatProfilePromptBlock(profile: DomainProfile): string {
  const cfg = DOMAIN_PROFILE_CONFIGS[profile];
  return `PERFIL DE DOMÍNIO ATIVO: ${cfg.label.toUpperCase()} (${cfg.id})
Estrutura de Priorização P1 → P4 específica para este perfil:
- P1 (${cfg.priorityLabels.P1}): ${cfg.priorityPrompts.P1}
- P2 (${cfg.priorityLabels.P2}): ${cfg.priorityPrompts.P2}
- P3 (${cfg.priorityLabels.P3}): ${cfg.priorityPrompts.P3}
- P4 (${cfg.priorityLabels.P4}): ${cfg.priorityPrompts.P4}

Molde de Salience Prompt para este perfil:
- ${cfg.scenarioGuidance}
- Comandos fechados recomendados (use ou adapte com a mesma precisão temporal/decisória; proibido perguntar apenas "Qual a conduta?"):
${cfg.closedCommands.map((c) => `  * "${c}"`).join('\n')}`;
}
