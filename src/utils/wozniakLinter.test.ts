import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyResolvedWebImageToCard,
  computeDeterministicDeckId,
  curateAndRebalanceDeck,
  extractDeckMediaManifest,
  extractDeckMetadata,
  extractUnresolvedLocalImages,
  formatCanonicalDeckJson,
  lintCard,
  reconcileDeckIdsAndMedia,
  removeMissingMediaFromCard,
  resolveOrCreateNoteGuid,
  surgicalRepairCardLocal,
} from './wozniakLinter';
import { buildGenericClinicalMap } from '../data/demoDecks';
import {
  DOMAIN_PROFILE_CONFIGS,
  formatProfilePromptBlock,
  inferDomainProfile,
} from './domainProfiles';
import {
  HIGH_PRECISION_MEDICAL_ATLAS,
  matchMedicalAtlasImages,
} from '../data/medicalDiagnosticAtlas';
import { readMultipleDocumentFiles } from './documentUpload';
import { CanonicalCard, GuidRegistryData, MedicalImageResult } from '../types/deck';

test('extractDeckMetadata extracts existing numeric FSRS IDs, records mediaTags, and automatically strips orphan <audio> from rawCards', () => {
  const sampleJson = JSON.stringify({
    deck_key: 'sindromes_hipertensivas_gestacao',
    notes: [
      {
        id: 171000101,
        type: 'basic',
        topic: 'Síndromes Hipertensivas - Conduta de Urgência',
        question:
          'No Centro Obstétrico, gestante de 34 semanas apresenta PA 168x112 mmHg e escotomas. Qual o tratamento medicamentoso de primeira escolha para prevenção de convulsão? <img src="cardiotoco_padrao.png">',
        answer: 'Sulfato de magnésio EV.',
        hint: '<b>Comentário:</b> O <b>sulfato de magnésio</b> estabiliza a membrana neuronal na iminência de eclâmpsia, enquanto a <b>hidralazina</b> controla apenas os níveis pressóricos.',
      },
      {
        id: 171000102,
        type: 'cloze',
        topic: 'Síndromes Hipertensivas - Intoxicação Medicamentosa',
        question:
          'Na intoxicação por sulfato de magnésio com abolição do reflexo patelar, o antídoto imediato é {{c1::gluconato de cálcio}} 1 g EV. <audio src="ausculta_pulmonar.mp3"></audio>',
        answer: '',
        hint: '<b>Comentário:</b> Suspender a infusão e infundir <b>gluconato de cálcio 10% (10 mL EV lento)</b> reverte a depressão neuromuscular, diferentemente da <b>oligúria isolada</b> que exige apenas ajuste da velocidade.',
      },
    ],
  });

  const meta = extractDeckMetadata(sampleJson);
  assert.deepEqual(meta.existingIds, [171000101, 171000102]);
  assert.equal(meta.detectedDeckKey, 'sindromes_hipertensivas_gestacao');
  assert.equal(meta.mediaTags.includes('<img src="cardiotoco_padrao.png">'), true);
  assert.equal(meta.mediaTags.includes('<audio src="ausculta_pulmonar.mp3"></audio>'), true);
  assert.equal(meta.removedOrphanAudioCount, 1);
  assert.equal(meta.rawCards[1].question.includes('<audio'), false);
  assert.equal('sources' in meta, false);
});

test('lintCard passes a compliant Wozniak/Matuschak basic card with Tripla Ancoragem', () => {
  const validBasic: CanonicalCard = {
    id: 171000101,
    type: 'basic',
    topic: 'Síndromes Hipertensivas - Prevenção de Eclâmpsia',
    question:
      'No Pronto-Socorro Obstétrico, gestante de 33 semanas apresenta PA 165x112 mmHg, cefaleia fronto-occipital refratária e escotomas cintilantes. Qual a conduta farmacológica imediata de primeira escolha para prevenção de convulsões?',
    answer: 'Sulfato de magnésio (esquema Zuspan ou Pritchard).',
    hint: '<b>Comentário:</b> Na <b>iminência de eclâmpsia</b> (cefaleia, escotomas, epigastralgia), o <b>sulfato de magnésio</b> é a droga de escolha, superando <b>fenitoína ou diazepam</b> na redução de recorrência.',
  };

  const result = lintCard(validBasic);
  assert.equal(result.isValid, true);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.metrics.answerWordCount, 7);
});

test('lintCard flags basic card with > 15 words, semicolon (;), compound question, vague temporal command, and topic spoiler', () => {
  const flawedBasic: CanonicalCard = {
    id: 171000105,
    type: 'basic',
    topic: 'Síndromes Hipertensivas - Uso de Sulfato de Magnésio e Hidralazina',
    question:
      'Gestante de 35 semanas com PA 170x115 mmHg e escotomas (tratar com sulfato de magnésio). Qual o diagnóstico e qual a conduta?',
    answer:
      'O diagnóstico é iminência de eclâmpsia grave; deve-se iniciar imediatamente sulfato de magnésio em dose de ataque seguido de manutenção e hidralazina endovenosa para controle.',
    hint: 'Comentário sem tag bold inicial e muito curto.',
  };

  const result = lintCard(flawedBasic);
  assert.equal(result.isValid, false);
  const codes = result.warnings.map((w) => w.code);
  assert.equal(codes.includes('ANSWER_TOO_LONG'), true);
  assert.equal(codes.includes('ANSWER_HAS_SEMICOLON'), true);
  assert.equal(codes.includes('COMPOUND_QUESTION'), true);
  assert.equal(codes.includes('VAGUE_TEMPORAL_WINDOW'), true);
  assert.equal(codes.includes('TOPIC_SPOILER'), true);
  assert.equal(codes.includes('QUESTION_PAREN_SPOILER'), true);
  assert.equal(codes.includes('COMMENT_MISSING_PREFIX'), true);
});

test('lintCard detects stem-based and clinical domain TOPIC_SPOILER ("Manobras" vs "Manobra de..." and "Pelvimetria" vs "plano zero")', () => {
  const stemSpoilerCard: CanonicalCard = {
    id: 171000109,
    type: 'basic',
    topic: 'Distocia de Ombro - Manobras de Alívio',
    question:
      'No Centro Obstétrico, parturiente apresenta sinal da tartaruga após desprendimento cefálico. Qual a conduta obstétrica imediata de primeira linha?',
    answer: 'Manobra de McRoberts e pressão suprapúbica.',
    hint: '<b>Comentário:</b> A <b>manobra de McRoberts</b> hiperflexiona as coxas maternas e retifica o promontório sacral, enquanto a <b>pressão fúndica de Kristeller</b> é formalmente proscrita.',
  };

  const result1 = lintCard(stemSpoilerCard);
  assert.equal(result1.metrics.hasTopicSpoiler, true);
  assert.equal(
    result1.warnings.some((w) => w.code === 'TOPIC_SPOILER'),
    true
  );

  const pelvimetriaSpoilerCard: CanonicalCard = {
    id: 171000115,
    type: 'cloze',
    topic: 'Assistência ao Parto - Pelvimetria e Estática',
    question:
      'No toque vaginal obstétrico, a insinuação do vértice cefálico nas espinhas isquiáticas corresponde ao {{c1::plano zero}}.',
    answer: '',
    hint: '<b>Comentário:</b> O <b>plano zero de De Lee</b> referencia as espinhas isquiáticas maternas, diferentemente do <b>estreito superior</b> correspondente à conjugata obstétrica.',
  };

  const result2 = lintCard(pelvimetriaSpoilerCard);
  assert.equal(result2.metrics.hasTopicSpoiler, true);
  assert.equal(
    result2.warnings.some((w) => w.code === 'TOPIC_SPOILER'),
    true
  );
});

test('extractUnresolvedLocalImages and applyResolvedWebImageToCard resolve orphan local <img> via web search and store 4-6 alternatives', () => {
  const cardWithOrphanMedia: CanonicalCard = {
    id: 171000110,
    type: 'basic',
    image_mode: 'recognition',
    topic: 'Assistência ao Parto - Monitorização Fetal',
    question:
      'No Centro Obstétrico, parturiente realiza o exame abaixo. Qual a classificação fisiológica imediata?<br><img src="ctg_orfa.png">',
    answer: 'Cardiotocografia categoria I.',
    hint: '<i>Traçado cardiotocográfico fetal intraparto.</i><br><br><b>Comentário:</b> A <b>categoria I</b> indica equilíbrio ácido-básico fetal normal com variabilidade moderada (6–25 bpm), ao passo que a <b>categoria III</b> exige reanimação intrauterina e resolução obstétrica imediata.',
  };

  const unresolved = extractUnresolvedLocalImages(cardWithOrphanMedia, []);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].filename, 'ctg_orfa.png');
  assert.equal(unresolved[0].searchQuery.includes('Traçado cardiotocográfico'), true);

  // Before web resolution -> flags MISSING_MEDIA
  const lintMissing = lintCard(cardWithOrphanMedia, []);
  assert.equal(lintMissing.isValid, false);
  assert.equal(
    lintMissing.warnings.some((w) => w.code === 'MISSING_MEDIA'),
    true
  );

  // After automatic web image resolution -> replaces src with valid web image and stores alternatives
  const mockWebImg: MedicalImageResult = {
    id: 'google-1',
    title: 'Cardiotocografia Categoria I',
    thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/ctg_cat1.jpg',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/ctg_cat1.jpg',
    description: 'CTG normal',
    suggestedFilename: 'ctg_orfa.png',
    defaultLegend: 'Traçado cardiotocográfico fetal intraparto.',
    source: 'Google Search Grounding',
  };

  const autoResolved = applyResolvedWebImageToCard(
    cardWithOrphanMedia,
    'ctg_orfa.png',
    mockWebImg,
    [mockWebImg]
  );
  assert.equal(lintCard(autoResolved, []).isValid, true);
  assert.equal(autoResolved.imageAlternatives?.length, 1);

  // Removing missing media also cleans any remaining orphan tags
  const cleaned = removeMissingMediaFromCard(cardWithOrphanMedia, []);
  assert.equal(cleaned.question.includes('ctg_orfa.png'), false);
  assert.equal(lintCard(cleaned, []).isValid, true);
});

test('lintCard flags cloze card with multiple gaps, > 5 words in gap, dangling particle, ::hint, LaTeX, and non-empty answer', () => {
  const flawedCloze: CanonicalCard = {
    id: 171000106,
    type: 'cloze',
    topic: 'Abdome Agudo - Apendicite Aguda',
    question:
      'Na apendicite aguda ($\\ge 4$ pontos), o sinal de Blumberg indica {{c1::irritação peritoneal localizada na fossa ilíaca de::sinal clássico}} e exige {{c2::apendicectomia}}.',
    answer: 'Resposta não deveria existir no cloze.',
    hint: '<b>Comentário:</b> O <b>sinal de Blumberg</b> traduz dor à descompressão brusca no ponto de McBurney, diferentemente do <b>sinal de Rovsing</b> que avalia dor referida à palpação do quadrante esquerdo.',
  };

  const result = lintCard(flawedCloze);
  assert.equal(result.isValid, false);
  const codes = result.warnings.map((w) => w.code);
  assert.equal(codes.includes('CLOZE_COUNT_INVALID'), true);
  assert.equal(codes.includes('CLOZE_TOO_LONG'), true);
  assert.equal(codes.includes('CLOZE_DANGLING_PARTICLE'), true);
  assert.equal(codes.includes('CLOZE_HAS_HINT'), true);
  assert.equal(codes.includes('CLOZE_NON_EMPTY_ANSWER'), true);
  assert.equal(codes.includes('LATEX_PROHIBITED'), true);
});

test('reconcileDeckIdsAndMedia preserves surviving FSRS IDs by ID (allowing pruned IDs to be excluded) and generates new sequential IDs after maxExistingId', () => {
  const meta = extractDeckMetadata(
    JSON.stringify({
      deck_key: 'abdome_agudo_inflamatorio',
      notes: [
        {
          id: 175000010,
          type: 'basic',
          topic: 'Abdome Agudo - Redundante',
          question: 'Card redundante que será podado',
          answer: 'Podado.',
          hint: '<b>Comentário:</b> Comentário.',
        },
        {
          id: 175000011,
          type: 'basic',
          topic: 'Abdome Agudo - Diagnóstico',
          question: 'Pergunta sobrevivente <img src="tc_apendice.png">',
          answer: 'Resposta antiga.',
          hint: '<b>Comentário:</b> Comentário antigo.',
        },
      ],
    })
  );

  const newCards: CanonicalCard[] = [
    {
      id: 175000011,
      type: 'basic',
      topic: 'Abdome Agudo Inflamatório - Imagem de Escolha',
      question:
        'No Pronto-Socorro, adulto jovem apresenta dor migratória para FID e Alvarado 5. Qual o exame padrão-ouro confirmatório?',
      answer: 'Tomografia computadorizada de abdome e pelve com contraste.',
      hint: '<b>Comentário:</b> A <b>TC de abdome</b> possui sensibilidade > 95% na apendicite aguda em adultos, enquanto a <b>ultrassonografia</b> é preferida inicialmente em gestantes e crianças.',
    },
    {
      id: 0,
      type: 'cloze',
      topic: 'Abdome Agudo Inflamatório - Classificação de Hinchey',
      question:
        'Na diverticulite aguda com abscesso pélvico maior que 4 cm (Hinchey II), a conduta imediata é {{c1::drenagem percutânea guiada por TC}}.',
      answer: '',
      hint: '<b>Comentário:</b> O <b>Hinchey II (> 4 cm)</b> exige drenagem percutânea associada à antibioticoterapia, ao passo que a <b>peritonite purulenta (Hinchey III)</b> demanda abordagem cirúrgica de urgência.',
    },
  ];

  const reconciled = reconcileDeckIdsAndMedia(newCards, meta, 'abdome_agudo_inflamatorio');
  assert.equal(reconciled[0].id, 175000011);
  assert.equal(reconciled[0].question.includes('<img src="tc_apendice.png">'), true);
  assert.equal(reconciled[1].id, 175000012);
});

test('formatCanonicalDeckJson omits sources and rewrites external https:// or data:image URLs into local collection.media filenames', () => {
  const cardWithExternalImg: CanonicalCard = {
    id: 171000101,
    type: 'basic',
    priority: 'P2',
    deck_key: 'emergencia_cardiologia',
    image_mode: 'recognition',
    topic: 'Emergência Clínica - Supradesnivelamento de ST',
    question:
      'Na Sala de Emergência, paciente de 58 anos com dor torácica realiza o ECG abaixo. Qual a conduta imediata de primeira escolha?<br><img src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/12_lead_generated_anterior_MI.JPG/800px-12_lead_generated_anterior_MI.JPG">',
    answer: 'Dupla antiagregação plaquetária e angioplastia primária imediata.',
    hint: '<i>ECG de 12 derivações com supradesnivelamento de ST.</i><br><br><b>Comentário:</b> A <b>reperfusão imediata</b> no IAMCSST salva miocárdio viável, superando o <b>manejo conservador</b>.',
    tags: ['emergencia_cardiologia'],
  };

  const cardWithDataUri: CanonicalCard = {
    id: 171000102,
    type: 'basic',
    priority: 'P2',
    deck_key: 'emergencia_cardiologia',
    image_mode: 'recognition',
    topic: 'Emergência Clínica - Traçado Eletrocardiográfico',
    question:
      'No Pronto-Socorro, paciente apresenta palpitações e o ECG abaixo. Qual o achado rítmico?<br><img src="data:image/svg+xml;utf8,<svg></svg>" data-anki-file="ecg_fibrilacao_atrial.svg">',
    answer: 'Fibrilação atrial com resposta ventricular rápida.',
    hint: '<i>ECG com RR irregular e ausência de onda P.</i><br><br><b>Comentário:</b> A <b>ausência de ondas P</b> com intervalos RR irregulares define <b>fibrilação atrial</b>.',
    tags: ['emergencia_cardiologia'],
  };

  const manifest = extractDeckMediaManifest(
    [cardWithExternalImg, cardWithDataUri],
    'emergencia_cardiologia'
  );
  assert.equal(manifest.length, 2);
  assert.equal(manifest[0].filename, '12_lead_generated_anterior_mi.jpg');
  assert.equal(manifest[1].filename, 'ecg_fibrilacao_atrial.svg');

  const exportedJson = formatCanonicalDeckJson(
    [cardWithExternalImg, cardWithDataUri],
    null,
    'emergencia_cardiologia'
  );
  const parsedExport = JSON.parse(exportedJson);
  assert.equal(Array.isArray(parsedExport), true);
  assert.equal(parsedExport.length, 2);
  assert.equal('sources' in parsedExport[0], false);
  assert.equal('priority' in parsedExport[0], false);
  assert.equal(
    parsedExport[0].question.includes('<img src="12_lead_generated_anterior_mi.jpg">'),
    true
  );
  assert.equal(parsedExport[0].question.includes('https://'), false);
  assert.equal(
    parsedExport[1].question.includes('<img src="ecg_fibrilacao_atrial.svg">'),
    true
  );
  assert.equal(parsedExport[1].question.includes('data:image'), false);
});

test('curateAndRebalanceDeck prunes duplicates, adds P1-P4 gaps, and preserves fluid basic/cloze formats without forcing 50/50', () => {
  const rawHundredCards: CanonicalCard[] = [];
  for (let i = 0; i < 100; i++) {
    const id = 1775500001 + i;
    if (i >= 0 && i <= 12) {
      rawHundredCards.push({
        id,
        type: 'cloze',
        topic: 'Assistência ao Parto - Período Expulsivo #1',
        question:
          'Na assistência ao período expulsivo de gestante de risco habitual, a ausculta dos batimentos cardiofetais ocorre a cada {{c1::15 minutos}}.',
        answer: '',
        hint: '<b>Comentário:</b> No <b>risco habitual</b>, avalia-se a vitalidade a cada <b>15 minutos</b> no expulsivo, diferentemente do <b>alto risco</b> avaliado a cada 5 minutos.',
        tags: ['assistencia_ao_parto'],
      });
      continue;
    }

    const isCloze = i < 90;
    rawHundredCards.push({
      id,
      type: isCloze ? 'cloze' : 'basic',
      topic: `Assistência ao Parto - Subtema Clínico Distinto ${i}`,
      question: isCloze
        ? `No protocolo obstétrico da etapa clínica número ${i} com aspecto morfológico específico_${i}, o parâmetro preconizado é {{c1::conduta obstétrica número ${i}}}.`
        : `No Centro Obstétrico, parturiente na etapa clínica ${i} apresenta quadro específico_${i}. Qual a conduta imediata de primeira escolha?`,
      answer: isCloze ? '' : `Conduta obstétrica específica ${i}.`,
      hint: `<b>Comentário:</b> Na <b>etapa obstétrica ${i}</b>, prioriza-se a <b>intervenção imediata padronizada</b>, diferenciando-se das <b>condutas de segunda linha</b>.`,
      tags: ['assistencia_ao_parto'],
    });
  }

  const meta = extractDeckMetadata(JSON.stringify(rawHundredCards));
  const map = buildGenericClinicalMap('assistencia_ao_parto', meta.rawCards);
  const { cards: curated, stats } = curateAndRebalanceDeck(
    meta.rawCards,
    meta,
    'assistencia_ao_parto',
    map
  );

  assert.equal(stats.originalCount, 100);
  assert.equal(stats.prunedCount, 12);
  assert.equal(stats.addedCount >= 1, true);
  assert.notEqual(curated.length, 100);

  // Fluid format: does NOT force-convert cards to fit an artificial 45%-55% quota
  assert.equal(stats.convertedCount, 0);
  assert.equal(stats.clozePct > 55, true);
  assert.equal(stats.basicPct + stats.clozePct, 100);
});

test('curateAndRebalanceDeck accurately reports pruned, added, and converted counts for AI-rebuilt batches', () => {
  const originals: CanonicalCard[] = [
    {
      id: 1001,
      type: 'cloze',
      topic: 'DIPA - Contracepção',
      question: 'ACOs atuam como {{c1::proteção}} contra DIP.',
      answer: '',
      hint: '<b>Comentário:</b> Espessam muco cervical.',
    },
    {
      id: 1002,
      type: 'cloze',
      topic: 'DIPA - Risco DIU',
      question: 'Risco maior nas primeiras {{c1::3}} semanas.',
      answer: '',
      hint: '<b>Comentário:</b> Introdução mecânica.',
    },
    {
      id: 1003,
      type: 'cloze',
      topic: 'DIPA - Redundante',
      question: 'Card redundante antigo com {{c1::item duplicado}}.',
      answer: '',
      hint: '<b>Comentário:</b> Duplicado.',
    },
  ];
  const meta = extractDeckMetadata(JSON.stringify(originals));
  const aiRebuilt: CanonicalCard[] = [
    {
      id: 1001,
      type: 'basic',
      priority: 'P3',
      topic: 'DIPA - Proteção Hormonal',
      question: 'Por que os anticoncepcionais orais combinados reduzem a DIP sintomática?',
      answer: 'Espessam o muco cervical dificultando ascensão bacteriana.',
      hint: '<b>Comentário:</b> Os <b>ACOs espessam o muco</b>, diferente das <b>duchas vaginais</b> que favorecem ascensão bacteriana na cavidade pélvica.',
    },
    {
      id: 1002,
      type: 'cloze',
      priority: 'P3',
      topic: 'DIPA - Risco DIU',
      question: 'O DIU eleva o risco de DIP aguda apenas nas primeiras {{c1::3}} semanas pós-inserção.',
      answer: '',
      hint: '<b>Comentário:</b> Risco ligado à <b>introdução mecânica</b> na inserção, ao passo que a <b>permanência prolongada</b> não aumenta DIP.',
    },
    {
      id: 1004,
      type: 'basic',
      priority: 'P1',
      topic: 'DIPA - Abscesso Roto',
      question: 'Na Sala Vermelha, paciente com DIP séptica e suspeita de abscesso tubo-ovariano roto. Qual a conduta imediata?',
      answer: 'Antibioticoterapia parenteral de amplo espectro e abordagem cirúrgica.',
      hint: '<b>Comentário:</b> A <b>rotura de abscesso</b> exige cirurgia imediata além de antibióticos, diferente do <b>abscesso íntegro</b> inicialmente tratado clinicamente.',
    },
  ];

  const { stats } = curateAndRebalanceDeck(aiRebuilt, meta, 'dipa', null, {
    skipTemplateGapAdditions: true,
  });

  assert.equal(stats.originalCount, 3);
  assert.equal(stats.finalCount, 3);
  assert.equal(stats.preservedIdsCount, 2);
  assert.equal(stats.prunedCount, 1);
  assert.equal(stats.addedCount, 1);
  assert.equal(stats.convertedCount, 1);

  const visualHintCard = surgicalRepairCardLocal({
    id: 1099,
    type: 'basic',
    topic: 'DIPA - USG',
    question: 'Qual achado na USG?',
    answer: 'Sinal da roda dentada.',
    hint: '<i>Legenda visual: pregas tubárias espessadas em corte transversal.</i><br><br><b>Comentário:</b> O <b>sinal da roda dentada</b> indica salpingite aguda, diferente do <b>sinal das contas de rosário</b> na hidrossalpinge crônica.',
  });
  const commentMatches = visualHintCard.hint.match(/<b>\s*Coment[áa]rio:\s*<\/b>/gi) || [];
  assert.equal(commentMatches.length, 1);
  assert.equal(visualHintCard.hint.startsWith('<i>Legenda visual:'), true);

  const tripleRegimenCard = surgicalRepairCardLocal({
    id: 1100,
    type: 'basic',
    topic: 'DIPA - Tratamento Ambulatorial',
    question: 'Qual esquema ambulatorial de 1ª escolha?',
    answer: 'Ceftriaxona 500 mg IM DU, Doxiciclina 100 mg e Metronidazol 500 mg.',
    hint: '<b>Comentário:</b> A tríade cobre <b>gonococo, clamídia e anaeróbios</b> por 14 dias, diferente da <b>cervicite isolada</b> que dispensa metronidazol.',
  });
  assert.equal(tripleRegimenCard.answer.includes('Metronidazol 500 mg.'), true);
  assert.equal(lintCard(tripleRegimenCard).isValid, true);
});

test('computeDeterministicDeckId and resolveOrCreateNoteGuid preserve FSRS GUIDs across sessions', () => {
  const deckId = computeDeterministicDeckId('assistencia_ao_parto');
  const registry: GuidRegistryData = { version: 1, entries: {} };
  const res1 = resolveOrCreateNoteGuid(
    'assistencia_ao_parto',
    deckId,
    1775500001,
    registry.entries
  );
  const res2 = resolveOrCreateNoteGuid(
    'assistencia_ao_parto',
    deckId,
    1775500001,
    registry.entries
  );
  assert.equal(res1.guid, res2.guid);
  assert.equal(res1.guid.length > 0, true);
  assert.equal(res1.key, 'assistencia_ao_parto:id:1775500001');
  assert.equal(registry.entries['assistencia_ao_parto:id:1775500001'], res1.guid);
});

test('reconcileDeckIdsAndMedia keeps hint-side images in hint and surgicalRepairCardLocal prevents double Comentário, mid-word hint truncation and prefix TOPIC_SPOILER', () => {
  const origHintCard: CanonicalCard = {
    id: 1789520693247,
    type: 'cloze',
    topic: 'Dermatite atópica - Hidratação',
    question: 'Aplicar emoliente em até {{c1::3 minutos}} após o banho.',
    answer: '',
    hint: '<img src="tabela_hidratantes.png"><br><i>Classificação dos hidratantes na dermatite atópica.</i><br><br><b>Comentário:</b> O emoliente preserva a barreira.',
  };

  const generatedWithoutImg: CanonicalCard = {
    id: 1789520693247,
    type: 'cloze',
    topic: 'Dermatite atópica - Hidratação',
    question: 'Na dermatite atópica, o emoliente deve ser aplicado em até {{c1::3 minutos}} após o banho.',
    answer: '',
    hint: '<i>Classificação dos hidratantes na dermatite atópica.</i><br><br><b>Comentário:</b> A aplicação imediata em até <b>3 minutos</b> sela a água no estrato córneo e compensa a <b>deficiência de filagrina</b>; banhos quentes demorados piorem o ressecamento.',
  };

  const reconciled = reconcileDeckIdsAndMedia(
    [generatedWithoutImg],
    {
      rawCards: [origHintCard],
      existingIds: [1789520693247],
      mediaTags: ['<img src="tabela_hidratantes.png">'],
      detectedDeckKey: 'desordens_sistema_imune',
    },
    'desordens_sistema_imune'
  );

  assert.equal(reconciled[0].question.includes('<img'), false);
  assert.equal(reconciled[0].hint.startsWith('<img src="tabela_hidratantes.png">'), true);

  const repairedImgHint = surgicalRepairCardLocal({
    ...reconciled[0],
    hint:
      '<img src="tabela_hidratantes.png"><br><i>Classificação dos hidratantes na dermatite atópica.</i><br><br><b>Comentário:</b> ' +
      'A aplicação imediata em até <b>3 minutos</b> sela a água no estrato córneo e compensa a <b>deficiência de filagrina</b>. ' +
      'Em contraste, banhos quentes demorados e sabonetes alcalinos removem lipídios da barreira epidérmica, agravando o prurido e a perda transepidérmica de água em lactentes e escolares com atopia.',
  });

  const commentPrefixCount = (repairedImgHint.hint.match(/<b>\s*Coment[áa]rio:\s*<\/b>/gi) || []).length;
  assert.equal(commentPrefixCount, 1);
  assert.equal(repairedImgHint.hint.startsWith('<img src="tabela_hidratantes.png">'), true);
  assert.equal(repairedImgHint.hint.includes('Conduta prioritária'), false);
  assert.equal(/\btipicame\.|\benquanto\s+[a-z]\.|\bcom\.$/.test(repairedImgHint.hint), false);

  const spoilerPrefixCard = surgicalRepairCardLocal({
    id: 1789520693285,
    type: 'basic',
    topic: 'Rinite alérgica - Gravidade',
    question: 'Escolar com obstrução nasal apresenta despertar noturno frequente. Qual a classificação ARIA?',
    answer: 'Rinite moderada a grave.',
    hint: '<b>Comentário:</b> A alteração do <b>sono ou lazer</b> já define quadro moderado a grave, diferente da <b>forma leve</b> sem impacto funcional.',
  });
  const spoilerCheck = lintCard(spoilerPrefixCard);
  assert.equal(spoilerCheck.warnings.some((w) => w.code === 'TOPIC_SPOILER'), false);

  const shortSingleAdjectiveTopicCard = surgicalRepairCardLocal({
    id: 1789520693265,
    type: 'basic',
    topic: 'Alergia Pediátrica - Conduta',
    question: 'Lactente tolera ovo sem sintomas e tem IgE positiva. Qual a conduta?',
    answer: 'Manter o alimento na dieta, pois há apenas sensibilização, não alergia.',
    hint: '<b>Comentário:</b> O diagnóstico exige clínica reprodutível após exposição (< 2 horas), enquanto <b>sensibilização isolada</b> não justifica exclusão.',
  });
  assert.equal(shortSingleAdjectiveTopicCard.topic.startsWith('Pediátrica'), false);
  assert.equal(
    lintCard(shortSingleAdjectiveTopicCard).warnings.some((w) => w.code === 'COMMENT_TOO_SHORT'),
    false
  );
});

test('inferDomainProfile classifies all 4 medical domain profiles accurately and avoids GO/emergency bias', () => {
  assert.equal(
    inferDomainProfile('etica_medica_bioetica_documentacao'),
    'preventiva_normativo'
  );
  assert.equal(
    inferDomainProfile('sus_legislacao_vigilancia_notificacao'),
    'preventiva_normativo'
  );
  assert.equal(
    inferDomainProfile('abdome_agudo_inflamatorio_apendicite'),
    'cirurgico'
  );
  assert.equal(
    inferDomainProfile('trauma_toracico_atls_drenagem'),
    'cirurgico'
  );
  assert.equal(
    inferDomainProfile('sindromes_coronarianas_agudas_iam'),
    'emergencia'
  );
  assert.equal(
    inferDomainProfile('sepse_choque_septico_minuto_zero'),
    'emergencia'
  );
  assert.equal(
    inferDomainProfile('diabetes_mellitus_tipo_2_ubs'),
    'ambulatorio'
  );
  assert.equal(
    inferDomainProfile('metodos_contraceptivos_criterios_elegibilidade'),
    'ambulatorio'
  );
});

test('buildGenericClinicalMap adapts P1-P4 priorities to active DomainProfile and removes synthetic atlas SVGs', () => {
  const preventivaMap = buildGenericClinicalMap('etica_medica_sigilo_prontuario', []);
  assert.equal(preventivaMap.profile, 'preventiva_normativo');
  assert.equal(preventivaMap.items.length >= 4, true);
  assert.equal(
    preventivaMap.items.some((item) => /Sala Vermelha|gestante|parto/i.test(item.concept)),
    false
  );

  const cirurgicoMap = buildGenericClinicalMap('colecistite_aguda_cirurgia', []);
  assert.equal(cirurgicoMap.profile, 'cirurgico');

  const ambulatorioOverride = buildGenericClinicalMap(
    'tema_custom',
    [],
    'ambulatorio'
  );
  assert.equal(ambulatorioOverride.profile, 'ambulatorio');

  assert.equal(
    DOMAIN_PROFILE_CONFIGS.preventiva_normativo.priorityLabels.P1.length > 5,
    true
  );
  assert.equal(
    formatProfilePromptBlock('cirurgico').includes('PERFIL DE DOMÍNIO ATIVO'),
    true
  );

  // Zero synthetic drawn SVGs in fallback atlas
  assert.equal(HIGH_PRECISION_MEDICAL_ATLAS.length, 0);
  assert.deepEqual(matchMedicalAtlasImages('ECG supradesnivelamento IAM'), []);
});

test('readMultipleDocumentFiles snapshots live FileList before awaits so clearing input.value never drops files 2..N', async () => {
  const f1 = new File(['%PDF-1.4\nconteudo'], 'diretriz_ms.pdf', { type: 'application/pdf' });
  const f2 = new File(['Resumo clinico do tema'], 'resumo_aula.md', { type: 'text/markdown' });
  const f3 = new File(['Questao 1 USP'], 'simulado_usp.txt', { type: 'text/plain' });

  // Simulate browser live FileList whose items disappear as soon as e.target.value = '' runs synchronously
  let cleared = false;
  const backing = [f1, f2, f3];
  const liveFileList: ArrayLike<File> = {
    get length() {
      return cleared ? 0 : backing.length;
    },
    get 0() {
      return cleared ? (undefined as unknown as File) : backing[0];
    },
    get 1() {
      return cleared ? (undefined as unknown as File) : backing[1];
    },
    get 2() {
      return cleared ? (undefined as unknown as File) : backing[2];
    },
  };

  const promise = readMultipleDocumentFiles(liveFileList);
  // Synchronous reset right after calling handler (exact React onChange behavior)
  cleared = true;

  const docs = await promise;
  assert.equal(docs.length, 3);
  assert.equal(docs[0].name, 'diretriz_ms.pdf');
  assert.equal(docs[0].docRole, 'diretriz');
  assert.equal(docs[0].base64Data.length > 0, true);
  assert.equal(docs[1].name, 'resumo_aula.md');
  assert.equal(docs[1].docRole, 'resumo');
  assert.equal(docs[1].textContent, 'Resumo clinico do tema');
  assert.equal(docs[2].name, 'simulado_usp.txt');
  assert.equal(docs[2].docRole, 'questoes');
  assert.equal(docs[2].textContent, 'Questao 1 USP');
});
