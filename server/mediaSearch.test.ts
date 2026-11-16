import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEnglishMedicalSearchQueries,
  isSpamOrLogoImageUrl,
  isSvgImageUrl,
  normalizeImageCanonicalKey,
  scoreImageRelevance,
} from './mediaSearch';
import { sanitizeDeckKey } from '../src/utils/apiClient';
import {
  buildPdfImagesCatalog,
  extractMarkdownTextImages,
  extractUsedImageKeysFromCards,
  hasLocalModalityConflict,
  matchMaterialImagesForCard,
  mergeMaterialAndWebImages,
} from '../src/utils/materialImageMatcher';
import {
  applyResolvedWebImageToCard,
  attachVisualSuggestionToCard,
  extractUnresolvedLocalImages,
} from '../src/utils/wozniakLinter';
import type { CanonicalCard, PdfExtractedImage, UploadedPdfFile } from '../src/types/deck';

test('isSpamOrLogoImageUrl filters logos, icons, portraits, and non-image extensions', () => {
  assert.equal(isSpamOrLogoImageUrl('https://example.com/site-logo.png'), true);
  assert.equal(isSpamOrLogoImageUrl('https://upload.wikimedia.org/commons/flag_of_brazil.svg'), true);
  assert.equal(isSpamOrLogoImageUrl('https://upload.wikimedia.org/commons/Willem_Einthoven_portrait.jpg'), true);
  assert.equal(isSpamOrLogoImageUrl('https://example.com/scan.pdf'), true);
  assert.equal(
    isSpamOrLogoImageUrl('https://litfl.com/wp-content/uploads/2020/01/anterior-stemi-ecg.jpg', 'Anterior STEMI ECG'),
    false
  );
});

test('normalizeImageCanonicalKey collapses Wikimedia thumbnails of different sizes and full image to same key', () => {
  const thumb800 =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tension_pneumothorax.jpg/800px-Tension_pneumothorax.jpg';
  const thumb900 =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tension_pneumothorax.jpg/900px-Tension_pneumothorax.jpg';
  const original =
    'https://upload.wikimedia.org/wikipedia/commons/a/ab/Tension_pneumothorax.jpg';

  const key800 = normalizeImageCanonicalKey(thumb800);
  const key900 = normalizeImageCanonicalKey(thumb900);
  const keyOrig = normalizeImageCanonicalKey(original);

  assert.equal(key800, 'wikimedia:tension_pneumothorax.jpg');
  assert.equal(key900, key800);
  assert.equal(keyOrig, key800);
});

test('buildEnglishMedicalSearchQueries maps PT-BR clinical pathology & modality to targeted English queries', () => {
  const ecgQueries = buildEnglishMedicalSearchQueries('Supra de ST em parede anterior', 'IAMCSST', '');
  assert.ok(ecgQueries.some((q) => /myocardial infarction.*ECG/i.test(q)));

  const rxQueries = buildEnglishMedicalSearchQueries('Pneumotórax hipertensivo', 'Trauma torácico', '');
  assert.ok(rxQueries.some((q) => /pneumothorax.*chest x-ray/i.test(q)));
});

test('scoreImageRelevance ranks matching clinical raster modality above mismatch, biography, or schematic SVG', () => {
  const ecgRaster = {
    title: 'Anterior STEMI 12-lead ECG',
    description: 'LITFL electrocardiogram showing ST elevation in V1-V4',
    source: 'litfl.com (via Google Search)',
    thumbUrl: 'https://litfl.com/ecg/anterior_stemi.jpg',
    fullUrl: 'https://litfl.com/ecg/anterior_stemi.jpg',
    isSvg: false,
  };

  const schematicSvg = {
    title: 'Heart diagram schematic',
    description: 'Cartoon vector diagram of coronary artery',
    source: 'Wikimedia Commons Medical',
    thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/heart_diagram.svg',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/heart_diagram.svg',
    isSvg: true,
  };

  const biographyPhoto = {
    title: 'Physician portrait Nobel biography',
    description: 'Scientist portrait in hospital university campus',
    source: 'Wikipedia Medical (EN)',
    thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/doctor_portrait.jpg',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/doctor_portrait.jpg',
    isSvg: false,
  };

  const ctx = {
    query: 'ECG supra de ST IAMCSST',
    topic: 'Cardiologia - ECG',
    question: 'Qual o achado eletrocardiográfico esperado?',
    answer: 'Supradesnivelamento de ST anterior.',
    enQueries: ['ST elevation myocardial infarction ECG LITFL'],
  };

  const ecgScore = scoreImageRelevance(ecgRaster, ctx);
  const svgScore = scoreImageRelevance(schematicSvg, ctx);
  const bioScore = scoreImageRelevance(biographyPhoto, ctx);
  assert.ok(ecgScore > svgScore + 40, `Expected ECG raster (${ecgScore}) >> SVG (${svgScore})`);
  assert.ok(bioScore < 0, `Expected biography portrait score (${bioScore}) < 0`);
});

test('sanitizeDeckKey normalizes accents, spaces, and punctuation deterministically', () => {
  assert.equal(sanitizeDeckKey('Abdome Agudo Perfuração! '), 'abdome_agudo_perfuracao');
  assert.equal(sanitizeDeckKey('  '), 'internato_deck');
});

test('matchMaterialImagesForCard matches extracted PDF images by exact ID or clinical context and merges with web results', () => {
  const matImages: PdfExtractedImage[] = [
    {
      id: 'pdfimg_aula_p4_1',
      pdfName: 'aula_ecg.pdf',
      pageNumber: 4,
      width: 640,
      height: 360,
      dataUrl: 'data:image/jpeg;base64,AAA',
      pageTextSnippet: 'Bloqueio de ramo direito com morfologia rSR em V1 e onda S empastada em V6',
      captionHint: 'Traçado de ECG típico de BRD em V1',
      suggestedFilename: 'aula_ecg_p4_fig1.jpg',
      kind: 'embedded',
    },
    {
      id: 'pdfimg_aula_p9_1',
      pdfName: 'aula_ecg.pdf',
      pageNumber: 9,
      width: 640,
      height: 360,
      dataUrl: 'data:image/jpeg;base64,BBB',
      pageTextSnippet: 'Pneumotórax hipertensivo com desvio do mediastino na radiografia de tórax',
      suggestedFilename: 'aula_ecg_p9_fig1.jpg',
      kind: 'page_crop',
    },
  ];

  const byId = matchMaterialImagesForCard(matImages, {
    query: 'ECG',
    preferredPdfImageId: 'pdfimg_aula_p9_1',
  });
  assert.equal(byId[0]?.id, 'mat-pdfimg_aula_p9_1');
  assert.equal(byId[0]?.fromMaterial, true);

  const byContext = matchMaterialImagesForCard(matImages, {
    topic: 'Cardiologia - Distúrbios de Condução',
    question: 'Qual o achado no ECG com rSR em V1?',
    answer: 'Bloqueio de ramo direito.',
  });
  assert.equal(byContext[0]?.id, 'mat-pdfimg_aula_p4_1');
  assert.ok((byContext[0]?.materialScore ?? 0) >= 26);

  const merged = mergeMaterialAndWebImages(
    byContext,
    [
      {
        id: 'web-1',
        title: 'RBBB ECG LITFL',
        thumbUrl: 'https://litfl.com/rbbb.jpg',
        fullUrl: 'https://litfl.com/rbbb.jpg',
        description: 'Right bundle branch block ECG',
        suggestedFilename: 'rbbb.jpg',
        defaultLegend: 'ECG demonstrando BRD.',
        source: 'litfl.com',
      },
    ],
    6
  );
  assert.equal(merged[0]?.fromMaterial, true);
  assert.equal(merged.some((m) => m.id === 'web-1'), true);
});

test('extractMarkdownTextImages and buildPdfImagesCatalog index uploaded material references', () => {
  const md = `
# Cardiologia
![ECG Brugada](https://example.org/brugada_ecg.png)
Texto clínico sobre síndrome de Brugada tipo 1 em V1-V2.
  `;
  const imgs = extractMarkdownTextImages(md, 'resumo_brugada.md');
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].captionHint, 'ECG Brugada');

  const pdf: UploadedPdfFile = {
    name: 'resumo_brugada.md',
    size: md.length,
    mimeType: 'text/markdown',
    base64Data: '',
    textContent: md,
    extractedImages: imgs,
  };
  const catalog = buildPdfImagesCatalog([pdf]);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].pdfName, 'resumo_brugada.md');
});

test('extractUnresolvedLocalImages parses pdfimg: and buscar_imagem: placeholders and attachVisualSuggestionToCard embeds cleanly', () => {
  const cardPdf: CanonicalCard = {
    id: 101,
    type: 'basic',
    deck_key: 'cardio',
    topic: 'Cardiologia - Condução',
    question: 'Analise o traçado abaixo:<br><img src="pdfimg:pdfimg_aula_p4_1">',
    answer: 'Bloqueio de ramo direito.',
    hint: '<b>Comentário:</b> Morfologia rSR\' em V1.',
  };
  const unresolvedPdf = extractUnresolvedLocalImages(cardPdf);
  assert.equal(unresolvedPdf.length, 1);
  assert.equal(unresolvedPdf[0].pdfImageId, 'pdfimg_aula_p4_1');

  const cardWeb: CanonicalCard = {
    id: 102,
    type: 'basic',
    deck_key: 'trauma',
    topic: 'Cirurgia - Tórax',
    question: 'Qual o achado no exame?<br><img src="buscar_imagem: pneumotorax hipertensivo radiografia">',
    answer: 'Pneumotórax hipertensivo.',
    hint: '<b>Comentário:</b> Hipertransparência sem trama vascular.',
  };
  const unresolvedWeb = extractUnresolvedLocalImages(cardWeb);
  assert.equal(unresolvedWeb.length, 1);
  assert.equal(unresolvedWeb[0].searchQuery, 'pneumotorax hipertensivo radiografia');

  const baseCard: CanonicalCard = {
    id: 103,
    type: 'basic',
    deck_key: 'cardio',
    topic: 'Cardiologia - Isquemia',
    question: 'Qual a alteração esperada na parede anterior?',
    answer: 'Supradesnivelamento de ST em V1-V4.',
    hint: '<b>Comentário:</b> Oclusão da descendente anterior exige reperfusão imediata.',
  };
  const attached = attachVisualSuggestionToCard(
    baseCard,
    {
      id: 'mat-1',
      title: 'IAM Anterior',
      thumbUrl: 'data:image/jpeg;base64,XYZ',
      fullUrl: 'data:image/jpeg;base64,XYZ',
      description: 'ECG IAM anterior',
      suggestedFilename: 'iam_anterior.jpg',
      defaultLegend: 'ECG mostrando supra de ST em V1-V4.',
      source: 'Material PDF (Pág. 2)',
      fromMaterial: true,
    },
    'Traçado de 12 derivações com supra de ST anterior.',
    'feedback',
    []
  );
  assert.equal(attached.image_mode, 'feedback');
  assert.ok(
    attached.hint.startsWith(
      '<img src="data:image/jpeg;base64,XYZ" data-anki-file="iam_anterior.jpg"><br><i>Legenda visual: Traçado de 12 derivações com supra de ST anterior.</i><br><br><b>Comentário:</b>'
    )
  );
});

test('matchMaterialImagesForCard rejects conflicting visual modalities (laparoscopy vs USG) and enforces usedImageIds uniqueness', () => {
  const mixedPdfImages: PdfExtractedImage[] = [
    {
      id: 'pdfimg_dip_p2_lap',
      pdfName: 'dip_febrasgo.pdf',
      pageNumber: 2,
      width: 640,
      height: 400,
      dataUrl: 'data:image/jpeg;base64,LAP_DATA',
      pageTextSnippet:
        'Doença inflamatória pélvica: ultrassonografia transvaginal com sinal da roda dentada e videolaparoscopia mostrando aderências pélvicas',
      captionHint: 'Figura 1: Videolaparoscopia evidenciando aderências peri-hepáticas em cordas de violino',
      suggestedFilename: 'dip_p2_lap.jpg',
      kind: 'embedded',
    },
    {
      id: 'pdfimg_dip_p2_usg',
      pdfName: 'dip_febrasgo.pdf',
      pageNumber: 2,
      width: 640,
      height: 400,
      dataUrl: 'data:image/jpeg;base64,USG_DATA',
      pageTextSnippet:
        'Ultrassonografia transvaginal em corte transversal evidenciando sinal da roda dentada na salpingite aguda',
      captionHint: 'Figura 2: USG transvaginal corte transversal com sinal da roda dentada',
      suggestedFilename: 'dip_p2_usg.jpg',
      kind: 'embedded',
    },
  ];

  assert.equal(
    hasLocalModalityConflict(
      'Qual achado na USG transvaginal na salpingite?',
      'Figura 1: Videolaparoscopia evidenciando aderências'
    ),
    true
  );
  assert.equal(
    hasLocalModalityConflict(
      'Qual achado na USG transvaginal na salpingite?',
      'Figura 2: USG transvaginal corte transversal'
    ),
    false
  );

  // Even if LLM erroneously suggests preferredPdfImageId of laparoscopy for an USG card, it must NOT attach laparoscopy
  const hitsForUsg = matchMaterialImagesForCard(mixedPdfImages, {
    topic: 'Ginecologia - DIP',
    question: 'Qual o achado típico na USG transvaginal?',
    answer: 'Sinal da roda dentada.',
    preferredPdfImageId: 'pdfimg_dip_p2_lap',
  });
  assert.equal(hitsForUsg.length, 1);
  assert.equal(hitsForUsg[0].id, 'mat-pdfimg_dip_p2_usg');

  // If USG image is already reserved/used on another card, usedImageIds prevents reusing it on a 2nd card
  const existingDeck: CanonicalCard[] = [
    {
      id: 201,
      type: 'basic',
      topic: 'Ginecologia - DIP',
      question: 'Qual achado na USG?<br><img src="data:image/jpeg;base64,USG_DATA">',
      answer: 'Sinal da roda dentada.',
      hint: '<i>Legenda visual: USG transvaginal em corte transversal.</i><br><br><b>Comentário:</b> Salpingite aguda.',
    },
  ];
  const usedKeys = extractUsedImageKeysFromCards(existingDeck, mixedPdfImages);
  const hitsCard2 = matchMaterialImagesForCard(mixedPdfImages, {
    topic: 'Ginecologia - DIP',
    question: 'Outro card pedindo USG pélvica na salpingite.',
    answer: 'Espessamento tubário ao ultrassom.',
    usedImageIds: usedKeys,
  });
  assert.equal(hitsCard2.some((h) => h.id === 'mat-pdfimg_dip_p2_usg'), false);
});

test('applyResolvedWebImageToCard enforces Legenda visual >= 6 words before Comentário in both modes', () => {
  const cardFeedback: CanonicalCard = {
    id: 301,
    type: 'cloze',
    image_mode: 'feedback',
    topic: 'Cardiologia - Emergência',
    question: 'No IAMCSST anterior, a artéria culpada mais provável é a {{c1::descendente anterior}}.',
    answer: '',
    hint: '<img src="buscar_imagem: supra ST V1-V4 ECG"><br><b>Comentário:</b> Derivação anterior reflete oclusão proximal.',
  };

  const mockImg = {
    id: 'web-ecg',
    title: 'Anterior STEMI',
    thumbUrl: 'https://litfl.com/ecg/anterior.jpg',
    fullUrl: 'https://litfl.com/ecg/anterior.jpg',
    description: 'ECG anterior STEMI',
    suggestedFilename: 'anterior_stemi.jpg',
    defaultLegend: 'Curta.',
    source: 'litfl.com',
  };

  const resolvedFeedback = applyResolvedWebImageToCard(
    cardFeedback,
    'anterior_stemi.jpg',
    mockImg,
    [mockImg],
    'Traçado de 12 derivações evidenciando supradesnivelamento do segmento ST em V1 a V4.'
  );
  assert.equal(resolvedFeedback.image_mode, 'feedback');
  assert.ok(
    resolvedFeedback.hint.startsWith(
      '<img src="https://litfl.com/ecg/anterior.jpg" data-anki-file="anterior_stemi.jpg"><br><i>Legenda visual: Traçado de 12 derivações evidenciando supradesnivelamento do segmento ST em V1 a V4.</i><br><br><b>Comentário:</b>'
    )
  );
});

test('CTG modality ignores bare fetal word while firing on cardiotocografia / DIP II / desaceleracao tardia', () => {
  const ctgCandidate = {
    title: 'Cardiotocography trace deceleration',
    description: 'CTG monitoring showing late deceleration',
    source: 'Wikimedia Commons',
    thumbUrl: 'https://upload.wikimedia.org/commons/ctg_trace.jpg',
    fullUrl: 'https://upload.wikimedia.org/commons/ctg_trace.jpg',
    isSvg: false,
  };
  const nonCtgCandidate = {
    title: 'Biometria abdominal pelvica obstetrica',
    description: 'Medidas clinicas obstétricas sem monitorização eletrônica',
    source: 'Wikimedia Commons',
    thumbUrl: 'https://upload.wikimedia.org/commons/obstetric_biometry.jpg',
    fullUrl: 'https://upload.wikimedia.org/commons/obstetric_biometry.jpg',
    isSvg: false,
  };

  // Query containing bare "fetal" ("estática fetal" / "biometria fetal") MUST NOT trigger CTG +36 / non-CTG -10 penalty
  const bareFetalCtg = scoreImageRelevance(ctgCandidate, {
    query: 'estatica fetal apresentacao',
    topic: 'Obstetrícia - Estática Fetal',
    question: 'Qual o parâmetro avaliado na estática e biometria fetal?',
    answer: 'Situação longitudinal e apresentação cefálica.',
    enQueries: ['fetal lie obstetric'],
  });
  const bareFetalNonCtg = scoreImageRelevance(nonCtgCandidate, {
    query: 'estatica fetal apresentacao',
    topic: 'Obstetrícia - Estática Fetal',
    question: 'Qual o parâmetro avaliado na estática e biometria fetal?',
    answer: 'Situação longitudinal e apresentação cefálica.',
    enQueries: ['fetal lie obstetric'],
  });
  assert.ok(
    bareFetalCtg <= bareFetalNonCtg + 15,
    `Bare "fetal" should not give CTG an unfair modality edge (ctg=${bareFetalCtg}, nonCtg=${bareFetalNonCtg})`
  );

  // Explicit CTG triggers ("cardiotocografia", "DIP II", "desaceleração tardia") MUST reward CTG (+36) and penalize non-CTG (-10)
  for (const trigger of ['cardiotocografia basal', 'DIP II intraparto', 'desaceleração tardia']) {
    const triggeredCtg = scoreImageRelevance(ctgCandidate, {
      query: trigger,
      topic: 'Obstetrícia - Vitalidade',
      question: `Avaliação com ${trigger}.`,
      answer: 'Sofrimento fetal agudo.',
      enQueries: ['cardiotocography late deceleration'],
    });
    const triggeredNonCtg = scoreImageRelevance(nonCtgCandidate, {
      query: trigger,
      topic: 'Obstetrícia - Vitalidade',
      question: `Avaliação com ${trigger}.`,
      answer: 'Sofrimento fetal agudo.',
      enQueries: ['cardiotocography late deceleration'],
    });
    assert.ok(
      triggeredCtg >= triggeredNonCtg + 46,
      `Trigger "${trigger}" must strongly favor CTG (${triggeredCtg}) over non-CTG (${triggeredNonCtg})`
    );
  }
});

test('obstetric sub-modalities prevent episiotomy/breech/leopold pollution on shoulder dystocia and De Lee pelvimetry queries', () => {
  const mcrobertsCandidate = {
    title: 'McRoberts maneuver for shoulder dystocia',
    description: 'Hyperflexion of maternal thighs with suprapubic pressure',
    source: 'Wikimedia Commons',
    thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/McRoberts_maneuver.svg/960px-McRoberts_maneuver.svg.png',
    fullUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/McRoberts_maneuver.svg',
    isSvg: false,
  };
  const episiotomyCandidate = {
    title: 'Mediolateral episiotomy surgical incision',
    description: 'Perineal laceration repair diagram',
    source: 'Wikimedia Commons',
    thumbUrl: 'https://upload.wikimedia.org/commons/episiotomy.jpg',
    fullUrl: 'https://upload.wikimedia.org/commons/episiotomy.jpg',
    isSvg: false,
  };
  const breechCandidate = {
    title: 'Frank breech presentation delivery',
    description: 'Mauriceau maneuver for breech extraction',
    source: 'Wikimedia Commons',
    thumbUrl: 'https://upload.wikimedia.org/commons/frank_breech.jpg',
    fullUrl: 'https://upload.wikimedia.org/commons/frank_breech.jpg',
    isSvg: false,
  };
  const pelvimetryCandidate = {
    title: 'Pelvimetry fetal station De Lee planes',
    description: 'Pelvic inlet diagonal conjugate and synclitism',
    source: 'Wikimedia Commons',
    thumbUrl: 'https://upload.wikimedia.org/commons/de_lee_station.jpg',
    fullUrl: 'https://upload.wikimedia.org/commons/de_lee_station.jpg',
    isSvg: false,
  };

  const sdCtx = {
    query: 'manobra de McRoberts Rubin distocia de ombro',
    topic: 'Obstetrícia - Emergência',
    question: 'Qual a sequência de primeira linha na distócia de espáduas?',
    answer: 'Manobra de McRoberts e pressão suprapúbica.',
    enQueries: ['McRoberts maneuver shoulder dystocia'],
  };
  const mcScore = scoreImageRelevance(mcrobertsCandidate, sdCtx);
  const epiScore = scoreImageRelevance(episiotomyCandidate, sdCtx);
  const breechScore = scoreImageRelevance(breechCandidate, sdCtx);
  assert.ok(mcScore > epiScore + 40, `McRoberts (${mcScore}) >> Episiotomy (${epiScore})`);
  assert.ok(mcScore > breechScore + 40, `McRoberts (${mcScore}) >> Breech (${breechScore})`);

  const deLeeCtx = {
    query: 'planos de De Lee pelvimetria estreito medio',
    topic: 'Obstetrícia - Bacia Obstétrica',
    question: 'Qual a altura das espinhas isquiáticas nos planos de De Lee?',
    answer: 'Plano zero de De Lee.',
    enQueries: ['fetal station De Lee pelvimetry'],
  };
  const pelviScore = scoreImageRelevance(pelvimetryCandidate, deLeeCtx);
  const mcOnDeLeeScore = scoreImageRelevance(mcrobertsCandidate, deLeeCtx);
  assert.ok(
    pelviScore > mcOnDeLeeScore + 40,
    `De Lee pelvimetry (${pelviScore}) >> McRoberts (${mcOnDeLeeScore}) without cross-firing shoulder_dystocia`
  );
});

test('isSvgImageUrl distinguishes rasterized Wikimedia .svg.png thumbnails from raw .svg and scores schematic diagrams appropriately', () => {
  const thumbSvgPng =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/McRoberts_maneuver.svg/960px-McRoberts_maneuver.svg.png';
  const rawSvg = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/McRoberts_maneuver.svg';

  assert.equal(isSvgImageUrl(thumbSvgPng, 'image/svg+xml'), false);
  assert.equal(isSvgImageUrl(rawSvg, 'image/svg+xml'), true);

  const svgPngSchematic = {
    title: 'McRoberts maneuver diagram',
    description: 'Shoulder dystocia McRoberts maneuver schematic',
    source: 'Wikimedia Commons',
    thumbUrl: thumbSvgPng,
    fullUrl: rawSvg,
    isSvg: false,
  };
  const rawSvgSchematic = {
    ...svgPngSchematic,
    thumbUrl: rawSvg,
    isSvg: true,
  };
  const genericNonMatchPhoto = {
    title: 'Obstetric ward corridor',
    description: 'Clinical scene unrelated photo',
    source: 'Wikimedia Commons',
    thumbUrl: 'https://upload.wikimedia.org/commons/obstetric_photo.jpg',
    fullUrl: 'https://upload.wikimedia.org/commons/obstetric_photo.jpg',
    isSvg: false,
  };

  const diagramCtx = {
    query: 'manobra McRoberts esquema',
    topic: 'Obstetrícia - Distócia',
    question: 'Como executar a manobra de McRoberts?',
    answer: 'Hiperflexão das coxas sobre o abdome.',
    enQueries: ['McRoberts maneuver'],
  };
  const svgPngDiagramScore = scoreImageRelevance(svgPngSchematic, diagramCtx);
  const rawSvgDiagramScore = scoreImageRelevance(rawSvgSchematic, diagramCtx);
  const photoDiagramScore = scoreImageRelevance(genericNonMatchPhoto, diagramCtx);
  assert.equal(svgPngDiagramScore - rawSvgDiagramScore, 22);
  assert.ok(svgPngDiagramScore > photoDiagramScore + 40);

  // Raw SVG on ECG still carries -22 SVG penalty
  const ecgRawSvg = {
    title: 'Right bundle branch block ECG',
    description: 'Vector ECG trace RBBB',
    source: 'Wikimedia Commons',
    thumbUrl: 'https://upload.wikimedia.org/commons/rbbb.svg',
    fullUrl: 'https://upload.wikimedia.org/commons/rbbb.svg',
    isSvg: true,
  };
  const ecgRaster = {
    ...ecgRawSvg,
    thumbUrl: 'https://upload.wikimedia.org/commons/rbbb.png',
    fullUrl: 'https://upload.wikimedia.org/commons/rbbb.png',
    isSvg: false,
  };
  const ecgCtx = {
    query: 'bloqueio de ramo direito ECG',
    topic: 'Cardiologia - ECG',
    question: 'Qual achado esperado em V1?',
    answer: 'Padrão rSR em V1.',
    enQueries: ['right bundle branch block ECG'],
  };
  assert.equal(
    scoreImageRelevance(ecgRaster, ecgCtx) - scoreImageRelevance(ecgRawSvg, ecgCtx),
    22
  );
});

test('Partogramm matches partograma modality and prefix token matching while religious Bishop portraits are blocked', () => {
  const partogrammCand = {
    title: 'Partogramm Modell NSIONI 2005',
    description: 'Clinical cervical labor curve chart',
    source: 'Wikimedia Commons',
    thumbUrl: 'https://upload.wikimedia.org/commons/Partogramm_Modell_NSIONI_2005.JPG',
    fullUrl: 'https://upload.wikimedia.org/commons/Partogramm_Modell_NSIONI_2005.JPG',
    isSvg: false,
  };
  const baselineUnrelated = {
    title: 'Medical chart empty paper',
    description: 'Clinical empty sheet',
    source: 'Wikimedia Commons',
    thumbUrl: 'https://upload.wikimedia.org/commons/empty_sheet.jpg',
    fullUrl: 'https://upload.wikimedia.org/commons/empty_sheet.jpg',
    isSvg: false,
  };
  const partoCtx = {
    query: 'partograma linha de alerta',
    topic: 'Obstetrícia - Parto',
    question: 'Como interpretar a linha de alerta no partograma?',
    answer: 'Partograma com traçado à direita da linha de alerta.',
    enQueries: ['partogram labor curve'],
  };
  const pScore = scoreImageRelevance(partogrammCand, partoCtx);
  const bScore = scoreImageRelevance(baselineUnrelated, partoCtx);
  assert.ok(pScore >= bScore + 50, `Partogramm (${pScore}) should beat unrelated (${bScore}) via modality + prefix hits`);

  assert.equal(
    isSpamOrLogoImageUrl(
      'https://upload.wikimedia.org/wikipedia/commons/Bishop_consecration_ceremony.jpg',
      'Archbishop ordination in diocese cathedral'
    ),
    true
  );
});

test('scoreImageRelevance penalizes laterality and ST polarity contradictions by -75', () => {
  const rbbbCand = {
    title: 'ECG tracing bundle branch block',
    description: '12-lead ECG demonstrating RBBB pattern',
    source: 'Wikimedia Commons',
    thumbUrl: 'https://upload.wikimedia.org/commons/ecg_rbbb.png',
    fullUrl: 'https://upload.wikimedia.org/commons/ecg_rbbb.png',
    isSvg: false,
  };
  const lbbbCand = {
    title: 'ECG tracing bundle branch block',
    description: '12-lead ECG demonstrating LBBB pattern',
    source: 'Wikimedia Commons',
    thumbUrl: 'https://upload.wikimedia.org/commons/ecg_lbbb.png',
    fullUrl: 'https://upload.wikimedia.org/commons/ecg_lbbb.png',
    isSvg: false,
  };
  const baseSideCtx = {
    query: 'bloqueio de ramo',
    topic: 'Cardiologia - ECG',
    question: 'Qual bloqueio de ramo aparece no traçado?',
    answer: 'Bloqueio de ramo direito.',
    enQueries: ['bundle branch block ECG'],
  };
  const neutralSideCtx = {
    ...baseSideCtx,
    answer: 'Bloqueio de ramo.',
  };
  const lbbbNeutral = scoreImageRelevance(lbbbCand, neutralSideCtx);
  const lbbbContra = scoreImageRelevance(lbbbCand, baseSideCtx);
  assert.equal(lbbbNeutral - lbbbContra, 75);
  assert.equal(scoreImageRelevance(rbbbCand, baseSideCtx) - lbbbContra, 75);

  const supraCand = {
    title: 'Myocardial ischemia ECG',
    description: '12-lead ECG showing ST elevation',
    source: 'Wikimedia Commons',
    thumbUrl: 'https://upload.wikimedia.org/commons/ecg_st_elev.png',
    fullUrl: 'https://upload.wikimedia.org/commons/ecg_st_elev.png',
    isSvg: false,
  };
  const infraCand = {
    title: 'Myocardial ischemia ECG',
    description: '12-lead ECG showing ST depression',
    source: 'Wikimedia Commons',
    thumbUrl: 'https://upload.wikimedia.org/commons/ecg_st_depr.png',
    fullUrl: 'https://upload.wikimedia.org/commons/ecg_st_depr.png',
    isSvg: false,
  };
  const supraCtx = {
    query: 'IAMCSST supradesnivelamento ECG',
    topic: 'Cardiologia - Isquemia',
    question: 'Qual alteração isquêmica aguda aparece no ECG?',
    answer: 'Supradesnivelamento do segmento ST.',
    enQueries: ['myocardial ischemia ECG'],
  };
  const supraMatch = scoreImageRelevance(supraCand, supraCtx);
  const infraContra = scoreImageRelevance(infraCand, supraCtx);
  assert.equal(supraMatch - infraContra, 75);
});

test('Bishop score / labor induction queries do not drift into cardiotocography and Kardiotokograf hardware photo is blocked', () => {
  const bishopQueries = buildEnglishMedicalSearchQueries(
    'Índice de Bishop amadurecimento cervical',
    'Obstetrícia - Indução do Parto',
    'Colo desfavorável com Bishop < 6 indica misoprostol.'
  );
  assert.ok(
    bishopQueries.some((q) => /Bishop score cervical ripening obstetrics/i.test(q)),
    `Expected Bishop score query in ${JSON.stringify(bishopQueries)}`
  );
  assert.equal(
    bishopQueries.some((q) => /cardiotocography|tachysystole/i.test(q)),
    false,
    `Bishop/induction query must not force cardiotocography: ${JSON.stringify(bishopQueries)}`
  );

  const ctgQueries = buildEnglishMedicalSearchQueries(
    'Taquissistolia uterina e DIP II na cardiotocografia',
    'Obstetrícia - Vitalidade Fetal',
    ''
  );
  assert.ok(
    ctgQueries.some((q) => /cardiotocography fetal heart rate late deceleration CTG/i.test(q))
  );

  assert.equal(
    isSpamOrLogoImageUrl('https://upload.wikimedia.org/wikipedia/commons/5/5b/Kardiotokograf.jpeg'),
    true
  );
});
