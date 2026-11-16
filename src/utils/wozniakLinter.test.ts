import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyResolvedWebImageToCard,
  buildDeckMediaResolution,
  computeDeterministicDeckId,
  convertClozeToBasic,
  curateAndRebalanceDeck,
  extractDeckMediaManifest,
  extractDeckMetadata,
  extractUnresolvedLocalImages,
  formatCanonicalDeckJson,
  lintCard,
  lintDeck,
  detectModalityConflict,
  detectRedundantVisualDescription,
  findDuplicateDeckImages,
  reconcileDeckIdsAndMedia,
  removeMissingMediaFromCard,
  resolveLocalMediaFilename,
  resolveOrCreateNoteGuid,
  sanitizeMedicalHtml,
  stripHtml,
  surgicalRepairCardLocal,
} from './wozniakLinter';
import {
  assignCaptionsAndFilterWatermarks,
  collectPageCaptionMatches,
  extractContextForFigure,
  hasClinicalFigurePageKeyword,
  type RawPdfPageBuffer,
} from './pdfImageCore';
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
    hint: '<i>Traçado cardiotocográfico fetal intraparto com variabilidade moderada preservada.</i><br><br><b>Comentário:</b> A <b>categoria I</b> indica equilíbrio ácido-básico fetal normal com variabilidade moderada (6–25 bpm), ao passo que a <b>categoria III</b> exige reanimação intrauterina e resolução obstétrica imediata.',
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
    defaultLegend: 'Traçado cardiotocográfico fetal intraparto com variabilidade moderada preservada.',
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

test('lintDeck flags DUPLICATE_IMAGE_IN_DECK when two or more cards share the same <img src> before .apkg export', () => {
  const card1: CanonicalCard = {
    id: 171000201,
    type: 'basic',
    image_mode: 'recognition',
    topic: 'Cardiologia - Emergência Coronariana',
    question:
      'Na Sala de Emergência, paciente com dor torácica típica realiza o exame abaixo. Qual a conduta imediata de primeira escolha?<br><img src="https://upload.wikimedia.org/wikipedia/commons/ecg_anterior.jpg">',
    answer: 'Dupla antiagregação plaquetária e angioplastia primária imediata.',
    hint: '<i>ECG de 12 derivações evidenciando supradesnivelamento de ST em parede anterior.</i><br><br><b>Comentário:</b> A <b>reperfusão imediata</b> reduz mortalidade no IAMCSST, diferentemente do <b>manejo conservador</b>.',
  };

  const card2SameImg: CanonicalCard = {
    id: 171000202,
    type: 'cloze',
    image_mode: 'feedback',
    topic: 'Cardiologia - Critério Eletrocardiográfico',
    question:
      'No IAMCSST anterior, o supradesnivelamento significativo do ponto J em V2-V3 em homens ≥ 40 anos exige amplitude ≥ {{c1::2 mm}}.',
    answer: '',
    hint: '<img src="https://upload.wikimedia.org/wikipedia/commons/ecg_anterior.jpg"><br><i>ECG de 12 derivações com supradesnivelamento em derivações precordiais anteriores.</i><br><br><b>Comentário:</b> O corte em <b>V2-V3 (≥ 2 mm)</b> diferencia homens ≥ 40 anos de <b>mulheres (≥ 1,5 mm)</b>.',
  };

  const card3UniqueImg: CanonicalCard = {
    id: 171000203,
    type: 'basic',
    image_mode: 'recognition',
    topic: 'Pneumologia - Derrame Pleural',
    question:
      'No Pronto-Socorro, paciente dispneico realiza o exame de tórax abaixo. Qual a conduta diagnóstica inicial?<br><img src="https://upload.wikimedia.org/wikipedia/commons/rx_derrame_pleural.jpg">',
    answer: 'Toracocentese diagnóstica guiada por ultrassonografia.',
    hint: '<i>Radiografia de tórax PA evidenciando velamento homogêneo em base direita.</i><br><br><b>Comentário:</b> A <b>toracocentese com critérios de Light</b> distingue exsudato de transudato, diferente da <b>drenagem imediata</b> reservada ao empiema.',
  };

  const auditWithDup = lintDeck([card1, card2SameImg], [], 'cardiologia_emergencia');
  assert.equal(auditWithDup.canExport, false);
  assert.equal(auditWithDup.isValid, false);
  assert.equal(auditWithDup.duplicateImages.length, 1);
  assert.deepEqual(auditWithDup.duplicateImages[0].cardIds, [171000201, 171000202]);
  assert.equal(
    auditWithDup.errors.some((e) => e.code === 'DUPLICATE_IMAGE_IN_DECK'),
    true
  );

  // Distinct local/web images pass duplicate check
  assert.equal(findDuplicateDeckImages([card1, card3UniqueImg]).length, 0);
  const auditClean = lintDeck([card1, card3UniqueImg], [], 'emergencia_clinica');
  assert.equal(auditClean.canExport, true);
  assert.equal(auditClean.isValid, true);
});

test('lintCard and lintDeck flag IMAGE_MISSING_LEGEND when <img> in Question or Hint lacks an <i>...</i> legend with >= 6 descriptive words', () => {
  const missingLegendQuestionImg: CanonicalCard = {
    id: 171000301,
    type: 'basic',
    image_mode: 'recognition',
    topic: 'Abdome Agudo - Avaliação Inicial',
    question:
      'No Pronto-Socorro, paciente com dor abdominal súbita realiza o exame abaixo. Qual o próximo passo imediato?<br><img src="https://upload.wikimedia.org/wikipedia/commons/rx_abdomen.jpg">',
    answer: 'Laparotomia exploradora de urgência.',
    hint: '<b>Comentário:</b> A presença de <b>ar livre subdiafragmático</b> confirma perfuração de víscera oca, superando o <b>tratamento clínico isolado</b>.',
  };

  const shortLegendHintImg: CanonicalCard = {
    id: 171000302,
    type: 'cloze',
    image_mode: 'feedback',
    topic: 'Obstetrícia - Vitalidade Fetal',
    question:
      'Na presença de desacelerações tardias recorrentes, a primeira medida de reanimação intrauterina é {{c1::decúbito lateral esquerdo}}.',
    answer: '',
    hint: '<img src="https://upload.wikimedia.org/wikipedia/commons/ctg_late.jpg"><br><i>Legenda visual: CTG alterada.</i><br><br><b>Comentário:</b> O <b>decúbito lateral esquerdo</b> reduz compressão aortocava, diferentemente da <b>infusão de ocitocina</b> que deve ser suspensa.',
  };

  const validLegendHintImg: CanonicalCard = {
    id: 171000303,
    type: 'cloze',
    image_mode: 'feedback',
    topic: 'Obstetrícia - Vitalidade Fetal',
    question:
      'Na presença de desacelerações tardias recorrentes, a primeira medida de reanimação intrauterina é {{c1::decúbito lateral esquerdo}}.',
    answer: '',
    hint: '<img src="https://upload.wikimedia.org/wikipedia/commons/ctg_late_ok.jpg"><br><i>Traçado cardiotocográfico evidenciando desacelerações tardias após contrações uterinas.</i><br><br><b>Comentário:</b> O <b>decúbito lateral esquerdo</b> reduz compressão aortocava, diferentemente da <b>infusão de ocitocina</b> que deve ser suspensa.',
  };

  const lint1 = lintCard(missingLegendQuestionImg, []);
  assert.equal(lint1.isValid, false);
  assert.equal(
    lint1.warnings.some((w) => w.severity === 'error' && w.message.includes('IMAGE_MISSING_LEGEND')),
    true
  );

  const lint2 = lintCard(shortLegendHintImg, []);
  assert.equal(lint2.isValid, false);
  assert.equal(
    lint2.warnings.some((w) => w.severity === 'error' && w.message.includes('IMAGE_MISSING_LEGEND')),
    true
  );

  const deckAudit = lintDeck([missingLegendQuestionImg, shortLegendHintImg], [], 'obstetricia');
  assert.equal(deckAudit.canExport, false);
  assert.equal(
    deckAudit.errors.filter((e) => e.code === 'IMAGE_MISSING_LEGEND').length,
    2
  );

  const validAudit = lintDeck([validLegendHintImg], [], 'obstetricia');
  assert.equal(validAudit.canExport, true);
  assert.equal(
    validAudit.allIssues.some((i) => i.code === 'IMAGE_MISSING_LEGEND'),
    false
  );
});

test('lintCard and lintDeck detect MODALITY_CONFLICT between card text and legend without false positives on comparative comments', () => {
  const laparoscopiaVsUsgCard: CanonicalCard = {
    id: 171000401,
    type: 'basic',
    image_mode: 'recognition',
    topic: 'Ginecologia - Doença Inflamatória Pélvica',
    question:
      'Na laparoscopia diagnóstica de paciente com dor pélvica crônica, observa-se o achado abaixo. Qual síndrome é caracterizada?',
    answer: 'Síndrome de Fitz-Hugh-Curtis.',
    hint: '<i>Ultrassonografia pélvica transvaginal demonstrando líquido livre e espessamento anexial importante.</i><br><br><b>Comentário:</b> A <b>peri-hepatite gonocócica ou por clamídia</b> gera aderências em cordas de violino, diferente da <b>apendicite aguda</b>.',
  };
  // Attach image to question
  laparoscopiaVsUsgCard.question += '<br><img src="https://upload.wikimedia.org/wikipedia/commons/usg_pelvica.jpg">';

  const usgVsLaparoscopiaCard: CanonicalCard = {
    id: 171000402,
    type: 'basic',
    image_mode: 'feedback',
    topic: 'Ginecologia - Propedêutica Pélvica',
    question:
      'Na suspeita de abscesso tubo-ovariano, qual achado na USG transvaginal confirma o diagnóstico?',
    answer: 'Coleção anexial multiloculada com paredes espessas.',
    hint: '<img src="https://upload.wikimedia.org/wikipedia/commons/lap_ato.jpg"><br><i>Videolaparoscopia pélvica evidenciando aderências tubárias extensas e pus livre.</i><br><br><b>Comentário:</b> A <b>USG transvaginal</b> identifica coleções septadas à beira-leito, reservando-se a <b>laparoscopia</b> aos casos duvidosos ou refratários.',
  };

  // Valid card where Comentário compares TC vs USG, while question is modality-neutral
  const comparativeCommentValidCard: CanonicalCard = {
    id: 171000403,
    type: 'basic',
    image_mode: 'recognition',
    topic: 'Cirurgia - Abdome Agudo',
    question:
      'No Pronto-Socorro, adulto jovem com dor migratória em fossa ilíaca direita realiza o exame abaixo. Qual a conduta imediata?<br><img src="https://upload.wikimedia.org/wikipedia/commons/tc_apendicite.jpg">',
    answer: 'Antibioticoprofilaxia e apendicectomia.',
    hint: '<i>Tomografia computadorizada de abdome demonstrando apêndice distendido e borramento adiposo.</i><br><br><b>Comentário:</b> A <b>TC de abdome</b> tem alta sensibilidade em adultos, ao passo que a <b>USG</b> é preferida inicialmente em gestantes.',
  };

  // Valid multi-step card mentioning prior USG and current RM
  const multiStepModalityValidCard: CanonicalCard = {
    id: 171000404,
    type: 'basic',
    image_mode: 'recognition',
    topic: 'Cirurgia - Gestante com Dor Abdominal',
    question:
      'Após USG inconclusiva em gestante de 22 semanas, solicita-se a RM abaixo. Qual a conduta definitiva?<br><img src="https://upload.wikimedia.org/wikipedia/commons/rm_apendice.jpg">',
    answer: 'Apendicectomia videolaparoscópica.',
    hint: '<i>Ressonância magnética pélvica demonstrando apêndice retrocecal espessado sem radiação ionizante.</i><br><br><b>Comentário:</b> A <b>RM sem gadolínio</b> esclarece casos duvidosos na gestação após USG, evitando atraso cirúrgico frente à <b>perfuração apendicular</b>.',
  };

  assert.equal(detectModalityConflict(laparoscopiaVsUsgCard).hasConflict, true);
  assert.equal(detectModalityConflict(usgVsLaparoscopiaCard).hasConflict, true);
  assert.equal(detectModalityConflict(comparativeCommentValidCard).hasConflict, false);
  assert.equal(detectModalityConflict(multiStepModalityValidCard).hasConflict, false);

  const conflictDeckAudit = lintDeck(
    [laparoscopiaVsUsgCard, usgVsLaparoscopiaCard],
    [],
    'dipa_gineco'
  );
  assert.equal(conflictDeckAudit.canExport, false);
  assert.equal(
    conflictDeckAudit.errors.filter((e) => e.code === 'MODALITY_CONFLICT').length,
    2
  );

  const validDeckAudit = lintDeck(
    [comparativeCommentValidCard, multiStepModalityValidCard],
    [],
    'abdome_agudo'
  );
  assert.equal(validDeckAudit.canExport, true);
  assert.equal(
    validDeckAudit.allIssues.some((i) => i.code === 'MODALITY_CONFLICT'),
    false
  );
});

test('lintCard and lintDeck warn with REDUNDANT_VISUAL_DESCRIPTION when Med_Basic_Inverted_v2 question textually describes the image finding', () => {
  const redundantBasicCard: CanonicalCard = {
    id: 171000501,
    type: 'basic',
    image_mode: 'recognition',
    topic: 'Cardiologia - Dor Torácica Aguda',
    question:
      'Na Sala de Emergência, paciente realiza o ECG abaixo evidenciando supradesnivelamento de ST em parede anterior. Qual é a conduta imediata de primeira escolha?<br><img src="https://upload.wikimedia.org/wikipedia/commons/ecg_stemi_redundant.jpg">',
    answer: 'Dupla antiagregação plaquetária e angioplastia primária imediata.',
    hint: '<i>ECG de 12 derivações evidenciando supradesnivelamento de ST em parede anterior.</i><br><br><b>Comentário:</b> A <b>reperfusão coronariana imediata</b> preserva miocárdio viável, diferentemente do <b>manejo clínico isolado</b>.',
  };

  const redundantLegendOverlapCard: CanonicalCard = {
    id: 171000502,
    type: 'basic',
    image_mode: 'recognition',
    topic: 'Ginecologia - Salpingite',
    question:
      'Na imagem abaixo observam-se pregas tubárias edemaciadas em sinal da roda dentada. Qual o diagnóstico?<br><img src="https://upload.wikimedia.org/wikipedia/commons/usg_roda_dentada.jpg">',
    answer: 'Salpingite aguda (doença inflamatória pélvica).',
    hint: '<i>Ultrassonografia transvaginal demonstrando pregas tubárias edemaciadas em sinal da roda dentada.</i><br><br><b>Comentário:</b> O <b>sinal da roda dentada</b> traduz processo inflamatório agudo, diferente da <b>hidrossalpinge crônica</b> em contas de rosário.',
  };

  const nonRedundantRecognitionCard: CanonicalCard = {
    id: 171000503,
    type: 'basic',
    image_mode: 'recognition',
    topic: 'Cardiologia - Dor Torácica Aguda',
    question:
      'Na Sala de Emergência, paciente de 58 anos com dor torácica típica e sudorese fria realiza o exame abaixo. Qual é a conduta imediata de primeira escolha?<br><img src="https://upload.wikimedia.org/wikipedia/commons/ecg_stemi_clean.jpg">',
    answer: 'Dupla antiagregação plaquetária e angioplastia primária imediata.',
    hint: '<i>ECG de 12 derivações evidenciando supradesnivelamento de ST em parede anterior.</i><br><br><b>Comentário:</b> A <b>reperfusão coronariana imediata</b> preserva miocárdio viável e reduz mortalidade no IAMCSST, diferentemente do <b>manejo clínico isolado</b>.',
  };

  assert.equal(detectRedundantVisualDescription(redundantBasicCard).isRedundant, true);
  assert.equal(detectRedundantVisualDescription(redundantLegendOverlapCard).isRedundant, true);
  assert.equal(detectRedundantVisualDescription(nonRedundantRecognitionCard).isRedundant, false);

  const lintRedundant = lintCard(redundantBasicCard, []);
  assert.equal(
    lintRedundant.warnings.some(
      (w) => w.severity === 'warning' && w.message.includes('REDUNDANT_VISUAL_DESCRIPTION')
    ),
    true
  );

  const audit = lintDeck(
    [redundantBasicCard, nonRedundantRecognitionCard],
    [],
    'cardiologia'
  );
  assert.equal(audit.canExport, true);
  assert.equal(
    audit.warnings.some(
      (w) => w.code === 'REDUNDANT_VISUAL_DESCRIPTION' && w.cardId === 171000501
    ),
    true
  );
  assert.equal(
    audit.allIssues.some((w) => w.cardId === 171000503),
    false
  );
});

test('surgicalRepairCardLocal abbreviates long clozes in-place without leaking overflow words outside {{c1::...}}', () => {
  const longClozeCard: CanonicalCard = {
    id: 171000601,
    type: 'cloze',
    topic: 'Obstetrícia - Pré-eclâmpsia Grave',
    question:
      'Na pré-eclâmpsia com sinais de gravidade, a conduta imediata envolve {{c1::internação hospitalar e sulfato de magnésio por via intravenosa}}.',
    answer: '',
    hint: '<b>Comentário:</b> O <b>sulfato de magnésio IV</b> previne eclâmpsia e deve ser iniciado imediatamente na admissão, diferente dos <b>anti-hipertensivos isolados</b> que não protegem contra convulsões.',
  };

  const repaired = surgicalRepairCardLocal(longClozeCard);
  // Must keep "magnésio IV" inside {{c1::...}} instead of spilling outside `}}` as a spoiler
  assert.equal(repaired.question.includes('}} magnésio'), false);
  assert.equal(repaired.question.includes('{{c1::internação hospitalar e sulfato de magnésio IV}}'), true);
});

test('stemsCollideForSpoiler eliminates Greek-prefix false positives (hiper/hipot/pneum/cole) while catching medical acronym spoilers', () => {
  const greekPairs: Array<[string, string]> = [
    ['Tireoide - Hipertireoidismo', 'Hiperplasia nodular benigna.'],
    ['Endocrinologia - Hipotireoidismo', 'Hipotermia severa.'],
    ['Pneumologia - Pneumonia Adquirida', 'Pneumotórax hipertensivo.'],
    ['Metabolismo - Hiperglicemia', 'Hipercalemia grave.'],
  ];

  for (const [topic, answer] of greekPairs) {
    const card: CanonicalCard = {
      id: 171000701,
      type: 'basic',
      topic,
      question:
        'Na Sala de Emergência, paciente adulto apresenta quadro agudo característico após avaliação inicial. Qual o diagnóstico prioritário?',
      answer,
      hint: '<b>Comentário:</b> O <b>achado clínico imediato</b> exige reconhecimento ágil no pronto-atendimento, diferenciando-se das <b>condições crônicas indolentes</b>.',
    };
    const result = lintCard(card);
    assert.equal(
      result.warnings.some((w) => w.code === 'TOPIC_SPOILER'),
      false,
      `Unexpected TOPIC_SPOILER for topic="${topic}" vs answer="${answer}"`
    );
  }

  // Short medical acronyms (HNF, DIU, USG) MUST still trigger spoilers when matching topic or parenthetical
  const hnfTopicSpoiler: CanonicalCard = {
    id: 171000702,
    type: 'basic',
    topic: 'Anticoagulação - Uso de HNF',
    question: 'Em paciente com ClCr < 15 mL/min e TVP aguda, qual anticoagulante parenteral escolher?',
    answer: 'HNF em bomba de infusão.',
    hint: '<b>Comentário:</b> A <b>HNF não depende de depuração renal</b>, diferente da <b>enoxaparina</b> que acumula na disfunção renal grave.',
  };
  assert.equal(
    lintCard(hnfTopicSpoiler).warnings.some((w) => w.code === 'TOPIC_SPOILER'),
    true
  );

  const diuParenSpoiler: CanonicalCard = {
    id: 171000703,
    type: 'basic',
    topic: 'Ginecologia - Contracepção de Emergência',
    question: 'Mulher atendida até 5 dias após coito desprotegido (opção: DIU) busca método mais eficaz. Qual escolher?',
    answer: 'DIU de cobre.',
    hint: '<b>Comentário:</b> O <b>DIU de cobre</b> apresenta taxa de falha < 0,1%, superando o <b>levonorgestrel oral</b> em eficácia.',
  };
  assert.equal(
    lintCard(diuParenSpoiler).warnings.some((w) => w.code === 'QUESTION_PAREN_SPOILER'),
    true
  );

  // 'DIPA - USG' should NOT flag TOPIC_SPOILER when answer is the ultrasound finding ('Sinal da roda dentada.')
  const dipaUsgClean: CanonicalCard = {
    id: 171000704,
    type: 'basic',
    topic: 'DIPA - USG',
    question: 'Na propedêutica pélvica de mulher com salpingite aguda, qual achado confirma o diagnóstico à ultrassonografia?',
    answer: 'Sinal da roda dentada.',
    hint: '<b>Comentário:</b> O <b>sinal da roda dentada</b> traduz pregas tubárias espessadas na fase aguda, diferente das <b>contas de rosário</b> na fase crônica.',
  };
  assert.equal(
    lintCard(dipaUsgClean).warnings.some((w) => w.code === 'TOPIC_SPOILER'),
    false
  );
});

test('surgicalRepairCardLocal preserves semantic Matuschak/Nielsen violations for /repair-cards instead of silently truncating them', () => {
  const unfocusedCard: CanonicalCard = {
    id: 171000801,
    type: 'basic',
    topic: 'Infectologia - Meningite',
    question: 'Quais são os 5 principais agentes etiológicos da meningite bacteriana em adultos e idosos?',
    answer: 'Pneumococo, meningococo, Haemophilus, Listeria e bacilos Gram-negativos.',
    hint: '<b>Comentário:</b> A cobertura empírica com <b>ceftriaxona associada à ampicilina</b> abrange idosos e gestantes sob risco de <b>Listeria monocytogenes</b>.',
  };
  const repairedUnfocused = surgicalRepairCardLocal(unfocusedCard);
  assert.equal(
    lintCard(repairedUnfocused).warnings.some((w) => w.code === 'MATUSCHAK_UNFOCUSED_SET'),
    true
  );

  const binaryCard: CanonicalCard = {
    id: 171000802,
    type: 'basic',
    topic: 'Cardiologia - Endocardite',
    question: 'É verdadeiro ou falso que a profilaxia de endocardite é indicada antes de toda endoscopia digestiva?',
    answer: 'Falso.',
    hint: '<b>Comentário:</b> A <b>profilaxia antibiótica</b> restringe-se a procedimentos odontológicos invasivos em cardiopatias de alto risco, não em <b>endoscopias de rotina</b>.',
  };
  const repairedBinary = surgicalRepairCardLocal(binaryCard);
  assert.equal(
    lintCard(repairedBinary).warnings.some((w) => w.code === 'NIELSEN_PASSIVE_OR_BINARY'),
    true
  );

  const semicolonAndLongCard: CanonicalCard = {
    id: 171000803,
    type: 'basic',
    topic: 'Obstetrícia - Hemorragia Pós-Parto',
    question: 'Qual a sequência imediata completa de manejo da atonia uterina refratária à ocitocina?',
    answer:
      'Iniciar ácido tranexâmico precoce e realizar massagem bimanual; associar metilergometrina caso não haja hipertensão arterial sistêmica e preparar balão de tamponamento intrauterino.',
    hint: '<b>Comentário:</b> A <b>hora de ouro na HPP</b> exige escalonamento ágil de uterotônicos e ácido tranexâmico, diferenciando-se da <b>laceração de trajeto</b> avaliada por revisão.',
  };
  const repairedSemilong = surgicalRepairCardLocal(semicolonAndLongCard);
  const codes = lintCard(repairedSemilong).warnings.map((w) => w.code);
  assert.equal(codes.includes('ANSWER_HAS_SEMICOLON'), true);
  assert.equal(codes.includes('ANSWER_TOO_LONG'), true);
});

test('curateAndRebalanceDeck keeps distinct clinical scenarios sharing a short answer and avoids truncated Step 3 gap clozes', () => {
  const distinctScenarioCards: CanonicalCard[] = [
    {
      id: 171000901,
      type: 'basic',
      topic: 'Obstetrícia - Iminência de Eclâmpsia',
      question:
        'Gestante de 34 semanas com PA 166x110 mmHg, cefaleia occipital intensa e escotomas cintilantes. Qual a droga de escolha para neuroproteção materna?',
      answer: 'Sulfato de magnésio EV.',
      hint: '<b>Comentário:</b> Na <b>iminência de eclâmpsia</b>, o sulfato de magnésio previne convulsões maternas, superando a <b>fenitoína</b>.',
    },
    {
      id: 171000902,
      type: 'basic',
      topic: 'Obstetrícia - Neuroproteção Fetal',
      question:
        'Gestante em trabalho de parto prematuro inevitável com idade gestacional de 29 semanas. Qual fármaco reduz risco de paralisia cerebral fetal?',
      answer: 'Sulfato de magnésio EV.',
      hint: '<b>Comentário:</b> Antes de <b>32 semanas</b>, o sulfato de magnésio promove neuroproteção fetal intraparto, diferente da <b>betametasona</b> focada na maturação pulmonar.',
    },
  ];

  const meta = extractDeckMetadata(JSON.stringify(distinctScenarioCards));
  const customMap = buildGenericClinicalMap('obstetricia_urgencias', distinctScenarioCards);
  customMap.items = [
    {
      id: 'long-gap-item',
      priority: 'P1',
      subtopic: 'Manejo da Hemorragia Pós-Parto Refratária',
      concept: 'Indicação de ácido tranexâmico até três horas após o nascimento na atonia uterina grave',
      guidelineNote: 'Diretriz OMS / FEBRASGO',
      targetCardType: 'cloze',
      checked: true,
    },
  ];

  const { cards: curated, stats } = curateAndRebalanceDeck(
    distinctScenarioCards,
    meta,
    'obstetricia_urgencias',
    customMap
  );

  // Neither distinct scenario sharing "Sulfato de magnésio EV." may be pruned as duplicate
  assert.equal(curated.some((c) => c.id === 171000901), true);
  assert.equal(curated.some((c) => c.id === 171000902), true);
  assert.equal(stats.prunedCount, 0);

  // Step 3 fallback for a long concept must NOT create a truncated 4-word cloze chunk
  const addedGapCard = curated.find((c) => c.id !== 171000901 && c.id !== 171000902);
  assert.ok(addedGapCard, 'Expected a gap card to be added from customMap');
  assert.equal(addedGapCard.type, 'basic');
  assert.equal(addedGapCard.question.includes('{{c1::Indicação de ácido tranexâmico}}'), false);
});

test('convertClozeToBasic strips dangling prepositions before ___TARGET___ to yield natural interrogative prompts', () => {
  const clozeWithPrep: CanonicalCard = {
    id: 171001001,
    type: 'cloze',
    topic: 'Infectologia - Diagnóstico Laboratorial',
    question: 'A confirmação sorológica inicial da sífilis primária é feita com {{c1::teste treponêmico rápido}}.',
    answer: '',
    hint: '<b>Comentário:</b> O <b>teste rápido treponêmico</b> inicia o fluxo diagnóstico no SUS, diferente do <b>VDRL quantitativo</b> utilizado no seguimento.',
  };

  const basic = convertClozeToBasic(clozeWithPrep);
  assert.equal(basic.type, 'basic');
  assert.equal(basic.answer, 'Teste treponêmico rápido.');
  assert.equal(/\b(?:com|por|de|em|feita com)\s*\?/i.test(basic.question), false);
});

test('real wagmms/Cards compatibility: preserves accented/comma local filenames, decodes HTML medical entities, normalizes em-dash topics, and distinguishes partogram context from pericolic collection narration', () => {
  assert.equal(
    resolveLocalMediaFilename(
      '<img src="Ficha_Resumo_-_Pré-Natal_p8_fig1.png">',
      'Ficha_Resumo_-_Pré-Natal_p8_fig1.png',
      1
    ),
    'Ficha_Resumo_-_Pré-Natal_p8_fig1.png'
  );
  assert.equal(
    resolveLocalMediaFilename(
      '<img src="Ficha_Resumo_-_Arritmias,_Síncope_e_PCR_p1_img3_155.png">',
      'Ficha_Resumo_-_Arritmias,_Síncope_e_PCR_p1_img3_155.png',
      2
    ),
    'Ficha_Resumo_-_Arritmias,_Síncope_e_PCR_p1_img3_155.png'
  );

  // Medical HTML entities must decode cleanly without triggering false ANSWER_HAS_SEMICOLON
  assert.equal(stripHtml('Intervalo QRS &lt; 120 ms e PR &ge; 200 ms (&plusmn; 20 ms).'), 'Intervalo QRS < 120 ms e PR ≥ 200 ms (± 20 ms).');
  const entityCard = surgicalRepairCardLocal({
    id: 1792354533999,
    type: 'basic',
    topic: 'Manobras de Leopold — 1º Tempo',
    question: 'Qual o parâmetro eletrocardiográfico esperado na condução normal?<br><img src="Ficha_Resumo_-_Pré-Natal_p8_fig1.png">',
    answer: 'Duração do QRS &le; 120 ms.',
    hint: '<i>Ilustração do 1º tempo da manobra de Leopold-Zweifel delimitando o fundo uterino.</i><br><br><b>Comentário:</b> O intervalo normal mantém <b>QRS ≤ 120 ms</b>, diferentemente do <b>bloqueio de ramo</b>.',
  });
  assert.equal(entityCard.topic, 'Manobras de Leopold - 1º Tempo');
  assert.equal(entityCard.answer, 'Duração do QRS ≤ 120 ms.');
  const entityLint = lintCard(entityCard, ['<img src="Ficha_Resumo_-_Pré-Natal_p8_fig1.png">']);
  assert.equal(entityLint.warnings.some((w) => w.code === 'ANSWER_HAS_SEMICOLON'), false);
  assert.equal(entityLint.warnings.some((w) => w.code === 'MISSING_MEDIA'), false);

  // Partogram recognition card should NOT flag REDUNDANT_VISUAL_DESCRIPTION on generic words (partograma, contrações, eficazes)
  const partogramCard: CanonicalCard = {
    id: 1792354533126,
    type: 'basic',
    topic: 'Partograma - Distócias do Período Expulsivo',
    image_mode: 'recognition',
    question:
      'Primigesta de 30 anos, 40 semanas, encontra-se no período expulsivo com 5 contrações eficazes em 10 minutos, evoluindo conforme o partograma abaixo:<br><img src="partograma_30b_parada_sec_descida.png"><br>Qual é a distócia diagnosticada pelo gráfico?',
    answer: 'Parada secundária da descida.',
    hint: '<i>Partograma demonstrando dilatação cervical completa (10 cm) mantida por 3 horas com apresentação fetal estacionada no plano 0 de DeLee apesar de contrações eficazes.</i><br><br><b>Comentário:</b> A <b>parada secundária da descida</b> caracteriza-se por altura estacionária por ≥ 1h sob dilatação total, tendo a <b>DCP</b> como principal causa.',
  };
  assert.equal(detectRedundantVisualDescription(partogramCard).isRedundant, false);

  // Pericolic collection narration in question MUST flag REDUNDANT_VISUAL_DESCRIPTION
  const pericolicCard: CanonicalCard = {
    id: 1788993524897,
    type: 'basic',
    topic: 'Abdome Agudo Inflamatório - Diverticulite Complicada',
    image_mode: 'recognition',
    question:
      'Paciente de 64 anos com dor em FIE e febre. A TC de abdome abaixo mostra coleção pericólica de 5,0 cm:<br><img src="tc_diverticulite.png"><br>Qual a conduta imediata?',
    answer: 'Drenagem percutânea guiada por TC e antibioticoterapia.',
    hint: '<i>TC de abdome demonstrando coleção pericólica de 5,0 cm.</i><br><br><b>Comentário:</b> No estágio <b>Hinchey Ib/II com abscesso ≥ 4 cm</b>, indica-se drenagem percutânea.',
  };
  assert.equal(detectRedundantVisualDescription(pericolicCard).isRedundant, true);
});

test('removeMissingMediaFromCard strips adjacent <br> and stranded leading <i> legends across recognition, feedback, and unset image_mode', () => {
  const recognitionMissing: CanonicalCard = {
    id: 171002001,
    type: 'basic',
    image_mode: 'recognition',
    topic: 'Obstetrícia - Partograma',
    question: 'Analise o gráfico:<br><img src="parto_ausente.png"><br>Qual o diagnóstico?',
    answer: 'Parada secundária da dilatação.',
    hint: '<i>Partograma demonstrando dilatação fixa em 6 cm há 3 horas.</i><br><br><b>Comentário:</b> A <b>parada secundária da dilatação</b> decorre de desproporção cefalopélvica, diferente da <b>fase ativa prolongada</b>.',
  };
  const cleanedRec = removeMissingMediaFromCard(recognitionMissing, []);
  assert.equal(/<img/i.test(cleanedRec.question), false);
  assert.equal(/<br>\s*<br>/i.test(cleanedRec.question), false);
  assert.equal(cleanedRec.question.includes('Analise o gráfico:<br>Qual o diagnóstico?'), true);
  assert.equal(cleanedRec.image_mode, undefined);
  assert.equal(cleanedRec.hint.startsWith('<b>Comentário:</b>'), true);
  assert.equal(/<i>/i.test(cleanedRec.hint), false);

  const feedbackMissing: CanonicalCard = {
    id: 171002002,
    type: 'cloze',
    image_mode: 'feedback',
    topic: 'Obstetrícia - Palpação',
    question: 'O 1º tempo de Leopold identifica a {{c1::situação}} fetal.',
    answer: '',
    hint: '<img src="leopold_ausente.png"><br><i>Ilustração do 1º tempo palpando fundo uterino.</i><br><br><b>Comentário:</b> Identifica o polo no <b>fundo uterino</b>, diferenciando da <b>altura de apresentação</b>.',
  };
  const cleanedFb = removeMissingMediaFromCard(feedbackMissing, []);
  assert.equal(/<img/i.test(cleanedFb.hint), false);
  assert.equal(cleanedFb.image_mode, undefined);
  assert.equal(cleanedFb.hint.startsWith('<b>Comentário:</b>'), true);

  const unsetModeMissing: CanonicalCard = {
    id: 171002003,
    type: 'basic',
    topic: 'Obstetrícia - Palpação',
    question: 'Qual tempo avalia o dorso fetal?<br><img src="unset_ausente.png">',
    answer: 'Segundo tempo de Leopold.',
    hint: '<i>Esquema mostrando palpação lateral dos flancos.</i><br><br><b>Comentário:</b> O <b>2º tempo</b> localiza o dorso fetal, diferente do <b>3º tempo</b> que avalia mobilidade.',
  };
  const cleanedUnset = removeMissingMediaFromCard(unsetModeMissing, []);
  assert.equal(cleanedUnset.question.endsWith('<br>'), false);
  assert.equal(cleanedUnset.image_mode, undefined);
  assert.equal(cleanedUnset.hint.startsWith('<b>Comentário:</b>'), true);
});

test('reconcileDeckIdsAndMedia preserves exam_refs, last_synced_hash, and priority across deck regeneration', () => {
  const originalCards: CanonicalCard[] = [
    {
      id: 1792354533078,
      type: 'basic',
      priority: 'P1',
      topic: 'Obstetrícia - Vitalidade Intraparto',
      question: 'Com que frequência realizar ausculta fetal na fase ativa em baixo risco?',
      answer: 'A cada 30 minutos.',
      hint: '<b>Comentário:</b> Na <b>fase ativa de baixo risco</b> ausculta-se a cada 30 min, diferente do <b>expulsivo</b> (15 min).',
      exam_refs: [{ institution: 'USP-SP', year: 2025, question_id: 4012, source: 'medquest' }],
      last_synced_hash: 'sha256_orig_abc123',
      tags: ['assistencia_parto'],
    },
  ];
  const meta = extractDeckMetadata(JSON.stringify(originalCards));
  const regeneratedFromLlm: CanonicalCard[] = [
    {
      id: 1792354533078,
      type: 'cloze',
      topic: '1º Período do Parto - Ausculta Intermitente',
      question: 'Na fase ativa de parto em gestante de risco habitual, a FCF é auscultada a cada {{c1::30 minutos}}.',
      answer: '',
      hint: '<b>Comentário:</b> No <b>baixo risco</b>, monitora-se a cada 30 min na dilatação e 15 min no expulsivo, contra 15/5 min no <b>alto risco</b>.',
      tags: ['obstetricia'],
    },
  ];
  const reconciled = reconcileDeckIdsAndMedia(regeneratedFromLlm, meta, 'assistencia_parto');
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].id, 1792354533078);
  assert.equal(reconciled[0].priority, 'P1');
  assert.equal(reconciled[0].last_synced_hash, 'sha256_orig_abc123');
  assert.deepEqual(reconciled[0].exam_refs, [
    { institution: 'USP-SP', year: 2025, question_id: 4012, source: 'medquest' },
  ]);
});

test('buildDeckMediaResolution, formatCanonicalDeckJson, and extractDeckMediaManifest disambiguate colliding image filenames consistently', () => {
  const cards: CanonicalCard[] = [
    {
      id: 10,
      type: 'basic',
      image_mode: 'recognition',
      topic: 'Cardiologia - ECG',
      question: 'Analise:<br><img src="https://cdn-a.example.org/ecg.png" data-anki-file="ecg_shared.png">',
      answer: 'Bloqueio de ramo direito.',
      hint: '<i>Traçado A demonstrando padrão típico em V1.</i><br><br><b>Comentário:</b> Achado clássico de <b>BRD</b>, distinto do <b>BRE</b>.',
    },
    {
      id: 20,
      type: 'basic',
      image_mode: 'recognition',
      topic: 'Cardiologia - Arritmias',
      question: 'Analise:<br><img src="https://cdn-b.example.org/ecg.png" data-anki-file="ecg_shared.png">',
      answer: 'Fibrilação atrial.',
      hint: '<i>Traçado B demonstrando ritmo irregularmente irregular.</i><br><br><b>Comentário:</b> Ausência de <b>ondas P</b> diferencia FA do <b>flutter atrial</b>.',
    },
    {
      id: 30,
      type: 'basic',
      image_mode: 'feedback',
      topic: 'Cardiologia - Condução',
      question: 'Qual a morfologia esperada em V1 no BRD?',
      answer: 'Complexo rSR em V1.',
      hint: '<img src="https://cdn-a.example.org/ecg.png" data-anki-file="ecg_shared.png"><br><i>Traçado A demonstrando padrão típico em V1.</i><br><br><b>Comentário:</b> O <b>atraso ventricular direito</b> gera onda R prime terminal em V1, diferente do <b>BRE</b> em V6.',
    },
  ];

  const resolution = buildDeckMediaResolution(cards, 'cardio_ecg');
  const manifest = extractDeckMediaManifest(cards, 'cardio_ecg');
  const exported = JSON.parse(formatCanonicalDeckJson(cards, null, 'cardio_ecg')) as Array<{
    id: number;
    question: string;
    hint: string;
  }>;

  assert.equal(manifest.length, 2);
  assert.equal(resolution.manifest.length, 2);
  assert.equal(manifest[0].filename, 'ecg_shared.png');
  assert.equal(manifest[1].filename, 'ecg_shared_20.png');
  assert.ok(exported[0].question.includes('<img src="ecg_shared.png">'));
  assert.ok(exported[1].question.includes('<img src="ecg_shared_20.png">'));
  assert.ok(exported[2].hint.includes('<img src="ecg_shared.png">'));
});

test('sanitizeMedicalHtml strips XSS vectors, resolves localMediaAssets case-insensitively, preserves table spans, and renders Cloze modes', () => {
  const dirty =
    'Texto<script>alert(1)</script><img src="javascript:alert(2)" onerror="hack()" /><svg><circle /></svg>' +
    '<img src="04_Midias/Parto/LEOPOLD_1.PNG" onerror="xss()" alt="Leopold" />' +
    '<table class="evil"><thead><tr><th colspan="2" onclick="x()">Critérios</th></tr></thead>' +
    '<tbody><tr><td rowspan="2" onmouseover="y()">Fase Ativa</td><td>6 cm</td></tr></tbody></table>';

  const safeHtml = sanitizeMedicalHtml(dirty, {
    localMediaAssets: { 'leopold_1.png': 'data:image/png;base64,LEOPOLD_IMG' },
  });

  assert.equal(/<script|onerror=|onclick=|onmouseover=|javascript:|<svg/i.test(safeHtml), false);
  assert.equal(safeHtml.includes('src="data:image/png;base64,LEOPOLD_IMG"'), true);
  assert.equal(safeHtml.includes('<table class="med-table">'), true);
  assert.equal(safeHtml.includes('<th colspan="2">'), true);
  assert.equal(safeHtml.includes('<td rowspan="2">'), true);

  const clozeRaw = 'Limiar é {{c1::140 mmHg}} ou {{c2::90 mmHg::pressão diastólica}}.';
  const front = sanitizeMedicalHtml(clozeRaw, { highlightCloze: true, clozeMode: 'front' });
  const back = sanitizeMedicalHtml(clozeRaw, { highlightCloze: true, clozeMode: 'back' });
  const inline = sanitizeMedicalHtml(clozeRaw, { highlightCloze: true, clozeMode: 'inline' });

  assert.equal(front.includes('[...]'), true);
  assert.equal(front.includes('[...pressão diastólica...]'), true);
  assert.equal(front.includes('140 mmHg'), false);
  assert.equal(back.includes('140 mmHg') && back.includes('90 mmHg') && back.includes('text-emerald-300'), true);
  assert.equal(inline.includes('140 mmHg') && inline.includes('bg-sky-500/15'), true);
});

test('pdfImageCore filters 3+ page watermarks before caption assignment, activates clinical page_crop fallback, and avoids broken leading commas', () => {
  const watermarkSig = 'wm_instituicao_1080x1920';

  const p1Text =
    'Assistência ao Parto. Fig. 1: Manobra de McRoberts aplicada na distócia de ombros após falha de tração leve.';
  const p2Text =
    'Protocolo clínico institucional com diagrama vetorial sem XObjects próprios: Fig. 2 — Fluxograma de HPP.';
  const p3Text = 'Observações gerais de enfermagem sem figuras relevantes.';

  assert.equal(hasClinicalFigurePageKeyword('Veja a Fig. 1 ao lado'), true);
  assert.equal(hasClinicalFigurePageKeyword('Fluxograma sem termo clinico'), true);
  assert.equal(hasClinicalFigurePageKeyword('Apenas texto administrativo'), false);

  const pageBuffers: RawPdfPageBuffer[] = [
    {
      pageNumber: 1,
      pageText: p1Text,
      captionMatches: collectPageCaptionMatches(p1Text),
      candidates: [
        {
          id: 'p1_wm',
          pdfName: 'parto.pdf',
          pageNumber: 1,
          width: 1080,
          height: 1920,
          dataUrl: 'data:image/jpeg;base64,WM',
          captionHint: '',
          pageTextSnippet: '',
          suggestedFilename: 'p1_wm.jpg',
          kind: 'embedded',
          signature: watermarkSig,
          byteLengthHint: 4000,
        },
        {
          id: 'p1_real_fig1',
          pdfName: 'parto.pdf',
          pageNumber: 1,
          width: 800,
          height: 433,
          dataUrl: 'data:image/jpeg;base64,FIG1',
          captionHint: '',
          pageTextSnippet: '',
          suggestedFilename: 'p1_fig1.jpg',
          kind: 'embedded',
          signature: 'real_mcroberts_800x433',
          byteLengthHint: 25000,
        },
      ],
    },
    {
      pageNumber: 2,
      pageText: p2Text,
      captionMatches: collectPageCaptionMatches(p2Text),
      candidates: [
        {
          id: 'p2_wm',
          pdfName: 'parto.pdf',
          pageNumber: 2,
          width: 1080,
          height: 1920,
          dataUrl: 'data:image/jpeg;base64,WM',
          captionHint: '',
          pageTextSnippet: '',
          suggestedFilename: 'p2_wm.jpg',
          kind: 'embedded',
          signature: watermarkSig,
          byteLengthHint: 4000,
        },
      ],
      fallbackCropCandidate: {
        id: 'p2_vector_crop',
        pdfName: 'parto.pdf',
        pageNumber: 2,
        width: 900,
        height: 1200,
        dataUrl: 'data:image/jpeg;base64,CROP2',
        captionHint: '',
        pageTextSnippet: p2Text,
        suggestedFilename: 'p2_crop.jpg',
        kind: 'page_crop',
        signature: 'page_2_crop',
        byteLengthHint: 35000,
      },
    },
    {
      pageNumber: 3,
      pageText: p3Text,
      captionMatches: [],
      candidates: [
        {
          id: 'p3_wm',
          pdfName: 'parto.pdf',
          pageNumber: 3,
          width: 1080,
          height: 1920,
          dataUrl: 'data:image/jpeg;base64,WM',
          captionHint: '',
          pageTextSnippet: '',
          suggestedFilename: 'p3_wm.jpg',
          kind: 'embedded',
          signature: watermarkSig,
          byteLengthHint: 4000,
        },
      ],
    },
  ];

  const extracted = assignCaptionsAndFilterWatermarks(pageBuffers, 45);
  assert.equal(extracted.length, 2);
  assert.equal(extracted[0].id, 'p1_real_fig1');
  assert.equal(extracted[0].captionHint?.includes('Fig. 1'), true);
  assert.equal(extracted[1].id, 'p2_vector_crop');
  assert.equal(extracted[1].kind, 'page_crop');

  // Construct exact 2000-char string so for idx=1 of 2 (ratio=0.75 -> center=1500 -> start=1000),
  // index 1000 lands inside 'hospitalar, ' before ', tendo contração adequada...'
  const prefixPad = 'ab '.repeat(332); // 996 chars
  const targetSegment = 'hospitalar, tendo contração adequada e boa vitalidade fetal no trabalho de parto.';
  const suffixPad = ' cd'.repeat(309); // total length >= 2000 -> trim to exact 2000
  const exactText = (prefixPad + targetSegment + suffixPad).slice(0, 2000);
  const midCtx = extractContextForFigure(exactText, [], 1, 2);
  assert.equal(
    /^[,;:.–\-\s)]/.test(midCtx.captionHint),
    false,
    `Expected leading comma/punctuation stripped, got: "${midCtx.captionHint}"`
  );
  assert.equal(midCtx.captionHint.startsWith('tendo contração adequada'), true);
});

test('pdfImageCore activates fallbackCropCandidate for dense pages (up to 6500 chars) with vector diagrams and formatCanonicalDeckJson strips UI audit metadata', () => {
  const denseVectorText =
    'Partograma e evolução clínica no trabalho de parto ativo. '.repeat(75) +
    'Fluxograma de parada secundária da dilatação e descida.';
  assert.equal(denseVectorText.length > 2600 && denseVectorText.length < 6500, true);

  const pageBuffers: RawPdfPageBuffer[] = [
    {
      pageNumber: 5,
      pageText: denseVectorText,
      captionMatches: collectPageCaptionMatches(denseVectorText),
      hasVectorDiagramOps: true,
      candidates: [
        {
          id: 'p5_small_icon',
          pdfName: 'parto.pdf',
          pageNumber: 5,
          width: 400,
          height: 300,
          dataUrl: 'data:image/jpeg;base64,ICON',
          captionHint: '',
          pageTextSnippet: '',
          suggestedFilename: 'p5_icon.jpg',
          kind: 'embedded',
          signature: 'unique_icon_400x300',
          byteLengthHint: 8000,
        },
      ],
      fallbackCropCandidate: {
        id: 'p5_vector_flowchart',
        pdfName: 'parto.pdf',
        pageNumber: 5,
        width: 1000,
        height: 1400,
        dataUrl: 'data:image/jpeg;base64,FLOWCHART',
        captionHint: '',
        pageTextSnippet: denseVectorText.slice(0, 200),
        suggestedFilename: 'p5_flow.jpg',
        kind: 'page_crop',
        signature: 'page_5_crop',
        byteLengthHint: 42000,
      },
    },
  ];

  const extracted = assignCaptionsAndFilterWatermarks(pageBuffers, 300);
  assert.equal(extracted.some((img) => img.id === 'p5_vector_flowchart'), true);

  const cardWithUiMeta: CanonicalCard = {
    id: 171000901,
    type: 'basic',
    topic: 'Obstetrícia - Trabalho de Parto',
    question: 'Qual a linha do partograma indica necessidade de intervenção ativa após 4 horas da linha de alerta?',
    answer: 'Linha de ação.',
    hint: '<b>Comentário:</b> A <b>linha de ação</b> fica 4 horas à direita da linha de alerta, indicando avaliação imediata da progressão.',
    priority: 'P1',
    auditVerdict: 'rebuild',
    auditReason: 'Card antigo tinha enunciado vago.',
    auditScore: 4,
    auditTargetConcept: 'Critério de linha de ação no partograma',
    auditSuggestedType: 'basic',
    needsManualImage: true,
    imageVerified: false,
  };

  const jsonStr = formatCanonicalDeckJson(
    [cardWithUiMeta],
    {
      existingIds: [171000901],
      mediaTags: [],
      detectedDeckKey: 'assistencia_parto',
      rawCards: [],
    },
    'assistencia_parto'
  );
  const parsed = JSON.parse(jsonStr) as Array<Record<string, unknown>>;
  const note = parsed[0];
  assert.equal('auditVerdict' in note, false);
  assert.equal('auditReason' in note, false);
  assert.equal('auditScore' in note, false);
  assert.equal('auditTargetConcept' in note, false);
  assert.equal('auditSuggestedType' in note, false);
  assert.equal('needsManualImage' in note, false);
  assert.equal('priority' in note, false);
  assert.equal('sources' in note, false);
  assert.equal(note.id, 171000901);
});

test('detects ORPHAN_VISUAL_REFERENCE, TABLE_MALFORMED, silent cloze-as-basic normalization, and preserves med-table in surgicalRepairCardLocal', () => {
  const orphanVisualCard: CanonicalCard = {
    id: 171009901,
    type: 'basic',
    topic: 'Cardiologia - Taquiarritmias',
    question: 'Analise o ECG abaixo em paciente estável. Qual a arritmia demonstrada?',
    answer: 'Flutter atrial típico.',
    hint: '<b>Comentário:</b> Ondas F em <b>dente de serra</b> em DII, DIII e aVF diferenciam flutter de <b>taquicardia sinusal</b>.',
  };
  const orphanLint = lintCard(orphanVisualCard);
  assert.equal(
    orphanLint.warnings.some((w) => w.code === 'ORPHAN_VISUAL_REFERENCE' && w.severity === 'error'),
    true
  );

  // removeMissingMediaFromCard must clean orphaned visual deixis so no ORPHAN_VISUAL_REFERENCE remains
  const missingImgCard: CanonicalCard = {
    id: 171009902,
    type: 'basic',
    image_mode: 'recognition',
    topic: 'Cardiologia - ECG',
    question: 'Paciente com dor torácica realiza o exame abaixo:<br><img src="ausente_ecg.png"><br>Qual a artéria culpada mais provável?',
    answer: 'Artéria descendente anterior.',
    hint: '<i>Traçado de 12 derivações evidenciando supradesnivelamento de ST em V1 a V4.</i><br><br><b>Comentário:</b> O <b>supradesnivelamento em V1-V4</b> localiza lesão anterior, diferente da <b>parede inferior</b> (DII, DIII e aVF).',
  };
  const cleanedMissing = removeMissingMediaFromCard(missingImgCard, []);
  const cleanedLint = lintCard(cleanedMissing);
  assert.equal(
    cleanedLint.warnings.some((w) => w.code === 'ORPHAN_VISUAL_REFERENCE'),
    false,
    `Unexpected ORPHAN_VISUAL_REFERENCE after cleanup: ${cleanedMissing.question}`
  );

  // Malformed unclosed table triggers TABLE_MALFORMED error
  const brokenTableCard: CanonicalCard = {
    id: 171009903,
    type: 'basic',
    topic: 'Cardiologia - IAMCSST',
    question: 'Na suspeita de IAM inferior em DII, DIII e aVF, quais derivações adicionais solicitar imediatamente?',
    answer: 'V3R, V4R, V7, V8 e V9.',
    hint: '<b>Comentário:</b> O registro de <b>derivações direitas e posteriores</b> identifica extensão para VD e parede posterior.<br><table class="med-table"><thead><tr><th>Parede</th><th>Derivações</th></tr></thead><tbody><tr><td>Inferior</td><td>DII, DIII, aVF',
  };
  assert.equal(
    lintCard(brokenTableCard).warnings.some((w) => w.code === 'TABLE_MALFORMED' && w.severity === 'error'),
    true
  );

  // Valid table + long text preserved cleanly by surgicalRepairCardLocal without cutting mid-table
  const validTableCard: CanonicalCard = {
    id: 171009904,
    type: 'basic',
    topic: 'Cardiologia - IAMCSST',
    question: 'Na suspeita de IAM inferior em DII, DIII e aVF, quais derivações adicionais solicitar imediatamente?',
    answer: 'V3R, V4R, V7, V8 e V9.',
    hint: '<b>Comentário:</b> As <b>derivações direitas (V3R-V4R)</b> rastreiam infarto de ventrículo direito, enquanto <b>V7-V9</b> avaliam parede dorsal.<br><table class="med-table"><thead><tr><th>Parede</th><th>Derivações</th><th>Artéria</th></tr></thead><tbody><tr><td>Anterior</td><td>V1-V4</td><td>Descendente anterior</td></tr><tr><td>Inferior</td><td>DII, DIII, aVF</td><td>Coronária direita</td></tr></tbody></table>',
  };
  const repairedTable = surgicalRepairCardLocal(validTableCard);
  assert.equal(repairedTable.hint.includes('</table>'), true);
  assert.equal(
    lintCard(repairedTable).warnings.some((w) => w.code === 'TABLE_MALFORMED'),
    false
  );

  // Silent cloze stored as basic with empty answer auto-normalizes to cloze
  const silentClozeAsBasic: CanonicalCard = {
    id: 171009905,
    type: 'basic',
    topic: 'Cardiologia - Brugada',
    question: 'A síndrome de Brugada tipo 1 apresenta padrão côncavo/convexo em {{c1::V1 e V2}}.',
    answer: '',
    hint: '<b>Comentário:</b> O <b>padrão tipo 1 em V1-V2</b> confere maior risco arrítmico, diferente do <b>padrão tipo 2</b> em sela.',
  };
  const repairedSilent = surgicalRepairCardLocal(silentClozeAsBasic);
  assert.equal(repairedSilent.type, 'cloze');

  // Broadened COMPOUND_QUESTION and VAGUE_TEMPORAL_WINDOW checks
  const disguisedCompound: CanonicalCard = {
    id: 171009906,
    type: 'basic',
    topic: 'Cardiologia - Emergência',
    question: 'Paciente com taquicardia regular de QRS estreito em PS. Qual o diagnóstico provável e o antiarrítmico de escolha?',
    answer: 'Taquicardia supraventricular e adenosina.',
    hint: '<b>Comentário:</b> A <b>adenosina em bolus rápido</b> interrompe reentrada nodal, diferente do <b>choque sincronizado</b> na instabilidade.',
  };
  assert.equal(
    lintCard(disguisedCompound).warnings.some((w) => w.code === 'COMPOUND_QUESTION'),
    true
  );

  const vagueManejo: CanonicalCard = {
    id: 171009907,
    type: 'basic',
    topic: 'Cardiologia - Emergência',
    question: 'Paciente com dor torácica e infradesnivelamento difuso de ST. Qual é o manejo?',
    answer: 'Estratificação invasiva precoce.',
    hint: '<b>Comentário:</b> A <b>estratificação de risco TIMI/GRACE</b> orienta o momento do cateterismo, diferente do <b>IAMCSST</b> imediato.',
  };
  assert.equal(
    lintCard(vagueManejo).warnings.some((w) => w.code === 'VAGUE_TEMPORAL_WINDOW'),
    true
  );
});





